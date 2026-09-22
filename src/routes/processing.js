const express = require('express');
const { body, validationResult } = require('express-validator');
const { prisma } = require('../config/database');
const { authenticate, authorize } = require('../middleware/auth');
const { AppError } = require('../middleware/errorHandler');
const { generateBatchNumber } = require('../utils/helpers');
const { formatDate } = require('../utils/formatters');
const { uploadMultiple } = require('../middleware/upload');
const notificationService = require('../services/notificationService');
const emailService = require('../services/emailService');
const { sendToUser } = require('../sockets/helpers');
const logger = require('../utils/logger');

const router = express.Router();

// Inactive statuses — batches with these statuses cannot be modified
const CLOSED_STATUSES = ['COMPLETED', 'CANCELLED', 'FAILED'];

/**
 * Fetch a batch and throw 422 if it is inactive (closed).
 * Returns the batch object on success.
 */
async function assertBatchIsActive(id) {
  const batch = await prisma.processingBatch.findUnique({
    where:  { id },
    select: { id: true, batchNumber: true, startDate: true, status: true, quantity: true },
  });
  if (!batch) throw new AppError('Batch not found', 404);
  if (CLOSED_STATUSES.includes(batch.status)) {
    throw new AppError('This batch is inactive and cannot be modified', 422);
  }
  return batch;
}

// ─── BSF Life Cycle Stage Definitions ────────────────────────────────────────
// A lifecycle has two possible endings:
//   • Harvesting & Separation is carried out → the cycle ends.
//   • Harvesting is not done within its window → the cycle continues through
//     Pre-pupa → Pupa → Adult and then ends.
// Every stage also advances automatically once its duration has elapsed.
const BSF_STAGES = [
  { number: 1, name: 'Breeding & Egg Collection',     durationDays: 4,  description: 'Adult flies mate; eggs collected on substrate cards' },
  { number: 2, name: 'Hatching & Nursery',             durationDays: 7,  description: 'Eggs hatch to L1; early-instar larvae on starter substrate' },
  { number: 3, name: 'Larvae Rearing (Larviculture)', durationDays: 14, description: 'Main growth phase — L2-L5 larvae consuming organic waste' },
  { number: 4, name: 'Harvesting & Separation',        durationDays: 14, description: 'Harvest larvae & frass. If not done within 14 days the cycle moves on to Pre-pupa' },
  { number: 5, name: 'Pre-pupa',                       durationDays: 10, description: 'Larvae migrate off the feed and transform into pre-pupae' },
  { number: 6, name: 'Pupa',                           durationDays: 10, description: 'Pre-pupae develop into pupae' },
  { number: 7, name: 'Adult',                          durationDays: 15, description: 'Adults emerge, mate and lay eggs — cycle complete' },
];

const HARVEST_STAGE = 4;                  // Harvesting & Separation
const FINAL_STAGE   = BSF_STAGES.length;  // Adult
const MS_PER_DAY    = 24 * 60 * 60 * 1000;

const stageDefFor = (n) => BSF_STAGES[n - 1];
const stageEndsAt = (n, startDate) =>
  new Date(new Date(startDate).getTime() + stageDefFor(n).durationDays * MS_PER_DAY);

/**
 * Build the effective stage timeline for a batch.
 * A manual STAGE_TRANSITION entry (the user pressed "Advance Stage") always
 * wins; otherwise a stage advances automatically once its duration has elapsed.
 * Closed batches never auto-advance.
 */
function buildStageTimeline(batch, stageLogs, now) {
  const closed = CLOSED_STATUSES.includes(batch.status);

  // Earliest manual entry time for each stage number (> 1)
  const manual = new Map();
  for (const log of stageLogs) {
    const n = Number(log.metadata && log.metadata.stageNumber);
    if (!n || n < 2 || n > FINAL_STAGE) continue;
    const t = new Date(log.timestamp);
    if (!manual.has(n) || t < manual.get(n)) manual.set(n, t);
  }

  const timeline = [{ stageNumber: 1, startDate: new Date(batch.startDate), auto: false }];
  for (let n = 2; n <= FINAL_STAGE; n++) {
    const prev = timeline[timeline.length - 1];
    if (prev.stageNumber !== n - 1) break;

    const manualAt = manual.get(n);
    if (manualAt && manualAt.getTime() >= prev.startDate.getTime()) {
      timeline.push({ stageNumber: n, startDate: manualAt, auto: false });
      continue;
    }
    if (closed) break; // closed batches stay where they are

    // Safety: Stage 1 holds the initial quantity that seeds the rest of the
    // lifecycle (mass balance). Do not auto-advance past it until it is recorded.
    if (prev.stageNumber === 1 && !(Number(batch.quantity) > 0)) break;

    const dueAt = stageEndsAt(prev.stageNumber, prev.startDate);
    if (dueAt.getTime() > now.getTime()) break;
    timeline.push({ stageNumber: n, startDate: dueAt, auto: true });
  }
  return timeline;
}

/**
 * Compute the current BSF stage info for a batch.
 * @param {object} batch   – { id, startDate, status }
 * @param {Array}  stageLogs – ActivityLog rows with metadata.type === 'STAGE_TRANSITION', sorted ASC
 */
function computeStageInfo(batch, stageLogs) {
  const now = new Date();
  const closed = CLOSED_STATUSES.includes(batch.status);
  const batchStart = new Date(batch.startDate);
  const timeline = buildStageTimeline(batch, stageLogs, now);

  const current    = timeline[timeline.length - 1];
  const stageNum   = current.stageNumber;
  const stageStart = current.startDate;
  const def        = stageDefFor(stageNum);
  const dayInStage = Math.max(0, Math.floor((now - stageStart) / MS_PER_DAY));
  const daysLeft   = Math.max(0, def.durationDays - dayInStage);
  const totalDays  = Math.max(0, Math.floor((now - batchStart) / MS_PER_DAY));

  // The final stage completes the cycle once its duration elapses.
  const finalElapsed =
    stageNum === FINAL_STAGE &&
    stageEndsAt(FINAL_STAGE, stageStart).getTime() <= now.getTime();
  const cycleComplete = (closed && batch.status === 'COMPLETED') || finalElapsed;

  // Days until the Harvesting stage begins (meaningful before/at harvest).
  let daysToHarvest = 0;
  if (stageNum < HARVEST_STAGE) {
    daysToHarvest = daysLeft;
    for (let s = stageNum + 1; s < HARVEST_STAGE; s++) {
      daysToHarvest += stageDefFor(s).durationDays;
    }
  } else if (stageNum === HARVEST_STAGE) {
    daysToHarvest = daysLeft;
  }

  // Build per-stage history
  const history = timeline.map((entry, i) => {
    const next    = timeline[i + 1] || null;
    const endDate = next ? next.startDate : null;
    const spent   = endDate
      ? Math.floor((endDate - entry.startDate) / MS_PER_DAY)
      : dayInStage;
    return {
      stageNumber: entry.stageNumber,
      stageName:   stageDefFor(entry.stageNumber).name,
      startDate:   entry.startDate,
      endDate,
      daysSpent:   spent,
      auto:        entry.auto,
      status:      endDate ? 'completed' : 'active',
    };
  });

  // All stages with status (for frontend stepper)
  const allStages = BSF_STAGES.map(s => {
    const h = history.find(x => x.stageNumber === s.number);
    if (!h) return { ...s, status: 'upcoming' };
    if (h.status === 'completed') {
      return { ...s, status: 'completed', daysSpent: h.daysSpent, auto: h.auto };
    }
    return { ...s, status: 'active', dayInStage, daysRemaining: daysLeft };
  });

  // Cage selected in the most recent stage entry. Hatching & Nursery inherits
  // the Cage ID chosen in Breeding & Egg Collection, so the client prefills the
  // next stage's Cage ID from this. Stage logs are ordered ascending, so scan
  // newest-first.
  const previousCageLog = [...stageLogs].reverse().find(
    (l) => l.metadata && l.metadata.cageId,
  );
  const previousCageId = previousCageLog ? String(previousCageLog.metadata.cageId) : null;

  return {
    currentStage:         stageNum,
    stageName:            def.name,
    stageDescription:     def.description,
    stageStartDate:       stageStart,
    dayInStage,
    stageDuration:        def.durationDays,
    daysRemainingInStage: daysLeft,
    totalDaysElapsed:     totalDays,
    daysToHarvest:        stageNum <= HARVEST_STAGE ? daysToHarvest : 0,
    previousCageId,
    // Harvesting is only possible while the batch is still in (or before) the
    // Harvesting stage; afterwards the cycle runs on to Pre-pupa.
    canHarvest:           !closed && stageNum <= HARVEST_STAGE,
    // Pre-pupa → Pupa → Adult advance on their own, but an open batch can
    // still be advanced manually.
    canAdvance:           !closed,
    autoAdvance:          stageNum > HARVEST_STAGE,
    cycleComplete,
    history,
    allStages,
  };
}

// ─── Batch event notifications (in-app + email) ───────────────────────────────

/**
 * Resolve the company (Admin) id a batch belongs to: prefer the batch's farm
 * owner, falling back to the creator's own company.
 */
async function resolveBatchCompanyAdminId(batch) {
  if (batch.farmId) {
    const farm = await prisma.farm.findUnique({
      where: { id: batch.farmId },
      select: { adminId: true },
    });
    if (farm?.adminId) return farm.adminId;
  }
  if (batch.createdById) {
    const creator = await prisma.user.findUnique({
      where: { id: batch.createdById },
      select: { managedById: true, adminManaged: { select: { id: true } } },
    });
    return creator?.adminManaged?.id ?? creator?.managedById ?? null;
  }
  return null;
}

/**
 * Users that should hear about a batch: its creator plus the ADMIN and MANAGER
 * users of the same company.
 */
async function batchRecipients(batch) {
  const adminId = await resolveBatchCompanyAdminId(batch);
  const or = [];
  if (batch.createdById) or.push({ id: batch.createdById });
  if (adminId) {
    or.push({ managedById: adminId });
    or.push({ adminManaged: { id: adminId } });
  }
  if (!or.length) return [];
  return prisma.user.findMany({
    where: { OR: or, role: { in: ['SUPER_ADMIN', 'ADMIN', 'MANAGER'] } },
    select: { id: true, email: true },
  });
}

/**
 * Fan a processing-batch event out to the batch's company: in-app notification
 * rows, a real-time socket banner and an email. Never throws — a notification
 * failure must not fail the API request that triggered it.
 */
async function notifyBatchEvent(batchId, { subject, heading, intro, details = [] }) {
  try {
    const batch = await prisma.processingBatch.findUnique({
      where: { id: batchId },
      select: { id: true, batchNumber: true, farmId: true, createdById: true },
    });
    if (!batch) return;

    const recipients = await batchRecipients(batch);
    if (!recipients.length) return;

    await notificationService.sendBulkNotifications(
      recipients.map((u) => u.id),
      subject,
      intro,
      'BATCH_UPDATE',
      { batchId: batch.id, batchNumber: batch.batchNumber },
    );

    const seenEmails = new Set();
    for (const user of recipients) {
      // Real-time banner while the user has the dashboard open.
      try {
        sendToUser(user.id, 'batch:stage', {
          title: subject,
          batchId: batch.id,
          batchNumber: batch.batchNumber,
          message: intro,
        });
      } catch (_) { /* sockets may not be initialised yet */ }

      const email = user.email && user.email.trim().toLowerCase();
      if (!email || seenEmails.has(email)) continue;
      seenEmails.add(email);
      emailService
        .sendBatchStageEmail(email, {
          subject,
          heading,
          batchNumber: batch.batchNumber,
          intro,
          details,
        })
        .catch((err) => logger.error('Batch notification email failed:', err));
    }
  } catch (error) {
    logger.error('notifyBatchEvent error:', error);
  }
}

/**
 * Persist stage transitions that have become due by time (and complete the
 * cycle once the final stage's duration has elapsed). Run lazily whenever a
 * lifecycle batch is read so the activity log and batch status stay in sync
 * without a background scheduler. Idempotent — auto entries are timestamped at
 * their due time, so re-running produces no duplicates.
 */
async function syncLifecycleStage(batchId) {
  const batch = await prisma.processingBatch.findUnique({
    where: { id: batchId },
    select: { id: true, batchNumber: true, startDate: true, status: true, createdById: true, quantity: true },
  });
  if (!batch) return;
  if (CLOSED_STATUSES.includes(batch.status)) return;
  if (!batch.batchNumber || !batch.batchNumber.startsWith('LC-')) return;

  const logs = await prisma.activityLog.findMany({
    where: {
      batchId,
      action:  'NOTE_ADDED',
      metadata: { path: ['type'], equals: 'STAGE_TRANSITION' },
    },
    orderBy: { timestamp: 'asc' },
  });

  const now = new Date();
  const loggedStages = new Set();
  for (const l of logs) {
    const n = Number(l.metadata && l.metadata.stageNumber);
    if (n >= 2) loggedStages.add(n);
  }

  const timeline = buildStageTimeline(batch, logs, now);

  for (const entry of timeline) {
    if (entry.stageNumber < 2 || !entry.auto) continue;
    if (loggedStages.has(entry.stageNumber)) continue;
    const def = stageDefFor(entry.stageNumber);
    await prisma.activityLog.create({
      data: {
        batchId,
        action: 'NOTE_ADDED',
        description: `Automatically advanced to Stage ${entry.stageNumber}: ${def.name}`,
        performedById: batch.createdById,
        timestamp: entry.startDate,
        metadata: {
          type: 'STAGE_TRANSITION',
          stageNumber: entry.stageNumber,
          stageName: def.name,
          auto: true,
          notes: 'Stage duration elapsed — advanced automatically',
        },
      },
    });

    // Notify the company (in-app + email) that the batch reached this stage.
    await notifyBatchEvent(batchId, {
      subject: `Batch ${batch.batchNumber} reached Stage ${entry.stageNumber}: ${def.name}`,
      heading: 'BSF Life Cycle — Stage Reached',
      intro: `Batch ${batch.batchNumber} advanced automatically to Stage ${entry.stageNumber}: ${def.name}.`,
      details: [
        ['Stage', `Stage ${entry.stageNumber} of ${FINAL_STAGE} — ${def.name}`],
        ['Stage started', formatDate(entry.startDate, 'DD MMM YYYY')],
        ['Next advance in', `${def.durationDays} days`],
      ],
    });
  }

  const last = timeline[timeline.length - 1];
  if (
    last.stageNumber === FINAL_STAGE &&
    stageEndsAt(FINAL_STAGE, last.startDate).getTime() <= now.getTime()
  ) {
    await prisma.processingBatch.update({
      where: { id: batchId },
      data: { status: 'COMPLETED', endDate: now, completedAt: now },
    });
    await prisma.activityLog.create({
      data: {
        batchId,
        action: 'BATCH_COMPLETED',
        description: 'BSF lifecycle complete — Adult stage finished.',
        performedById: batch.createdById,
        metadata: { lifecycleComplete: true, completedAt: now.toISOString(), auto: true },
      },
    });

    // Notify the company that the cycle ran to completion.
    await notifyBatchEvent(batchId, {
      subject: `BSF Life Cycle completed: ${batch.batchNumber}`,
      heading: 'BSF Life Cycle Complete',
      intro: `Batch ${batch.batchNumber} has completed its BSF life cycle (Adult stage finished).`,
      details: [['Completed', formatDate(now, 'DD MMM YYYY')]],
    });
  }
}
// ─────────────────────────────────────────────────────────────────────────────

// Get all processing batches
router.get('/batches', authenticate, async (req, res, next) => {
  try {
    const { farmId, status, page = 1, limit = 20, batchType } = req.query;
    const where = {};
    
    if (farmId) where.farmId = farmId;
    if (status) {
      // Support comma-separated status values (e.g. 'PENDING,ACTIVE')
      const statuses = status.split(',').map(s => s.trim()).filter(Boolean);
      where.status = statuses.length === 1 ? statuses[0] : { in: statuses };
    }
    // Filter by batch type using batch number prefix
    if (batchType === 'WASTE') {
      where.batchNumber = { startsWith: 'WB-' };
    } else if (batchType === 'LIFECYCLE') {
      where.batchNumber = { startsWith: 'LC-' };
    }
    
    // Admin scope: see ALL batches belonging to the admin's company —
    // farm-linked batches AND batches created by company staff
    // (e.g. lifecycle batches have no farm linkage).
    if (req.user.adminId) {
      where.OR = [
        { farm: { adminId: req.user.adminId } },
        { createdBy: { managedById: req.user.adminId } },
      ];
    } else if (req.user.role === 'MANAGER' && req.user.farmId) {
      where.farmId = req.user.farmId;
    }
    
    const skip = (page - 1) * limit;
    
    const [batches, total] = await Promise.all([
      prisma.processingBatch.findMany({
        where,
        include: {
          farm: { select: { id: true, name: true } },
          createdBy: { select: { id: true, fullName: true } },
          wasteRecords: { take: 5 },
          activityLogs: { take: 10, orderBy: { timestamp: 'desc' } },
          _count: { select: { wasteRecords: true, activityLogs: true, cages: true } }
        },
        skip,
        take: parseInt(limit),
        orderBy: { startDate: 'desc' }
      }),
      prisma.processingBatch.count({ where })
    ]);

    // Keep lifecycle stages in sync with elapsed time so the status badges are
    // current. Only batches whose current stage is already due are synced, so
    // the common case adds no extra queries (best effort — a failure must not
    // break the list).
    const nowMs = Date.now();
    const dueIds = [];
    for (const b of batches) {
      if (!b.batchNumber || !b.batchNumber.startsWith('LC-')) continue;
      if (CLOSED_STATUSES.includes(b.status)) continue;
      const stageLog = (b.activityLogs ?? []).find(
        (l) => l.action === 'NOTE_ADDED' && l.metadata && l.metadata.type === 'STAGE_TRANSITION'
      );
      const stageNum = Number(stageLog && stageLog.metadata && stageLog.metadata.stageNumber) || 1;
      const stageStart = stageLog ? new Date(stageLog.timestamp) : new Date(b.startDate);
      const def = BSF_STAGES[stageNum - 1];
      if (!def) continue;
      if (stageStart.getTime() + def.durationDays * MS_PER_DAY <= nowMs) {
        dueIds.push(b.id);
      }
    }
    for (const id of dueIds) {
      try {
        await syncLifecycleStage(id);
      } catch {
        /* ignore */
      }
    }

    res.json({
      success: true,
      data: batches,
      pagination: {
        page: parseInt(page),
        limit: parseInt(limit),
        total,
        pages: Math.ceil(total / limit)
      }
    });
  } catch (error) {
    next(error);
  }
});

// Create processing batch
router.post('/batches', authenticate, authorize('MANAGER', 'ADMIN'), [
  body('name').optional().isString(),
  body('processType').isIn(['COMPOSTING', 'ANAEROBIC_DIGESTION', 'VERMICOMPOSTING', 'BSF_LARVAE_PROCESSING', 'BLACK_SOLDIER_FLY', 'FERMENTATION', 'DRYING', 'PELLETIZING', 'OTHER']),
  // Lifecycle batches no longer capture an initial quantity up-front — it is
  // entered on the Breeding & Egg Collection (Stage 1) form instead.
  body('quantity').optional({ nullable: true }).isFloat({ min: 0 }),
  body('startDate').isISO8601().withMessage('Valid start date is required'),
  body('batchType').optional().isIn(['WASTE', 'LIFECYCLE']),
  body('startStage').optional().isInt({ min: 1, max: 7 }).withMessage('Start stage must be between 1 and 7'),
  body('wasteType').optional().isString(),
  body('specificWasteItem').optional().isString(),
  body('instructions').optional().isString(),
  // Breeding & Egg Collection (Stage 1) — captured when a lifecycle is created.
  body('cageId').optional().isString(),
  body('timeCollected').optional().isString(),
  body('eggClutches').optional({ nullable: true }).isFloat({ min: 0 }),
  body('initialQuantityG').optional({ nullable: true }).isFloat({ min: 0 }),
  body('condition').optional().isString(),
  // Hatching & Nursery data — only supplied when the cycle starts at a later
  // stage and Hatching & Nursery is skipped.
  body('weightOfHatchedEggs').optional({ nullable: true }).isFloat({ min: 0 }),
  body('feedUsed').optional({ nullable: true }).isFloat({ min: 0 }),
  body('temperature').optional({ nullable: true }).isFloat({ min: -50, max: 80 }),
  body('humidity').optional({ nullable: true }).isFloat({ min: 0, max: 100 }),
  body('hatchRate').optional({ nullable: true }).isFloat({ min: 0 })
], async (req, res, next) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({ success: false, errors: errors.array() });
  }

  try {
    const {
      name,
      batchNumber,
      startDate,
      processType,
      quantity,
      farmId,
      temperature,
      materialLevel,
      moistureContent,
      batchType,
      startStage,
      wasteType,
      specificWasteItem,
      instructions,
      // Breeding & Egg Collection — captured at creation
      cageId,
      timeCollected,
      eggClutches,
      initialQuantityG,
      condition,
      // Hatching & Nursery — captured when that stage is skipped
      weightOfHatchedEggs,
      feedUsed,
      humidity,
      hatchRate
    } = req.body;
    
    const parseQty = quantity != null && quantity !== '' ? parseFloat(quantity) : 0;
    if (batchType !== 'LIFECYCLE' && !(parseQty > 0)) {
      return res.status(400).json({
        success: false,
        errors: [{ param: 'quantity', msg: 'Quantity must be greater than 0' }],
      });
    }

    const batch = await prisma.processingBatch.create({
      data: {
        name: name || (batchType === 'LIFECYCLE' ? 'BSF Life Cycle' : `Waste Batch ${new Date().toLocaleDateString()}`),
        batchNumber: batchNumber || generateBatchNumber(batchType || 'WASTE'),
        startDate: new Date(startDate),
        processType,
        quantity: Number.isFinite(parseQty) ? parseQty : 0,
        farmId: farmId || req.user.farmId,
        createdById: req.user.id,
        status: 'PENDING',
        images: [],
        temperature: temperature ? parseFloat(temperature) : null,
        materialLevel: materialLevel ? parseFloat(materialLevel) : null,
        moistureContent: moistureContent ? parseFloat(moistureContent) : null,
        wasteType: wasteType || null,
        specificWasteItem: specificWasteItem || null,
        instructions: instructions || null
      },
      include: {
        farm: true,
        createdBy: { select: { id: true, fullName: true } }
      }
    });
    
    await prisma.activityLog.create({
      data: {
        batchId: batch.id,
        action: 'BATCH_STARTED',
        description: `Batch ${batch.batchNumber} created`,
        performedById: req.user.id
      }
    });

    // Breeding & Egg Collection (Stage 1) is recorded here rather than on a
    // separate form. Stored as a "Stage 1" stage entry so the lifecycle keeps
    // its full stage timeline and later stages can inherit the cage.
    if (batchType === 'LIFECYCLE') {
      const initialG = initialQuantityG != null && initialQuantityG !== ''
        ? parseFloat(initialQuantityG)
        : (parseQty > 0 ? parseQty * 1000 : null);
      await prisma.activityLog.create({
        data: {
          batchId: batch.id,
          action: 'NOTE_ADDED',
          description: 'Breeding & Egg Collection recorded when the cycle was created',
          performedById: req.user.id,
          metadata: {
            type: 'STAGE_TRANSITION',
            stageNumber: 1,
            stageName: BSF_STAGES[0].name,
            cageId: cageId || null,
            timeCollected: timeCollected || null,
            eggClutches: eggClutches != null && eggClutches !== '' ? parseFloat(eggClutches) : null,
            initialQuantityG: initialG,
            condition: condition || null,
            recordedAtCreation: true,
          },
        },
      });
    }

    // If the user chose to start the BSF Life Cycle at a later stage
    // (e.g. Larvae Rearing), seed STAGE_TRANSITION logs for the skipped
    // stages so stage tracking starts at the selected stage.
    if (batchType === 'LIFECYCLE' && startStage && Number(startStage) > 1) {
      const target = Math.min(Number(startStage), FINAL_STAGE);
      const startTs = new Date(startDate).getTime();
      const toF = (v) => (v != null && v !== '' ? parseFloat(v) : null);
      for (let s = 2; s <= target; s++) {
        const stage = BSF_STAGES[s - 1];
        const meta = {
          type: 'STAGE_TRANSITION',
          stageNumber: s,
          stageName: stage.name,
          notes: 'Batch started directly at this stage',
        };
        // Starting at a later stage means Hatching & Nursery is skipped, so its
        // data (the Larvae Rearing basis) is recorded here instead.
        if (s === 2) {
          meta.startDate = startDate;
          meta.weightOfHatchedEggs = toF(weightOfHatchedEggs);
          meta.feedUsed = toF(feedUsed);
          meta.temperature = toF(temperature);
          meta.humidity = toF(humidity);
          meta.hatchRate = toF(hatchRate);
        }
        await prisma.activityLog.create({
          data: {
            batchId: batch.id,
            action: 'NOTE_ADDED',
            description: `Batch started at Stage ${s}: ${stage.name}`,
            performedById: req.user.id,
            timestamp: new Date(startTs + (s - 2) * 1000),
            metadata: meta,
          },
        });
      }
    }

    // Notify the company (in-app + email) that the batch was created.
    if (batchType === 'LIFECYCLE') {
      const startNum = Math.min(Math.max(Number(startStage) || 1, 1), FINAL_STAGE);
      const startDef = stageDefFor(startNum);
      await notifyBatchEvent(batch.id, {
        subject: `New BSF Life Cycle started: ${batch.batchNumber}`,
        heading: 'BSF Life Cycle Created',
        intro: `Batch ${batch.batchNumber} was created${req.user.fullName ? ` by ${req.user.fullName}` : ''} and starts at Stage ${startNum}: ${startDef.name}.`,
        details: [
          ['Current stage', `Stage ${startNum} of ${FINAL_STAGE} — ${startDef.name}`],
          ['Start date', formatDate(batch.startDate, 'DD MMM YYYY')],
          ['Next advance in', `${startDef.durationDays} days`],
        ],
      });
    } else {
      await notifyBatchEvent(batch.id, {
        subject: `New processing batch created: ${batch.batchNumber}`,
        heading: 'Processing Batch Created',
        intro: `Waste batch ${batch.batchNumber} was created${req.user.fullName ? ` by ${req.user.fullName}` : ''} with ${batch.quantity} kg of waste.`,
        details: [
          ['Input waste', `${batch.quantity} kg`],
          ['Start date', formatDate(batch.startDate, 'DD MMM YYYY')],
        ],
      });
    }

    res.status(201).json({ success: true, data: batch });
  } catch (error) {
    next(error);
  }
});

// Get batch by ID
router.get('/batches/:id', authenticate, async (req, res, next) => {
  try {
    // Keep lifecycle stages in sync with elapsed time before returning detail.
    await syncLifecycleStage(req.params.id);
    const batch = await prisma.processingBatch.findUnique({
      where: { id: req.params.id },
      include: {
        farm: true,
        createdBy: { select: { id: true, fullName: true, email: true } },
        wasteRecords: { orderBy: { date: 'desc' } },
        activityLogs: {
          include: { performedBy: { select: { id: true, fullName: true } } },
          orderBy: { timestamp: 'desc' }
        },
        teamAssignments: {
          include: { teamMember: { select: { id: true, fullName: true } } }
        },
        qualityChecks: { orderBy: { checkedAt: 'desc' } }
      }
    });
    
    if (!batch) {
      throw new AppError('Batch not found', 404);
    }
    
    res.json({ success: true, data: batch });
  } catch (error) {
    next(error);
  }
});

// Update batch
router.put('/batches/:id', authenticate, authorize('MANAGER', 'ADMIN'), async (req, res, next) => {
  try {
    await assertBatchIsActive(req.params.id);
    const updateData = { ...req.body };
    
    const numericFields = ['quantity', 'temperature', 'materialLevel', 'moistureContent', 'phLevel', 'liquidOutput', 'fertilizerOutput', 'gasOutput', 'conversionRate', 'processingEfficiency'];
    numericFields.forEach(field => {
      if (updateData[field]) updateData[field] = parseFloat(updateData[field]);
    });
    
    if (updateData.startDate) updateData.startDate = new Date(updateData.startDate);
    if (updateData.endDate) updateData.endDate = new Date(updateData.endDate);
    
    const batch = await prisma.processingBatch.update({
      where: { id: req.params.id },
      data: updateData
    });
    
    if (updateData.status) {
      await prisma.activityLog.create({
        data: {
          batchId: batch.id,
          action: `BATCH_${updateData.status.toUpperCase()}`,
          description: `Batch status changed to ${updateData.status}`,
          performedById: req.user.id
        }
      });
    }
    
    res.json({ success: true, data: batch });
  } catch (error) {
    next(error);
  }
});

// Record output + quality score for a COMPLETED batch (lifecycle done)
router.patch('/batches/:id/finalize', authenticate, authorize('MANAGER', 'ADMIN'), [
  body('fertilizerOutput').optional({ nullable: true }).isFloat({ min: 0 }).withMessage('Output weight must be ≥ 0'),
  body('qualityScore').optional({ nullable: true }).isFloat({ min: 0, max: 10 }).withMessage('Quality score must be 0–10'),
  body('notes').optional().isString(),
], async (req, res, next) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({ success: false, errors: errors.array() });
  }
  try {
    const { id } = req.params;
    const batch = await prisma.processingBatch.findUnique({
      where: { id },
      select: { id: true, batchNumber: true, status: true },
    });
    if (!batch) throw new AppError('Batch not found', 404);

    const updateData = {};
    if (req.body.fertilizerOutput != null && req.body.fertilizerOutput !== '') {
      updateData.fertilizerOutput = parseFloat(req.body.fertilizerOutput);
      updateData.fertilizerOutputUnit = 'kg';
    }
    if (req.body.qualityScore != null && req.body.qualityScore !== '') {
      updateData.qualityScore = parseFloat(req.body.qualityScore);
    }
    if (req.body.notes) updateData.notes = req.body.notes;

    const updated = await prisma.processingBatch.update({
      where: { id },
      data: updateData,
    });

    await prisma.activityLog.create({
      data: {
        batchId: id,
        action: 'OUTPUT_RECORDED',
        description: `Output finalized — weight: ${updateData.fertilizerOutput ?? '—'} kg, quality: ${updateData.qualityScore ?? '—'}/10`,
        performedById: req.user.id,
        metadata: {
          fertilizerOutput: updateData.fertilizerOutput ?? null,
          qualityScore: updateData.qualityScore ?? null,
        },
      },
    });

    res.json({ success: true, data: updated });
  } catch (error) {
    next(error);
  }
});

// Add waste to batch
router.post('/batches/:id/add-waste', authenticate, authorize('MANAGER', 'ADMIN'), [
  body('wasteRecordIds').isArray().withMessage('wasteRecordIds must be an array'),
  body('amounts').optional().isObject().withMessage('amounts must be an object of wasteRecordId → kg')
], async (req, res, next) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({ success: false, errors: errors.array() });
  }

  try {
    const { id } = req.params;
    const { wasteRecordIds } = req.body;

    // Guard: inactive batches cannot be modified, and fetch quantity for validation
    await assertBatchIsActive(id);

    const batchWithQty = await prisma.processingBatch.findUnique({
      where: { id },
      select: { id: true, quantity: true }
    });

    if (!batchWithQty) {
      throw new AppError('Batch not found', 404);
    }

    // Deduplicate — the same record must not be added to a batch twice
    const uniqueIds = [...new Set(wasteRecordIds)];

    // Fetch current waste records to calculate remaining quantities.
    // FIFO: order by waste date (oldest first) so the batch quantity is
    // deducted from the earliest waste records first; createdAt breaks ties
    // deterministically for records logged on the same day.
    const wasteRecords = await prisma.wasteRecord.findMany({
      where: { id: { in: uniqueIds } },
      select: {
        id: true,
        sourceName: true,
        sourceType: true,
        quantity: true,
        unit: true,
        date: true,
        status: true,
        processedQuantity: true,
        processingBatchId: true,
        description: true,
        location: true,
        notes: true,
        images: true,
        fileUrl: true,
        recordedById: true,
        supplierId: true,
        farmId: true,
        createdAt: true,
      },
      orderBy: [{ date: 'asc' }, { createdAt: 'asc' }],
    });

    if (wasteRecords.length !== uniqueIds.length) {
      return res.status(404).json({
        success: false,
        message: 'One or more of the selected waste records were not found.'
      });
    }

    // Reject records that are already fully processed — nothing is left to batch.
    const exhaustedRecords = wasteRecords.filter(r => (r.processedQuantity ?? 0) >= r.quantity - 1e-9);
    if (exhaustedRecords.length > 0) {
      return res.status(409).json({
        success: false,
        message: `The following waste records are already fully processed and cannot be batched again: ${exhaustedRecords.map(r => `"${r.sourceName}"`).join(', ')}.`
      });
    }

    // A waste record has exactly one processingBatchId (one-to-many), so it
    // can only ever be linked to ONE batch at a time. Records already claimed
    // by a different batch contribute only their leftover quantity here: the
    // leftover is SPLIT into a fresh waste record that gets linked to this
    // batch, while the original record stays with its current batch so that
    // batch keeps its source linkage (and its consumed kg stays accurate).
    const freeRecords = wasteRecords.filter(r => !r.processingBatchId || r.processingBatchId === id);
    const claimedWithLeftover = wasteRecords.filter(
      r => r.processingBatchId && r.processingBatchId !== id &&
        (r.processedQuantity ?? 0) < r.quantity - 1e-9,
    );

    // Per-source amounts (optional) — lets the caller say exactly how many kg
    // to take from EACH selected waste record instead of consuming the batch
    // quantity FIFO. Every selected record must carry a positive amount that
    // does not exceed its remaining quantity, and the amounts must add up to
    // the batch quantity.
    const amountsBody =
      req.body.amounts && typeof req.body.amounts === 'object' && !Array.isArray(req.body.amounts)
        ? req.body.amounts
        : null;
    const amountById =
      amountsBody && Object.keys(amountsBody).length > 0
        ? new Map(Object.entries(amountsBody).map(([k, v]) => [k, Number.parseFloat(v)]))
        : null;

    const remainingById = new Map(
      wasteRecords.map((r) => [r.id, r.quantity - (r.processedQuantity ?? 0)]),
    );

    if (amountById) {
      const hasValidAmounts = wasteRecords.every((r) => {
        const v = amountById.get(r.id);
        return (
          amountById.size === uniqueIds.length &&
          typeof v === 'number' &&
          Number.isFinite(v) &&
          v > 0 &&
          v <= (remainingById.get(r.id) ?? 0) + 1e-9
        );
      });
      if (!hasValidAmounts) {
        return res.status(422).json({
          success: false,
          message:
            'Every selected waste record must have a positive amount (kg) that does not exceed its remaining quantity.',
        });
      }
      const sumAmounts = wasteRecords.reduce((s, r) => s + (amountById.get(r.id) ?? 0), 0);
      if (Math.abs(sumAmounts - batchWithQty.quantity) > 0.01) {
        return res.status(422).json({
          success: false,
          message: `The per-source amounts (${sumAmounts.toFixed(2)} kg) must add up to the batch quantity (${batchWithQty.quantity.toFixed(2)} kg).`,
        });
      }
    } else {
      // Validate: batch quantity must not exceed the TOTAL remaining quantity of the selected records
      const totalRemaining =
        freeRecords.reduce((s, r) => s + (r.quantity - (r.processedQuantity ?? 0)), 0) +
        claimedWithLeftover.reduce((s, r) => s + (r.quantity - (r.processedQuantity ?? 0)), 0);
      if (batchWithQty.quantity > totalRemaining) {
        return res.status(422).json({
          success: false,
          message: `The batch quantity (${batchWithQty.quantity.toFixed(2)} kg) exceeds the available waste quantity (${totalRemaining.toFixed(2)} kg). Please reduce the batch quantity or select more waste records.`
        });
      }
    }

    // Run everything in a transaction
    const updatedBatch = await prisma.$transaction(async (tx) => {
      // Split the leftover of claimed records into fresh records. The split
      // record inherits supplier/farm attribution so per-supplier/per-farm
      // totals stay correct once the original record is shrunk below.
      const splits = [];
      const splitSourceOf = new Map(); // split record id → original record id
      for (const r of claimedWithLeftover) {
        const leftover = r.quantity - (r.processedQuantity ?? 0);
        const split = await tx.wasteRecord.create({
          data: {
            sourceName: r.sourceName,
            sourceType: r.sourceType,
            quantity: leftover,
            unit: r.unit,
            date: r.date,
            status: 'ACKNOWLEDGED',
            description: r.description,
            location: r.location,
            notes: r.notes,
            images: r.images ?? [],
            fileUrl: r.fileUrl,
            recordedById: r.recordedById,
            supplierId: r.supplierId,
            farmId: r.farmId,
          },
        });
        splits.push(split);
        splitSourceOf.set(split.id, r.id);

        // The leftover now lives in the split record — shrink the original to
        // its consumed amount and mark it fully processed, so it stops showing
        // a phantom remaining quantity in the available pool (quantity and
        // consumed kg across the two records still add up to the original).
        await tx.wasteRecord.update({
          where: { id: r.id },
          data: {
            quantity: r.processedQuantity ?? 0,
            processedQuantity: r.processedQuantity ?? 0,
            status: 'PROCESSED',
            ...(r.processingDate ? {} : { processingDate: new Date() }),
          },
        });
      }

      // FIFO over the effective records — split records carry the original
      // record's date, so oldest waste is still consumed first.
      const allRecords = [...freeRecords, ...splits].sort((a, b) => {
        const da = new Date(a.date).getTime();
        const db = new Date(b.date).getTime();
        if (da !== db) return da - db;
        return new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime();
      });

      // NOTE: records are linked to this batch only as they actually consume
      // quantity (the FK is set inside the loops below). Connecting every
      // selected record up-front would leave records that the FIFO fill skips
      // (or that carry a 0 per-source amount) linked to the batch with
      // processedQuantity = 0 — so they would keep showing up as "available"
      // even though they are already listed as a source of this batch.
      if (amountById) {
        // Per-source amounts: consume the exact user-entered amount from each
        // record. A split record consumes the amount entered for the original
        // record it was split from; the rest of its leftover stays linked to
        // this batch (PROCESSING) so it remains visible in the available pool.
        for (const record of allRecords) {
          const originalId = splitSourceOf.get(record.id) ?? record.id;
          const amount = amountById.get(originalId) ?? 0;
          if (!(amount > 0)) continue;
          const alreadyProcessed = record.processedQuantity ?? 0;
          const remaining = record.quantity - alreadyProcessed;
          const consume = Math.min(remaining, amount);
          const newProcessed = alreadyProcessed + consume;
          const isExhausted = newProcessed >= record.quantity - 1e-9;

          await tx.wasteRecord.update({
            where: { id: record.id },
            data: {
              processedQuantity: isExhausted ? record.quantity : newProcessed,
              processingBatchId: id,
              status: isExhausted ? 'PROCESSED' : 'PROCESSING',
              ...(isExhausted ? { processingDate: new Date() } : {})
            }
          });
        }
      } else {
        // Distribute the batch quantity across the selected records — consume
        // each record's remaining quantity until the batch quantity is filled.
        let toConsume = batchWithQty.quantity;
        for (const record of allRecords) {
          if (toConsume <= 0) break;
          const alreadyProcessed = record.processedQuantity ?? 0;
          const remaining = record.quantity - alreadyProcessed;
          const consume = Math.min(remaining, toConsume);
          const newProcessed = alreadyProcessed + consume;
          const isExhausted = newProcessed >= record.quantity - 1e-9;

          await tx.wasteRecord.update({
            where: { id: record.id },
            data: {
              processedQuantity: isExhausted ? record.quantity : newProcessed,
              processingBatchId: id,
              status: isExhausted ? 'PROCESSED' : 'PROCESSING',
              ...(isExhausted ? { processingDate: new Date() } : {})
            }
          });
          toConsume -= consume;
        }
      }

      // Re-read so the returned batch reflects exactly the records that were
      // actually consumed (and therefore linked).
      const updated = await tx.processingBatch.findUnique({
        where: { id },
        include: { wasteRecords: true },
      });
      return updated;
    });

    res.json({ success: true, data: updatedBatch });
  } catch (error) {
    next(error);
  }
});

// Return waste records from a batch back to the available pool.
// Only allowed while the batch has NOT been used to feed larvae
// (i.e. no cages are assigned to the batch).
router.post('/batches/:id/remove-waste', authenticate, authorize('MANAGER', 'ADMIN'), [
  body('wasteRecordIds').isArray().withMessage('wasteRecordIds must be an array')
], async (req, res, next) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({ success: false, errors: errors.array() });
  }

  try {
    const { id } = req.params;
    const { wasteRecordIds } = req.body;
    const uniqueIds = [...new Set(wasteRecordIds)];

    if (uniqueIds.length === 0) {
      return res.status(400).json({ success: false, message: 'Select at least one waste record to return.' });
    }

    // Batches in a closed state cannot be modified.
    await assertBatchIsActive(id);

    const batch = await prisma.processingBatch.findUnique({
      where: { id },
      include: { _count: { select: { cages: true } } },
    });
    if (!batch) {
      throw new AppError('Batch not found', 404);
    }

    // Used-to-feed guard: once cages are assigned (waste fed to larvae),
    // the waste can no longer be returned.
    if (batch._count.cages > 0) {
      throw new AppError(
        'This batch has already been used to feed larvae and its waste cannot be returned.',
        409,
      );
    }

    const records = await prisma.wasteRecord.findMany({
      where: { id: { in: uniqueIds }, processingBatchId: id },
      select: { id: true },
    });
    if (records.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'None of the selected waste records belong to this batch.',
      });
    }

    const returnIds = records.map((r) => r.id);

    await prisma.$transaction([
      prisma.processingBatch.update({
        where: { id },
        data: { wasteRecords: { disconnect: returnIds.map((wasteId) => ({ id: wasteId })) } },
      }),
      prisma.wasteRecord.updateMany({
        where: { id: { in: returnIds } },
        data: {
          processingBatchId: null,
          processedQuantity: 0,
          status: 'ACKNOWLEDGED',
          processingDate: null,
        },
      }),
    ]);

    res.json({
      success: true,
      message: `${returnIds.length} waste record(s) returned to available waste.`,
      data: { returned: returnIds.length },
    });
  } catch (error) {
    next(error);
  }
});

// Record batch output and mark as Processed
router.post('/batches/:id/record-output', authenticate, authorize('MANAGER', 'ADMIN'), [
  // Legacy fields (kept for backward compat)
  body('larvaeWeight').optional({ nullable: true }).isFloat({ min: 0 }),
  body('frassWeight').optional({ nullable: true }).isFloat({ min: 0 }),
  body('prepupaeWeight').optional({ nullable: true }).isFloat({ min: 0 }),
  // New product breakdown fields
  body('bsfLarvaeKg').optional({ nullable: true }).isFloat({ min: 0 }).withMessage('BSF larvae weight must be ≥ 0'),
  body('bsfMealKg').optional({ nullable: true }).isFloat({ min: 0 }).withMessage('BSF meal weight must be ≥ 0'),
  body('bsfOilKg').optional({ nullable: true }).isFloat({ min: 0 }).withMessage('BSF oil weight must be ≥ 0'),
  body('frassFertilizerKg').optional({ nullable: true }).isFloat({ min: 0 }).withMessage('Frass fertilizer weight must be ≥ 0'),
  body('recycledLarvaeKg').optional({ nullable: true }).isFloat({ min: 0 }).withMessage('Recycled larvae weight must be ≥ 0'),
  body('endDate').optional({ nullable: true }).isISO8601().withMessage('Valid end date required'),
  body('notes').optional().isString(),
], async (req, res, next) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({ success: false, errors: errors.array() });
  }
  try {
    const { id } = req.params;
    await assertBatchIsActive(id);
    const {
      larvaeWeight, frassWeight, prepupaeWeight,
      bsfLarvaeKg, bsfMealKg, bsfOilKg, frassFertilizerKg, recycledLarvaeKg,
      notes, endDate,
    } = req.body;

    const toFloat = (v) => (v != null && v !== '' ? parseFloat(v) : 0);

    // Prefer new product fields; fall back to legacy fields
    const bsfLarvae      = toFloat(bsfLarvaeKg)      || toFloat(larvaeWeight);
    const bsfMeal        = toFloat(bsfMealKg);
    const bsfOil         = toFloat(bsfOilKg);
    const frassOut       = toFloat(frassFertilizerKg) || toFloat(frassWeight);
    const prepup         = toFloat(prepupaeWeight);
    const recycled       = toFloat(recycledLarvaeKg);
    // Total sellable output (recycled larvae go back to breeding, not counted as product)
    const totalOutput = bsfLarvae + bsfMeal + bsfOil + frassOut + prepup;

    const closedDate = endDate ? new Date(endDate) : new Date();

    const batch = await prisma.processingBatch.update({
      where: { id },
      data: {
        fertilizerOutput:     totalOutput > 0 ? totalOutput : undefined,
        fertilizerOutputUnit: totalOutput > 0 ? 'kg'        : undefined,
        ...(notes ? { notes } : {}),
        endDate:     closedDate,
        completedAt: closedDate,
        status:      'COMPLETED',
      },
    });

    await prisma.wasteRecord.updateMany({
      where: { processingBatchId: id },
      data: { status: 'PROCESSED', processingDate: closedDate },
    });

    const outputParts = [
      bsfLarvae  > 0 ? `BSF larvae: ${bsfLarvae} kg`       : null,
      bsfMeal    > 0 ? `BSF meal: ${bsfMeal} kg`           : null,
      bsfOil     > 0 ? `BSF oil: ${bsfOil} kg`             : null,
      frassOut   > 0 ? `Frass fertilizer: ${frassOut} kg`  : null,
      prepup     > 0 ? `Pre-pupae: ${prepup} kg`           : null,
      recycled   > 0 ? `Recycled larvae: ${recycled} kg`   : null,
    ].filter(Boolean).join(', ');

    await prisma.activityLog.create({
      data: {
        batchId:       id,
        action:        'OUTPUT_RECORDED',
        description:   `Output recorded — total: ${totalOutput.toFixed(2)} kg${outputParts ? ` (${outputParts})` : ''}`,
        performedById: req.user.id,
        metadata: {
          bsfLarvaeKg:       bsfLarvae  || null,
          bsfMealKg:         bsfMeal    || null,
          bsfOilKg:          bsfOil     || null,
          frassFertilizerKg: frassOut   || null,
          recycledLarvaeKg:  recycled   || null,
          prepupaeWeight:    prepup     || null,
          totalOutputKg:     totalOutput,
        },
      },
    });

    await prisma.activityLog.create({
      data: {
        batchId:       id,
        action:        'BATCH_COMPLETED',
        description:   `Batch marked as Complete — ended ${closedDate.toDateString()}`,
        performedById: req.user.id,
        metadata: { endDate: closedDate.toISOString() },
      },
    });

    res.json({ success: true, data: batch });
  } catch (error) {
    next(error);
  }
});

// Add quality check
router.post('/batches/:id/quality-check', authenticate, authorize('MANAGER', 'ADMIN'), async (req, res, next) => {
  try {
    const { id } = req.params;
    await assertBatchIsActive(id);
    const { checkType, parameter, value, minThreshold, maxThreshold, notes } = req.body;
    
    const passed = (!minThreshold || value >= minThreshold) && (!maxThreshold || value <= maxThreshold);
    
    const qualityCheck = await prisma.qualityCheck.create({
      data: {
        batchId: id,
        checkType,
        parameter,
        value: parseFloat(value),
        unit: req.body.unit || '',
        minThreshold: minThreshold ? parseFloat(minThreshold) : null,
        maxThreshold: maxThreshold ? parseFloat(maxThreshold) : null,
        passed,
        notes,
        checkedById: req.user.id
      }
    });
    
    res.status(201).json({ success: true, data: qualityCheck });
  } catch (error) {
    next(error);
  }
});

// Get batch activity logs
router.get('/batches/:id/activity-logs', authenticate, async (req, res, next) => {
  try {
    const { id } = req.params;
    const { limit = 50 } = req.query;
    
    const logs = await prisma.activityLog.findMany({
      where: { batchId: id },
      include: {
        performedBy: { select: { id: true, fullName: true, profileImage: true } }
      },
      orderBy: { timestamp: 'desc' },
      take: parseInt(limit)
    });
    
    res.json({ success: true, data: logs });
  } catch (error) {
    next(error);
  }
});

// Get daily monitoring logs for a batch
router.get('/batches/:id/daily-logs', authenticate, async (req, res, next) => {
  try {
    const { id } = req.params;
    const logs = await prisma.activityLog.findMany({
      where: {
        batchId: id,
        action: 'NOTE_ADDED',
        metadata: { path: ['type'], equals: 'DAILY_MONITORING' }
      },
      include: {
        performedBy: { select: { id: true, fullName: true } }
      },
      orderBy: { timestamp: 'desc' }
    });
    res.json({ success: true, data: logs });
  } catch (error) {
    next(error);
  }
});

// Add daily monitoring log (with optional image upload)
router.post('/batches/:id/daily-log',
  authenticate,
  authorize('MANAGER', 'ADMIN'),
  uploadMultiple('batch_images', 10),
  [
    body('recordDate').isISO8601().withMessage('Valid record date is required'),
    body('temperature').optional().isFloat(),
    body('moistureContent').optional().isFloat({ min: 0, max: 100 }),
    body('phLevel').optional().isFloat({ min: 0, max: 14 }),
    body('co2Level').optional().isFloat({ min: 0 }),
    body('larvalWeight').optional().isFloat({ min: 0 }),
    body('feedAmount').optional().isFloat({ min: 0 }),
    body('hatchRate').optional().isFloat({ min: 0, max: 100 }),
    body('mortalityRate').optional().isFloat({ min: 0, max: 100 }),
    body('larvalStage').optional().isString(),
    body('observations').optional().isString(),
  ],
  async (req, res, next) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ success: false, errors: errors.array() });
    }
    try {
      const { id } = req.params;
      const {
        recordDate, temperature, moistureContent, phLevel, co2Level,
        larvalWeight, feedAmount, hatchRate, mortalityRate, larvalStage, observations
      } = req.body;

      await assertBatchIsActive(id);

      const toFloat = (v) => (v != null && v !== '' ? parseFloat(v) : null);

      // Collect uploaded image paths
      const imageUrls = (req.files || []).map(f => `/uploads/images/batches/${f.filename}`);

      // Build a human-readable summary for the description field
      const parts = [];
      if (temperature != null && temperature !== '') parts.push(`Temp: ${temperature}°C`);
      if (moistureContent != null && moistureContent !== '') parts.push(`Moisture: ${moistureContent}%`);
      if (phLevel != null && phLevel !== '') parts.push(`pH: ${phLevel}`);
      if (co2Level != null && co2Level !== '') parts.push(`CO₂: ${co2Level} ppm`);
      if (larvalStage) parts.push(`Stage: ${larvalStage}`);

      const log = await prisma.activityLog.create({
        data: {
          batchId: id,
          action: 'NOTE_ADDED',
          description: parts.length > 0 ? parts.join(' | ') : 'Daily monitoring record',
          performedById: req.user.id,
          metadata: {
            type: 'DAILY_MONITORING',
            recordDate,
            temperature: toFloat(temperature),
            moistureContent: toFloat(moistureContent),
            phLevel: toFloat(phLevel),
            co2Level: toFloat(co2Level),
            larvalWeight: toFloat(larvalWeight),
            feedAmount: toFloat(feedAmount),
            hatchRate: toFloat(hatchRate),
            mortalityRate: toFloat(mortalityRate),
            larvalStage: larvalStage || null,
            observations: observations || null,
            images: imageUrls
          }
        },
        include: {
          performedBy: { select: { id: true, fullName: true } }
        }
      });

      res.status(201).json({ success: true, data: log });
    } catch (error) {
      next(error);
    }
  }
);

// Get BSF stage info for a batch
router.get('/batches/:id/stage', authenticate, async (req, res, next) => {
  try {
    const { id } = req.params;
    // Keep lifecycle stages in sync with elapsed time before returning info.
    await syncLifecycleStage(id);
    const batch = await prisma.processingBatch.findUnique({
      where:  { id },
      select: { id: true, batchNumber: true, startDate: true, status: true, quantity: true },
    });
    if (!batch) throw new AppError('Batch not found', 404);

    const stageLogs = await prisma.activityLog.findMany({
      where: {
        batchId: id,
        action:  'NOTE_ADDED',
        metadata: { path: ['type'], equals: 'STAGE_TRANSITION' },
      },
      orderBy: { timestamp: 'asc' },
    });

    res.json({ success: true, data: computeStageInfo(batch, stageLogs) });
  } catch (error) {
    next(error);
  }
});

// Get Larvae Batch info for a processing batch
router.get('/batches/:id/larvae-batch', authenticate, async (req, res, next) => {
  try {
    const { id } = req.params;

    const batch = await prisma.processingBatch.findUnique({
      where: { id },
      select: { id: true, batchNumber: true, quantity: true, status: true },
    });
    if (!batch) {
      return res.status(404).json({ success: false, message: 'Batch not found' });
    }

    // Find the larvae batch creation / harvest logs. Prisma's JSON filter has
    // no `in` operator for a path value, so match each type explicitly.
    const larvaeLogs = await prisma.activityLog.findMany({
      where: {
        batchId: id,
        action: 'NOTE_ADDED',
        OR: [
          { metadata: { path: ['type'], equals: 'LARVAE_BATCH_CREATED' } },
          { metadata: { path: ['type'], equals: 'LARVAE_BATCH_HARVESTED' } },
        ],
      },
      orderBy: { timestamp: 'asc' },
    });

    const creationLog = larvaeLogs.find(l => l.metadata?.type === 'LARVAE_BATCH_CREATED');
    const harvestLog = larvaeLogs.find(l => l.metadata?.type === 'LARVAE_BATCH_HARVESTED');

    res.json({
      success: true,
      data: {
        batchId: batch.id,
        batchNumber: batch.batchNumber,
        exists: !!creationLog,
        initialWeight: creationLog?.metadata?.initialWeight ?? null,
        hatchedEggsWeight: creationLog?.metadata?.hatchedEggsWeight ?? null,
        weightOfHatchedEggs: creationLog?.metadata?.weightOfHatchedEggs ?? null,
        hatchRate: creationLog?.metadata?.hatchRate ?? null,
        createdAt: creationLog?.timestamp ?? null,
        harvested: !!harvestLog,
        larvaeHarvested: harvestLog?.metadata?.larvaeHarvested ?? null,
        frassCollected: harvestLog?.metadata?.frassCollected ?? null,
        residue: harvestLog?.metadata?.residue ?? null,
        qualityGrade: harvestLog?.metadata?.qualityGrade ?? null,
        actualWeight: harvestLog?.metadata?.actualWeight ?? null,
        harvestedAt: harvestLog?.timestamp ?? null,
      },
    });
  } catch (error) {
    next(error);
  }
});

// Advance BSF batch to the next stage
router.post('/batches/:id/advance-stage',
  authenticate,
  authorize('MANAGER', 'ADMIN'),
  [
    body('notes').optional().isString(),
    body('stageWeight').optional({ nullable: true }).isFloat({ min: 0 }),
    body('harvestBsfLarvae').optional({ nullable: true }).isFloat({ min: 0 }),
    body('harvestFrass').optional({ nullable: true }).isFloat({ min: 0 }),
    body('harvestPrepupae').optional({ nullable: true }).isFloat({ min: 0 }),
    body('harvestRecycled').optional({ nullable: true }).isFloat({ min: 0 }),
    // Stage 1: Breeding & Egg Collection
    body('cageId').optional().isString(),
    body('timeCollected').optional().isString(),
    body('eggClutches').optional({ nullable: true }).isFloat({ min: 0 }),
    body('initialWeight').optional({ nullable: true }).isFloat({ min: 0 }),
    // Initial quantity of eggs / hatched eggs / young larvae captured on the
    // Breeding & Egg Collection (Stage 1) form — entered in grams.
    body('initialQuantityG').optional({ nullable: true }).isFloat({ min: 0 }),
    body('condition').optional().isString(),
    // Stage 2: Hatching & Nursery
    body('startDate').optional().isString(),
    body('temperature').optional({ nullable: true }).isFloat({ min: -50, max: 80 }),
    body('humidity').optional({ nullable: true }).isFloat({ min: 0, max: 100 }),
    body('weightOfHatchedEggs').optional({ nullable: true }).isFloat({ min: 0 }),
    body('feedUsed').optional({ nullable: true }).isFloat({ min: 0 }),
    // Hatch rate is weight-derived (hatched weight ÷ initial weight); it can
    // legitimately exceed 100 and must not block the stage transition.
    body('hatchRate').optional({ nullable: true }).isFloat({ min: 0 }),
    // Stage 3: Larvae Rearing (Larviculture)
    body('trayId').optional().isString(),
    body('trayIds').optional().isArray().withMessage('trayIds must be an array'),
    body('trayAllocations').optional().isArray().withMessage('trayAllocations must be an array'),
    body('feedBatchId').optional().isString(),
    body('feedSources').optional().isArray().withMessage('feedSources must be an array'),
    body('feedAdded').optional({ nullable: true }).isFloat({ min: 0 }),
    body('larvaeCondition').optional().isString(),
    body('hatchedWeightG').optional({ nullable: true }).isFloat({ min: 0 }),
    // Stage 4: Harvesting & Separation
    body('larvaeHarvested').optional({ nullable: true }).isFloat({ min: 0 }),
    body('frassCollected').optional({ nullable: true }).isFloat({ min: 0 }),
    body('residue').optional({ nullable: true }).isFloat({ min: 0 }),
    body('qualityGrade').optional().isString(),
    body('actualWeight').optional({ nullable: true }).isFloat({ min: 0 }),
  ],
  async (req, res, next) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ success: false, errors: errors.array() });
    }
    try {
      const { id } = req.params;
      const {
        notes, stageWeight, harvestBsfLarvae, harvestFrass, harvestPrepupae, harvestRecycled,
        // Stage 1
        cageId, timeCollected, eggClutches, initialWeight, initialQuantityG, condition,
        // Stage 2
        startDate, temperature, humidity, weightOfHatchedEggs, feedUsed, hatchRate,
        // Stage 3
        trayId, trayIds, trayAllocations, feedBatchId, feedSources, feedAdded, larvaeCondition,
        hatchedWeightG,
        // Stage 4
        larvaeHarvested, frassCollected, residue, qualityGrade, actualWeight,
      } = req.body;

      // Apply any stage transitions that have fallen due by time before we
      // compute the current stage (avoids advancing a batch that auto-completed).
      await syncLifecycleStage(id);
      const batch = await assertBatchIsActive(id);

      const stageLogs = await prisma.activityLog.findMany({
        where: {
          batchId: id,
          action:  'NOTE_ADDED',
          metadata: { path: ['type'], equals: 'STAGE_TRANSITION' },
        },
        orderBy: { timestamp: 'asc' },
      });

      const info = computeStageInfo(batch, stageLogs);
      if (!info.canAdvance) {
        throw new AppError('This batch is closed and can no longer be advanced', 422);
      }

      // Completing Harvesting & Separation ends the cycle; so does finishing the
      // final Adult stage. Every other step simply moves to the next stage.
      const harvestDone  = info.currentStage === HARVEST_STAGE;
      const atFinalStage = info.currentStage >= FINAL_STAGE;
      const isLifecycleComplete = harvestDone || atFinalStage;
      const nextNum   = isLifecycleComplete ? info.currentStage : info.currentStage + 1;
      const nextStage = BSF_STAGES[nextNum - 1];

      const toF = (v) => (v != null && v !== '' ? parseFloat(v) : null);
      const harvestTotal = [harvestBsfLarvae, harvestFrass, harvestPrepupae].reduce(
        (s, v) => s + (toF(v) ?? 0), 0
      );

      // Build metadata based on which stage we're advancing to
      const stageMeta = {
        type:              'STAGE_TRANSITION',
        stageNumber:       nextNum,
        stageName:         nextStage.name,
        stageWeight:       toF(stageWeight),
        harvestBsfLarvae:  toF(harvestBsfLarvae),
        harvestFrass:      toF(harvestFrass),
        harvestPrepupae:   toF(harvestPrepupae),
        harvestRecycled:   toF(harvestRecycled),
        harvestTotalKg:    harvestTotal > 0 ? harvestTotal : null,
        notes:             notes || null,
      };

      // Build metadata from the form the user just submitted (the stage they are
      // leaving) so each activity-log entry records what was actually entered.
      // The entry is titled with the stage being entered — e.g. advancing from
      // Larvae Rearing creates the "Stage 4 Entry" containing the feed/tray/
      // temperature/humidity data submitted on that form.
      if (info.currentStage === 1) {
        stageMeta.cageId = cageId || null;
        stageMeta.timeCollected = timeCollected || null;
        stageMeta.eggClutches = toF(eggClutches);
        // The initial quantity is captured here (grams) and becomes the batch's
        // basis quantity (kg) used across the rest of the lifecycle.
        const initialG = toF(initialQuantityG) ?? toF(initialWeight);
        stageMeta.initialQuantityG = initialG;
        stageMeta.initialWeight = initialG;
        stageMeta.condition = condition || null;
        if (initialG != null) {
          await prisma.processingBatch.update({
            where: { id },
            data:  { quantity: initialG / 1000 },
          });
        }
      }

      if (info.currentStage === 2) {
        // Breeding & Egg Collection (Stage 1) is recorded at creation so its
        // cage lives on the "Stage 1" entry; older batches recorded it on the
        // "Stage 2" entry.
        const stage1Log =
          stageLogs.find(l => l.metadata && Number(l.metadata.stageNumber) === 1) ||
          stageLogs.find(l => l.metadata && Number(l.metadata.stageNumber) === 2);
        stageMeta.cageId = stage1Log?.metadata?.cageId || cageId || null;
        stageMeta.startDate = startDate || null;
        stageMeta.temperature = toF(temperature);
        stageMeta.humidity = toF(humidity);
        stageMeta.weightOfHatchedEggs = toF(weightOfHatchedEggs);
        stageMeta.feedUsed = toF(feedUsed);
        stageMeta.hatchRate = toF(hatchRate);

        // ── Auto-create Larvae Batch ─────────────────────────────────
        // When advancing from Stage 2 (Hatching & Nursery) to Stage 3
        // (Larvae Rearing), create a dedicated larvae batch record that
        // tracks the hatched eggs as they enter the rearing phase.
        const stage2Log = stageLogs.find(l => l.metadata && l.metadata.stageNumber === 2);
        const hatchedEggsWeight = stage2Log?.metadata?.weightOfHatchedEggs
          ? parseFloat(stage2Log.metadata.weightOfHatchedEggs)
          : toF(weightOfHatchedEggs);
        const larvaeQty = hatchedEggsWeight || batch.quantity * 1000 * 0.15; // ~15% of input (kg → g) if no hatch weight

        await prisma.activityLog.create({
          data: {
            batchId:        id,
            action:         'NOTE_ADDED',
            description:    `Larvae batch created from Hatched Eggs (${larvaeQty.toFixed(2)} g)`,
            performedById:  req.user.id,
            metadata: {
              type:              'LARVAE_BATCH_CREATED',
              batchNumber:       batch.batchNumber,
              initialWeight:     larvaeQty,
              hatchedEggsWeight: hatchedEggsWeight,
              weightOfHatchedEggs: toF(weightOfHatchedEggs),
              hatchRate:         toF(hatchRate),
              stageTransitioned: true,
            },
          },
        });
      }

      if (info.currentStage === 3) {
        const selectedTrayIds =
          Array.isArray(trayIds) && trayIds.length > 0
            ? trayIds.filter((t) => typeof t === 'string' && t)
            : [];

        // Per-tray allocations: each selected tray gets a portion of the LC
        // batch content. (feedKg is retained for backward compatibility with
        // entries created before feed sources carried their own quantities.)
        const allocs = Array.isArray(trayAllocations)
          ? trayAllocations
              .filter((a) => a && typeof a.trayId === 'string')
              .map((a) => ({
                trayId: a.trayId,
                lcKg: toF(a.lcKg),
                feedKg: toF(a.feedKg),
              }))
          : [];
        const allocFeedTotal = allocs.reduce((s, a) => s + (a.feedKg ?? 0), 0);

        // Feed may be drawn from one or more waste batches. Each selected
        // source records how much of that batch was fed to the larvae.
        const feedSourceList = Array.isArray(feedSources)
          ? feedSources
              .filter((f) => f && typeof f.batchId === 'string' && f.batchId)
              .map((f) => ({ batchId: f.batchId, quantity: toF(f.quantity) ?? 0 }))
          : [];
        const feedSourceTotal = feedSourceList.reduce(
          (s, f) => s + (f.quantity ?? 0),
          0
        );
        // The feed sources define the total feed used; fall back to the legacy
        // per-tray feed allocation / feedAdded for older clients.
        const totalFeed =
          feedSourceTotal > 0
            ? feedSourceTotal
            : allocFeedTotal > 0
              ? allocFeedTotal
              : toF(feedAdded) ?? 0;

        stageMeta.batchNumber = batch.batchNumber;
        // Full tray list + first tray for backward compatibility
        stageMeta.trayIds = selectedTrayIds.length > 0 ? selectedTrayIds : null;
        stageMeta.trayId = selectedTrayIds[0] || trayId || null;
        stageMeta.trayAllocations = allocs.length > 0 ? allocs : null;
        stageMeta.feedAdded = totalFeed > 0 ? totalFeed : null;
        stageMeta.temperature = toF(temperature);
        stageMeta.humidity = toF(humidity);
        stageMeta.larvaeCondition = larvaeCondition || null;
        // Weight of Hatched Eggs used as the LC batch basis for this rearing
        // stage (carried over from Stage 2, adjustable on the Stage 3 form).
        stageMeta.hatchedWeightG = toF(hatchedWeightG);

        // Resolve each feed source to its batch number so the activity log
        // shows "WB-…" instead of the raw record id.
        if (feedSourceList.length > 0) {
          const feedBatches = await prisma.processingBatch.findMany({
            where: { id: { in: feedSourceList.map((f) => f.batchId) } },
            select: { id: true, batchNumber: true },
          });
          const numberById = new Map(feedBatches.map((b) => [b.id, b.batchNumber]));
          stageMeta.feedSources = feedSourceList.map((f) => ({
            batchId: f.batchId,
            batchNumber: numberById.get(f.batchId) || null,
            quantity: f.quantity,
          }));
          // Backward-compat: expose the first source as the singular feed source.
          stageMeta.feedBatchId = feedSourceList[0].batchId;
          stageMeta.feedBatchNumber = numberById.get(feedSourceList[0].batchId) || null;
        } else if (feedBatchId) {
          const feedBatch = await prisma.processingBatch.findUnique({
            where: { id: feedBatchId },
            select: { batchNumber: true },
          });
          stageMeta.feedBatchId = feedBatchId;
          stageMeta.feedBatchNumber = feedBatch?.batchNumber || null;
        } else {
          stageMeta.feedBatchId = null;
          stageMeta.feedBatchNumber = null;
        }

        // Deduct the fed quantity from each Feed Source (waste batch) so its
        // remaining quantity reflects what was fed to the larvae.
        if (feedSourceList.length > 0) {
          for (const source of feedSourceList) {
            if (source.quantity > 0) {
              await prisma.processingBatch.update({
                where: { id: source.batchId },
                data: { fedQuantity: { increment: source.quantity } },
              });
            }
          }
        } else if (feedBatchId && totalFeed > 0) {
          await prisma.processingBatch.update({
            where: { id: feedBatchId },
            data: { fedQuantity: { increment: totalFeed } },
          });
        }
      }

      if (info.currentStage === 4) {
        const selectedTrayIds =
          Array.isArray(trayIds) && trayIds.length > 0
            ? trayIds.filter((t) => typeof t === 'string' && t)
            : [];
        stageMeta.batchNumber = batch.batchNumber;
        // Full tray list + first tray for backward compatibility
        stageMeta.trayIds = selectedTrayIds.length > 0 ? selectedTrayIds : null;
        stageMeta.trayId = selectedTrayIds[0] || trayId || null;
        stageMeta.larvaeHarvested = toF(larvaeHarvested);
        stageMeta.frassCollected = toF(frassCollected);
        stageMeta.residue = toF(residue);
        stageMeta.qualityGrade = qualityGrade || null;
        stageMeta.actualWeight = toF(actualWeight);

        // ── Update Larvae Batch with harvest data ─────────────────────
        if (toF(larvaeHarvested) || toF(frassCollected)) {
          await prisma.activityLog.create({
            data: {
              batchId:        id,
              action:         'NOTE_ADDED',
              description:    `Larvae batch harvest recorded: ${toF(larvaeHarvested) || 0} kg larvae, ${toF(frassCollected) || 0} kg frass`,
              performedById:  req.user.id,
              metadata: {
                type:              'LARVAE_BATCH_HARVESTED',
                batchNumber:       batch.batchNumber,
                larvaeHarvested:   toF(larvaeHarvested),
                frassCollected:    toF(frassCollected),
                residue:           toF(residue),
                qualityGrade:      qualityGrade || null,
                actualWeight:      toF(actualWeight),
              },
            },
          });
        }
      }

      await prisma.activityLog.create({
        data: {
          batchId:        id,
          action:         'NOTE_ADDED',
          description:    isLifecycleComplete
            ? `Lifecycle completed at Stage ${info.currentStage}: ${info.stageName}`
            : `Advanced to Stage ${nextNum}: ${nextStage.name}`,
          performedById:  req.user.id,
          metadata: { ...stageMeta, completed: isLifecycleComplete || undefined },
        },
      });

      // If the final lifecycle stage has been reached, automatically complete the batch
      if (isLifecycleComplete) {
        const now = new Date();
        await prisma.processingBatch.update({
          where: { id },
          data: {
            status:      'COMPLETED',
            endDate:     now,
            completedAt: now,
          },
        });
        await prisma.activityLog.create({
          data: {
            batchId:       id,
            action:        'BATCH_COMPLETED',
            description:   'BSF lifecycle complete — batch marked complete.',
            performedById: req.user.id,
            metadata: { lifecycleComplete: true, completedAt: now.toISOString() },
          },
        });
      }

      // Return freshly computed stage info
      const [updatedLogs, updatedBatch] = await Promise.all([
        prisma.activityLog.findMany({
          where: {
            batchId: id,
            action:  'NOTE_ADDED',
            metadata: { path: ['type'], equals: 'STAGE_TRANSITION' },
          },
          orderBy: { timestamp: 'asc' },
        }),
        prisma.processingBatch.findUnique({
          where:  { id },
          select: { id: true, batchNumber: true, startDate: true, status: true },
        }),
      ]);

      // Notify the company (in-app + email) about the new stage / completion.
      // Only BSF Life Cycles have a stage timeline.
      if (batch.batchNumber && batch.batchNumber.startsWith('LC-')) {
        const reachedNum = isLifecycleComplete ? info.currentStage : nextNum;
        const reachedDef = BSF_STAGES[reachedNum - 1];
        const actor = req.user.fullName ? ` by ${req.user.fullName}` : '';
        await notifyBatchEvent(id, {
          subject: isLifecycleComplete
            ? `BSF Life Cycle completed: ${batch.batchNumber}`
            : `Batch ${batch.batchNumber} reached Stage ${reachedNum}: ${reachedDef.name}`,
          heading: isLifecycleComplete ? 'BSF Life Cycle Complete' : 'BSF Life Cycle — Stage Reached',
          intro: isLifecycleComplete
            ? `Batch ${batch.batchNumber} has completed its BSF life cycle at Stage ${info.currentStage}: ${info.stageName}${actor}.`
            : `Batch ${batch.batchNumber} advanced to Stage ${reachedNum}: ${reachedDef.name}${actor}.`,
          details: [
            ['Stage', `Stage ${reachedNum} of ${FINAL_STAGE} — ${reachedDef.name}`],
            isLifecycleComplete
              ? ['Completed', formatDate(new Date(), 'DD MMM YYYY')]
              : ['Next advance in', `${reachedDef.durationDays} days`],
          ],
        });
      }

      res.json({
        success: true,
        data: computeStageInfo(updatedBatch, updatedLogs),
        lifecycleComplete: isLifecycleComplete,
      });
    } catch (error) {
      next(error);
    }
  }
);

// Archive batch (marks the batch as CANCELLED and logs the action)
router.patch(
  '/batches/:id/archive',
  authenticate,
  authorize('ADMIN', 'MANAGER'),
  async (req, res, next) => {
    try {
      const { id } = req.params;

      const batch = await prisma.processingBatch.findUnique({
        where:  { id },
        select: { id: true, batchNumber: true, status: true },
      });
      if (!batch) throw new AppError('Batch not found', 404);

      const archivableStatuses = ['COMPLETED', 'FAILED', 'CANCELLED', 'PAUSED', 'PLANNED', 'PENDING'];
      if (!archivableStatuses.includes(batch.status)) {
        throw new AppError('Only inactive batches can be archived. End the batch first.', 422);
      }

      const [archived] = await prisma.$transaction([
        prisma.processingBatch.update({
          where: { id },
          data:  { status: 'CANCELLED', updatedAt: new Date() },
          select: { id: true, batchNumber: true, status: true },
        }),
        prisma.activityLog.create({
          data: {
            id:          require('crypto').randomUUID(),
            batchId:     id,
            action:      'NOTE_ADDED',
            description: `Batch archived by ${req.user.fullName ?? req.user.email}`,
            metadata:    { type: 'BATCH_ARCHIVED', archivedBy: req.user.id },
            performedById: req.user.id,
            timestamp:   new Date(),
          },
        }),
      ]);

      res.json({ success: true, message: 'Batch archived successfully', data: archived });
    } catch (error) {
      next(error);
    }
  }
);

// Restore an archived (CANCELLED) batch back to PENDING — ADMIN only
router.patch(
  '/batches/:id/restore',
  authenticate,
  authorize('ADMIN'),
  async (req, res, next) => {
    try {
      const { id } = req.params;

      const batch = await prisma.processingBatch.findUnique({
        where:  { id },
        select: { id: true, batchNumber: true, status: true },
      });
      if (!batch) throw new AppError('Batch not found', 404);
      if (batch.status !== 'CANCELLED') {
        throw new AppError('Only cancelled (archived) batches can be restored', 422);
      }

      const [restored] = await prisma.$transaction([
        prisma.processingBatch.update({
          where: { id },
          data:  { status: 'PENDING', updatedAt: new Date() },
          select: { id: true, batchNumber: true, status: true },
        }),
        prisma.activityLog.create({
          data: {
            id:            require('crypto').randomUUID(),
            batchId:       id,
            action:        'NOTE_ADDED',
            description:   `Batch restored by ${req.user.fullName ?? req.user.email}`,
            metadata:      { type: 'BATCH_RESTORED', restoredBy: req.user.id },
            performedById: req.user.id,
            timestamp:     new Date(),
          },
        }),
      ]);

      res.json({ success: true, message: 'Batch restored successfully', data: restored });
    } catch (error) {
      next(error);
    }
  }
);

// Delete batch
router.delete('/batches/:id', authenticate, authorize('ADMIN', 'SUPER_ADMIN'), async (req, res, next) => {
  try {
    const batch = await prisma.processingBatch.findUnique({
      where: { id: req.params.id },
      include: { _count: { select: { cages: true } } },
    });
    if (!batch) {
      throw new AppError('Batch not found', 404);
    }
    // A batch that has been used to feed larvae (has cages assigned)
    // cannot be deleted — deleting it would orphan the larvae feeding data.
    if (batch._count.cages > 0) {
      throw new AppError(
        'This batch has been used to feed larvae and cannot be deleted.',
        409,
      );
    }
    // Delete dependent records first — ActivityLog, TeamAssignment and
    // QualityCheck have required batchId FKs with no onDelete cascade, so
    // a bare processingBatch.delete() always fails with a foreign-key error.
    // (WasteRecord & Cage FKs are optional → auto SetNull, and cages are
    // already excluded by the guard above.)
    // Waste records linked to the deleted batch are also reset so their full
    // quantity returns to the available-waste pool — deleting a batch is an
    // undo, not a loss of the batched kg.
    await prisma.$transaction([
      prisma.activityLog.deleteMany({ where: { batchId: req.params.id } }),
      prisma.teamAssignment.deleteMany({ where: { batchId: req.params.id } }),
      prisma.qualityCheck.deleteMany({ where: { batchId: req.params.id } }),
      prisma.wasteRecord.updateMany({
        where: { processingBatchId: req.params.id },
        data: {
          processingBatchId: null,
          processedQuantity: 0,
          status: 'ACKNOWLEDGED',
          processingDate: null,
        },
      }),
      prisma.processingBatch.delete({ where: { id: req.params.id } }),
    ]);
    res.json({ success: true, message: 'Batch deleted successfully' });
  } catch (error) {
    next(error);
  }
});

// Get processing dashboard
router.get('/dashboard', authenticate, async (req, res, next) => {
  try {
    let where = {};
    
    if (req.user.role === 'MANAGER' && req.user.farmId) {
      where.farmId = req.user.farmId;
    }
    
    const [activeBatches, completedBatches, totalWasteProcessed, totalOutput, recentActivity] = await Promise.all([
      prisma.processingBatch.count({ where: { ...where, status: 'ACTIVE' } }),
      prisma.processingBatch.count({ where: { ...where, status: 'COMPLETED' } }),
      prisma.processingBatch.aggregate({
        where: { ...where, status: 'COMPLETED' },
        _sum: { quantity: true }
      }),
      prisma.processingBatch.aggregate({
        where: { ...where, status: 'COMPLETED' },
        _sum: { liquidOutput: true, fertilizerOutput: true }
      }),
      prisma.activityLog.findMany({
        where: { batch: where },
        include: {
          batch: { select: { batchNumber: true, name: true } },
          performedBy: { select: { fullName: true } }
        },
        orderBy: { timestamp: 'desc' },
        take: 20
      })
    ]);
    
    res.json({
      success: true,
      data: {
        activeBatches,
        completedBatches,
        totalWasteProcessed: totalWasteProcessed._sum.quantity || 0,
        totalLiquidOutput: totalOutput._sum.liquidOutput || 0,
        totalFertilizerOutput: totalOutput._sum.fertilizerOutput || 0,
        recentActivity
      }
    });
  } catch (error) {
    next(error);
  }
});

module.exports = router;