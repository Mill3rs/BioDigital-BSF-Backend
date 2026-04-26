const express = require('express');
const { body, validationResult } = require('express-validator');
const { prisma } = require('../config/database');
const { authenticate, authorize } = require('../middleware/auth');
const { AppError } = require('../middleware/errorHandler');
const { generateBatchNumber } = require('../utils/helpers');
const { uploadMultiple } = require('../middleware/upload');

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
    select: { id: true, batchNumber: true, startDate: true, status: true },
  });
  if (!batch) throw new AppError('Batch not found', 404);
  if (CLOSED_STATUSES.includes(batch.status)) {
    throw new AppError('This batch is inactive and cannot be modified', 422);
  }
  return batch;
}

// ─── BSF Life Cycle Stage Definitions ────────────────────────────────────────
const BSF_STAGES = [
  { number: 1, name: 'Breeding & Egg Collection',     durationDays: 4,  description: 'Adult flies mate; eggs collected on substrate cards' },
  { number: 2, name: 'Hatching & Nursery',             durationDays: 7,  description: 'Eggs hatch to L1; early-instar larvae on starter substrate' },
  { number: 3, name: 'Larvae Rearing (Larviculture)', durationDays: 14, description: 'Main growth phase — L2-L5 larvae consuming organic waste' },
  { number: 4, name: 'Harvesting & Separation',        durationDays: 2,  description: 'Pre-pupae harvested; frass mechanically separated' },
  { number: 5, name: 'Post-Processing & Recycling',   durationDays: 3,  description: 'Larvae dried or processed; frass bagged and distributed' },
];

/**
 * Compute the current BSF stage info for a batch.
 * @param {object} batch   – { id, startDate, status }
 * @param {Array}  stageLogs – ActivityLog rows with metadata.type === 'STAGE_TRANSITION', sorted ASC
 */
function computeStageInfo(batch, stageLogs) {
  const now = new Date();
  const batchStart = new Date(batch.startDate);

  // Each log says "we entered stageNumber N at this timestamp"
  const timeline = [{ stageNumber: 1, startDate: batchStart }];
  for (const log of stageLogs) {
    timeline.push({
      stageNumber: log.metadata.stageNumber,
      startDate:   new Date(log.timestamp),
    });
  }

  const current     = timeline[timeline.length - 1];
  const stageNum    = current.stageNumber;
  const stageStart  = current.startDate;
  const stageDef    = BSF_STAGES[stageNum - 1];
  const dayInStage  = Math.floor((now - stageStart)   / 86400000);
  const daysLeft    = Math.max(0, stageDef.durationDays - dayInStage);
  const totalDays   = Math.floor((now - batchStart)    / 86400000);

  // Days until we reach stage 4 (Harvesting)
  let daysToHarvest = 0;
  if (stageNum < 4) {
    daysToHarvest = daysLeft;
    for (let s = stageNum + 1; s <= 3; s++) daysToHarvest += BSF_STAGES[s - 1].durationDays;
  } else if (stageNum === 4) {
    daysToHarvest = daysLeft;
  }

  // Build per-stage history
  const history = timeline.map((entry, i) => {
    const next    = timeline[i + 1] || null;
    const endDate = next ? next.startDate : null;
    const spent   = endDate ? Math.floor((endDate - entry.startDate) / 86400000) : dayInStage;
    return {
      stageNumber: entry.stageNumber,
      stageName:   BSF_STAGES[entry.stageNumber - 1].name,
      startDate:   entry.startDate,
      endDate,
      daysSpent:   spent,
      status:      endDate ? 'completed' : 'active',
    };
  });

  // All 5 stages with status (for frontend stepper)
  const allStages = BSF_STAGES.map(s => {
    const h = history.find(x => x.stageNumber === s.number);
    if (!h)                      return { ...s, status: 'upcoming' };
    if (h.status === 'completed') return { ...s, status: 'completed', daysSpent: h.daysSpent };
    return { ...s, status: 'active', dayInStage, daysRemaining: daysLeft };
  });

  return {
    currentStage:         stageNum,
    stageName:            stageDef.name,
    stageDescription:     stageDef.description,
    stageStartDate:       stageStart,
    dayInStage,
    stageDuration:        stageDef.durationDays,
    daysRemainingInStage: daysLeft,
    totalDaysElapsed:     totalDays,
    daysToHarvest:        stageNum <= 4 ? daysToHarvest : 0,
    canAdvance:           stageNum < 5 && !CLOSED_STATUSES.includes(batch.status),
    history,
    allStages,
  };
}
// ─────────────────────────────────────────────────────────────────────────────

// Get all processing batches
router.get('/batches', authenticate, async (req, res, next) => {
  try {
    const { farmId, status, page = 1, limit = 20 } = req.query;
    const where = {};
    
    if (farmId) where.farmId = farmId;
    if (status) where.status = status;
    
    if (req.user.role === 'MANAGER' && req.user.farmId) {
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
          _count: { select: { wasteRecords: true, activityLogs: true } }
        },
        skip,
        take: parseInt(limit),
        orderBy: { startDate: 'desc' }
      }),
      prisma.processingBatch.count({ where })
    ]);
    
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
  body('quantity').isFloat({ gt: 0 }).withMessage('Quantity must be greater than 0'),
  body('startDate').isISO8601().withMessage('Valid start date is required')
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
      moistureContent
    } = req.body;
    
    const batch = await prisma.processingBatch.create({
      data: {
        name: name || `Batch ${new Date().toLocaleDateString()}`,
        batchNumber: batchNumber || generateBatchNumber(),
        startDate: new Date(startDate),
        processType,
        quantity: parseFloat(quantity),
        farmId: farmId || req.user.farmId,
        createdById: req.user.id,
        status: 'PENDING',
        images: [],
        temperature: temperature ? parseFloat(temperature) : null,
        materialLevel: materialLevel ? parseFloat(materialLevel) : null,
        moistureContent: moistureContent ? parseFloat(moistureContent) : null
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
    
    res.status(201).json({ success: true, data: batch });
  } catch (error) {
    next(error);
  }
});

// Get batch by ID
router.get('/batches/:id', authenticate, async (req, res, next) => {
  try {
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
  body('wasteRecordIds').isArray().withMessage('wasteRecordIds must be an array')
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

    // Fetch current waste records to calculate remaining quantities
    const wasteRecords = await prisma.wasteRecord.findMany({
      where: { id: { in: wasteRecordIds } },
      select: { id: true, sourceName: true, quantity: true, unit: true, processedQuantity: true }
    });

    // Validate: batch quantity must not exceed the remaining quantity of any waste record
    const overLimitErrors = wasteRecords
      .map((record) => {
        const alreadyProcessed = record.processedQuantity ?? 0;
        const remaining = record.quantity - alreadyProcessed;
        if (batchWithQty.quantity > remaining) {
          return `"${record.sourceName}" only has ${remaining.toFixed(2)} ${record.unit} remaining, but you are trying to batch ${batchWithQty.quantity.toFixed(2)} ${record.unit}.`;
        }
        return null;
      })
      .filter(Boolean);

    if (overLimitErrors.length > 0) {
      return res.status(422).json({
        success: false,
        message: overLimitErrors.length === 1
          ? overLimitErrors[0]
          : `Some waste records do not have enough remaining quantity:\n${overLimitErrors.join('\n')}`
      });
    }

    // Run everything in a transaction
    const updatedBatch = await prisma.$transaction(async (tx) => {
      // Connect waste records to the batch
      const updated = await tx.processingBatch.update({
        where: { id },
        data: {
          wasteRecords: { connect: wasteRecordIds.map(wasteId => ({ id: wasteId })) }
        },
        include: { wasteRecords: true }
      });

      // Deduct batch quantity from each waste record and set status
      for (const record of wasteRecords) {
        const alreadyProcessed = record.processedQuantity ?? 0;
        const newProcessedQuantity = alreadyProcessed + batchWithQty.quantity;
        const remaining = record.quantity - newProcessedQuantity;
        const isExhausted = remaining <= 0;

        await tx.wasteRecord.update({
          where: { id: record.id },
          data: {
            processedQuantity: isExhausted ? record.quantity : newProcessedQuantity,
            processingBatchId: id,
            status: isExhausted ? 'PROCESSED' : 'PROCESSING',
            ...(isExhausted ? { processingDate: new Date() } : {})
          }
        });
      }

      return updated;
    });

    res.json({ success: true, data: updatedBatch });
  } catch (error) {
    next(error);
  }
});

// Record batch output and mark as Processed
router.post('/batches/:id/record-output', authenticate, authorize('MANAGER', 'ADMIN'), [
  body('larvaeWeight').optional({ nullable: true }).isFloat({ min: 0 }).withMessage('Larvae weight must be ≥ 0'),
  body('frassWeight').optional({ nullable: true }).isFloat({ min: 0 }).withMessage('Frass weight must be ≥ 0'),
  body('prepupaeWeight').optional({ nullable: true }).isFloat({ min: 0 }).withMessage('Pre-pupae weight must be ≥ 0'),
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
    const { larvaeWeight, frassWeight, prepupaeWeight, notes, endDate } = req.body;

    const toFloat = (v) => (v != null && v !== '' ? parseFloat(v) : 0);
    const larvae  = toFloat(larvaeWeight);
    const frass   = toFloat(frassWeight);
    const prepup  = toFloat(prepupaeWeight);
    const totalOutput = larvae + frass + prepup;

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

    await prisma.activityLog.create({
      data: {
        batchId:       id,
        action:        'OUTPUT_RECORDED',
        description:   `Output recorded — total: ${totalOutput.toFixed(2)} kg (larvae: ${larvae} kg, frass: ${frass} kg, pre-pupae: ${prepup} kg)`,
        performedById: req.user.id,
        metadata: {
          larvaeWeight:   larvae || null,
          frassWeight:    frass  || null,
          prepupaeWeight: prepup || null,
          totalOutputKg:  totalOutput,
        },
      },
    });

    await prisma.activityLog.create({
      data: {
        batchId:       id,
        action:        'BATCH_COMPLETED',
        description:   `Batch marked as Processed — ended ${closedDate.toDateString()}`,
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
    const batch = await prisma.processingBatch.findUnique({
      where:  { id },
      select: { id: true, batchNumber: true, startDate: true, status: true },
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

// Advance BSF batch to the next stage
router.post('/batches/:id/advance-stage',
  authenticate,
  authorize('MANAGER', 'ADMIN'),
  [body('notes').optional().isString()],
  async (req, res, next) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ success: false, errors: errors.array() });
    }
    try {
      const { id }     = req.params;
      const { notes }  = req.body;

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
        throw new AppError('Batch is already at the final stage (Post-Processing & Recycling)', 422);
      }

      const nextNum   = info.currentStage + 1;
      const nextStage = BSF_STAGES[nextNum - 1];
      const isLifecycleComplete = nextNum === BSF_STAGES.length; // advancing to final stage

      await prisma.activityLog.create({
        data: {
          batchId:        id,
          action:         'NOTE_ADDED',
          description:    `Advanced to Stage ${nextNum}: ${nextStage.name}`,
          performedById:  req.user.id,
          metadata: {
            type:        'STAGE_TRANSITION',
            stageNumber: nextNum,
            stageName:   nextStage.name,
            notes:       notes || null,
          },
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
            description:   'BSF lifecycle complete — all 5 stages finished. Batch marked inactive.',
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
router.delete('/batches/:id', authenticate, authorize('ADMIN'), async (req, res, next) => {
  try {
    await prisma.processingBatch.delete({ where: { id: req.params.id } });
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