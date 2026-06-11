const express = require('express');
const { body, validationResult } = require('express-validator');
const { prisma } = require('../config/database');
const { authenticate, authorize } = require('../middleware/auth');
const { AppError } = require('../middleware/errorHandler');

const router = express.Router();

const PRODUCTS = [
  'Frass Fertilizer',
  'Prepupae',
  'BSF Larvae',
  'BSF Meal',
  'BSF Oil',
  'Live Larvae (recycled)',
];

// Maps a BSF product name to the closest ProductCategory enum value
const PRODUCT_CATEGORY_MAP = {
  'Frass Fertilizer':       'ORGANIC_FERTILIZER',
  'Prepupae':               'PROTEIN_FEED',
  'BSF Larvae':             'PROTEIN_FEED',
  'BSF Meal':               'DRIED_LARVAE',
  'BSF Oil':                'INSECT_OIL',
  'Live Larvae (recycled)': 'PROTEIN_FEED',
};

// ─── Helpers ─────────────────────────────────────────────────────────────────

/**
 * Extract harvest fractions recorded during Stage 4 advance (most recent wins).
 * Returns null when no stage-4 transition log exists.
 */
function extractHarvest(activityLogs) {
  const log = [...activityLogs].find(
    (l) =>
      l.action === 'NOTE_ADDED' &&
      l.metadata?.type === 'STAGE_TRANSITION' &&
      Number(l.metadata?.stageNumber) === 4,
  );
  if (!log) return null;
  const m = log.metadata;
  return {
    harvestBsfLarvae: m.harvestBsfLarvae ?? null,
    harvestFrass:     m.harvestFrass     ?? null,
    harvestPrepupae:  m.harvestPrepupae  ?? null,
    harvestRecycled:  m.harvestRecycled  ?? null,
    harvestTotalKg:   m.harvestTotalKg   ?? null,
    stageWeight:      m.stageWeight      ?? null,
  };
}

/**
 * Extract output breakdown from the End Batch (OUTPUT_RECORDED) log, or fall
 * back to a SEGREGATION_OUTPUT recorded directly in the post-processing page.
 */
function extractOutput(activityLogs) {
  // Use the OUTPUT_RECORDED log only if it contains a product breakdown.
  // The "Record Output" action stores only { fertilizerOutput, qualityScore } (no product fields),
  // while the "End Batch" action stores the full product map. Skip the former.
  const formal = [...activityLogs].find((l) => {
    if (l.action !== 'OUTPUT_RECORDED') return false;
    const m = l.metadata ?? {};
    return (
      m.bsfLarvaeKg != null ||
      m.bsfMealKg != null ||
      m.bsfOilKg != null ||
      m.frassFertilizerKg != null ||
      m.recycledLarvaeKg != null ||
      m.prepupaeWeight != null
    );
  });
  if (formal) {
    const m = formal.metadata ?? {};
    return {
      bsfLarvaeKg:       m.bsfLarvaeKg       ?? null,
      bsfMealKg:         m.bsfMealKg         ?? null,
      bsfOilKg:          m.bsfOilKg          ?? null,
      frassFertilizerKg: m.frassFertilizerKg ?? null,
      recycledLarvaeKg:  m.recycledLarvaeKg  ?? null,
      prepupaeWeight:    m.prepupaeWeight     ?? null,
      totalOutputKg:     m.totalOutputKg     ?? null,
    };
  }

  // Fall back to the most recent SEGREGATION_OUTPUT recorded in post-processing
  const seg = [...activityLogs].find(
    (l) => l.action === 'NOTE_ADDED' && l.metadata?.type === 'SEGREGATION_OUTPUT',
  );
  if (!seg) return null;
  const p = seg.metadata.products ?? {};
  const total = Object.values(p).reduce((s, v) => s + (Number(v) || 0), 0);
  return {
    frassFertilizerKg: p['Frass Fertilizer']        ?? null,
    prepupaeWeight:    p['Prepupae']                 ?? null,
    bsfLarvaeKg:       p['BSF Larvae']               ?? null,
    bsfMealKg:         p['BSF Meal']                 ?? null,
    bsfOilKg:          p['BSF Oil']                  ?? null,
    recycledLarvaeKg:  p['Live Larvae (recycled)']   ?? null,
    totalOutputKg:     total > 0 ? total : null,
  };
}

/**
 * Aggregate all BAGGING_RECORD logs for a batch into a map of
 * { product -> { baggedKg, bagCount, records[] } }.
 */
function aggregateBagging(activityLogs) {
  const map = {};
  for (const l of activityLogs) {
    if (l.action !== 'NOTE_ADDED' || l.metadata?.type !== 'BAGGING_RECORD') continue;
    const m = l.metadata;
    const product = m.product;
    if (!product) continue;
    if (!map[product]) map[product] = { baggedKg: 0, bagCount: 0, records: [] };
    map[product].baggedKg  += m.baggedKg  ?? 0;
    map[product].bagCount  += m.bagCount   ?? 0;
    map[product].records.push({
      id:           l.id,
      baggedKg:     m.baggedKg    ?? 0,
      bagCount:     m.bagCount    ?? 0,
      notes:        m.notes       ?? null,
      costPrice:    m.costPrice   ?? null,
      sellingPrice: m.sellingPrice ?? null,
      productId:    m.productId   ?? null,
      recordedBy:   l.performedBy?.fullName ?? null,
      recordedAt:   l.timestamp,
    });
  }
  return map;
}

/**
 * Shape a raw batch + its logs into the post-processing response shape.
 */
function shapeBatch(batch) {
  const harvest = extractHarvest(batch.activityLogs ?? []);
  const output  = extractOutput(batch.activityLogs ?? []);
  const bagging = aggregateBagging(batch.activityLogs ?? []);

  return {
    id:             batch.id,
    batchNumber:    batch.batchNumber,
    status:         batch.status,
    quantity:       batch.quantity,
    processType:    batch.processType,
    fertilizerOutput: batch.fertilizerOutput ?? null,
    startDate:      batch.startDate,
    endDate:        batch.endDate ?? null,
    completedAt:    batch.completedAt ?? null,
    farm:           batch.farm ?? null,
    createdBy:      batch.createdBy ?? null,
    wasteRecords:   batch.wasteRecords ?? [],
    harvest,
    output,
    bagging,
  };
}

// ─── Routes ───────────────────────────────────────────────────────────────────

/**
 * GET /api/post-processing/batches
 * Returns COMPLETED batches enriched with harvest + output + bagging data.
 * Query: page, limit, farmId
 */
router.get('/batches', authenticate, async (req, res, next) => {
  try {
    const { farmId, page = 1, limit = 20 } = req.query;
    const where = { status: 'COMPLETED' };

    if (farmId) where.farmId = farmId;
    if (req.user.role === 'MANAGER' && req.user.farmId) {
      where.farmId = req.user.farmId;
    }

    const skip = (Number(page) - 1) * Number(limit);

    const [batches, total] = await Promise.all([
      prisma.processingBatch.findMany({
        where,
        include: {
          farm:        { select: { id: true, name: true } },
          createdBy:   { select: { id: true, fullName: true } },
          wasteRecords: { take: 5 },
          activityLogs: {
            include: { performedBy: { select: { id: true, fullName: true } } },
            orderBy: { timestamp: 'desc' },
            // Enough to cover 5 stage transitions + daily logs + output + bagging history
            take: 100,
          },
        },
        skip,
        take:    Number(limit),
        orderBy: { completedAt: 'desc' },
      }),
      prisma.processingBatch.count({ where }),
    ]);

    res.json({
      success: true,
      data:    batches.map(shapeBatch),
      pagination: {
        page:  Number(page),
        limit: Number(limit),
        total,
        pages: Math.ceil(total / Number(limit)),
      },
    });
  } catch (error) {
    next(error);
  }
});

/**
 * GET /api/post-processing/summary
 * Aggregate totals across all COMPLETED batches (respects farm scoping).
 */
router.get('/summary', authenticate, async (req, res, next) => {
  try {
    const { farmId } = req.query;
    const where = { status: 'COMPLETED' };

    if (farmId) where.farmId = farmId;
    if (req.user.role === 'MANAGER' && req.user.farmId) {
      where.farmId = req.user.farmId;
    }

    const batches = await prisma.processingBatch.findMany({
      where,
      include: {
        activityLogs: {
          where: {
            action: 'NOTE_ADDED',
          },
          orderBy: { timestamp: 'desc' },
          take: 100,
        },
      },
    });

    const totals = {
      batchCount:     batches.length,
      totalInputKg:   0,
      totalOutputKg:  0,
      frassKg:        0,
      prepupaeKg:     0,
      bsfLarvaeKg:    0,
      bsfMealKg:      0,
      bsfOilKg:       0,
      recycledKg:     0,
      baggedFrassKg:  0,
      baggedPrepupaeKg: 0,
    };

    for (const batch of batches) {
      totals.totalInputKg  += batch.quantity ?? 0;
      totals.totalOutputKg += batch.fertilizerOutput ?? 0;

      const harvest = extractHarvest(batch.activityLogs);
      const output  = extractOutput(batch.activityLogs);
      const bagging = aggregateBagging(batch.activityLogs);

      totals.frassKg    += harvest?.harvestFrass    ?? output?.frassFertilizerKg ?? 0;
      totals.prepupaeKg += harvest?.harvestPrepupae ?? output?.prepupaeWeight    ?? 0;
      totals.bsfLarvaeKg += (harvest?.harvestBsfLarvae ?? output?.bsfLarvaeKg   ?? 0);
      totals.bsfMealKg   += output?.bsfMealKg  ?? 0;
      totals.bsfOilKg    += output?.bsfOilKg   ?? 0;
      totals.recycledKg  += harvest?.harvestRecycled ?? output?.recycledLarvaeKg ?? 0;

      totals.baggedFrassKg    += bagging['Frass Fertilizer']?.baggedKg ?? 0;
      totals.baggedPrepupaeKg += bagging['Prepupae']?.baggedKg         ?? 0;
    }

    // Round all to 2 dp
    for (const key of Object.keys(totals)) {
      if (typeof totals[key] === 'number' && key !== 'batchCount') {
        totals[key] = Math.round(totals[key] * 100) / 100;
      }
    }

    res.json({ success: true, data: totals });
  } catch (error) {
    next(error);
  }
});

/**
 * GET /api/post-processing/batches/:id
 * Single COMPLETED batch with full post-processing detail.
 */
router.get('/batches/:id', authenticate, async (req, res, next) => {
  try {
    const batch = await prisma.processingBatch.findUnique({
      where: { id: req.params.id },
      include: {
        farm:         true,
        createdBy:    { select: { id: true, fullName: true, email: true } },
        wasteRecords: { orderBy: { date: 'desc' } },
        activityLogs: {
          include: { performedBy: { select: { id: true, fullName: true } } },
          orderBy: { timestamp: 'desc' },
        },
      },
    });

    if (!batch) throw new AppError('Batch not found', 404);
    if (batch.status !== 'COMPLETED') {
      throw new AppError('Only completed batches appear in post-processing', 422);
    }

    res.json({ success: true, data: shapeBatch(batch) });
  } catch (error) {
    next(error);
  }
});

/**
 * POST /api/post-processing/batches/:id/record-bagging
 * Record a bagging action for one product.
 * Body: { product, baggedKg, bagCount?, notes? }
 */
router.post(
  '/batches/:id/record-bagging',
  authenticate,
  authorize('MANAGER', 'ADMIN'),
  [
    body('product')
      .isIn(PRODUCTS)
      .withMessage(`product must be one of: ${PRODUCTS.join(', ')}`),
    body('baggedKg')
      .isFloat({ min: 0.001 })
      .withMessage('baggedKg must be a positive number'),
    body('bagCount')
      .optional({ nullable: true })
      .isInt({ min: 1 })
      .withMessage('bagCount must be a positive integer'),
    body('notes').optional().isString(),
  ],
  async (req, res, next) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ success: false, errors: errors.array() });
    }

    try {
      const { id } = req.params;
      const { product, baggedKg, bagCount, notes } = req.body;

      const batch = await prisma.processingBatch.findUnique({
        where:  { id },
        select: { id: true, batchNumber: true, status: true, quantity: true },
      });
      if (!batch) throw new AppError('Batch not found', 404);
      if (batch.status !== 'COMPLETED') {
        throw new AppError('Bagging can only be recorded for completed batches', 422);
      }

      const log = await prisma.activityLog.create({
        data: {
          batchId:       id,
          action:        'NOTE_ADDED',
          description:   bagCount
            ? `Bagging recorded — ${product}: ${baggedKg} kg (${bagCount} bags)`
            : `Bagging recorded — ${product}: ${baggedKg} kg`,          performedById: req.user.id,
          metadata: {
            type:     'BAGGING_RECORD',
            product,
            baggedKg: Number.parseFloat(baggedKg),
            bagCount: bagCount ? Number.parseInt(bagCount, 10) : null,
            notes:    notes ?? null,
          },
        },
        include: {
          performedBy: { select: { id: true, fullName: true } },
        },
      });

      res.status(201).json({ success: true, data: log });
    } catch (error) {
      next(error);
    }
  },
);

/**
 * POST /api/post-processing/batches/:id/record-segregation
 * Record product weights measured during segregation (post-processing stage).
 * Stored as a SEGREGATION_OUTPUT activity log; used as the output source when
 * no Stage-4 harvest or End-Batch output was recorded upstream.
 * Body: { products: { [productName]: kg, ... } }
 */
router.post(
  '/batches/:id/record-segregation',
  authenticate,
  authorize('MANAGER', 'ADMIN'),
  [body('products').isObject().withMessage('products must be a key→kg object')],
  async (req, res, next) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ success: false, errors: errors.array() });
    }

    try {
      const { id } = req.params;
      const raw = req.body.products ?? {};

      // Validate and sanitise each product entry
      const validProducts = {};
      for (const [product, kg] of Object.entries(raw)) {
        if (!PRODUCTS.includes(product)) continue;
        const val = Number.parseFloat(kg);
        if (val > 0) validProducts[product] = val;
      }

      if (Object.keys(validProducts).length === 0) {
        return res.status(400).json({
          success: false,
          message: 'At least one product with a positive weight (kg) is required',
        });
      }

      const batch = await prisma.processingBatch.findUnique({
        where:  { id },
        select: { id: true, batchNumber: true, status: true },
      });
      if (!batch) throw new AppError('Batch not found', 404);
      if (batch.status !== 'COMPLETED') {
        throw new AppError('Segregation output can only be recorded for completed batches', 422);
      }

      const summary = Object.entries(validProducts)
        .map(([p, kg]) => `${p}: ${kg} kg`)
        .join(', ');

      const log = await prisma.activityLog.create({
        data: {
          batchId:       id,
          action:        'NOTE_ADDED',
          description:   `Segregation output recorded — ${summary}`,
          performedById: req.user.id,
          metadata: {
            type:     'SEGREGATION_OUTPUT',
            products: validProducts,
          },
        },
        include: { performedBy: { select: { id: true, fullName: true } } },
      });

      res.status(201).json({ success: true, data: log });
    } catch (error) {
      next(error);
    }
  },
);

/**
 * PATCH /api/post-processing/bagging-records/:recordId/pricing
 * Set or update the cost price and/or selling price on an existing BAGGING_RECORD log.
 * Body: { costPrice?, sellingPrice? }
 */
router.patch(
  '/bagging-records/:recordId/pricing',
  authenticate,
  authorize('MANAGER', 'ADMIN'),
  [
    body('costPrice')
      .optional({ nullable: true })
      .isFloat({ min: 0 })
      .withMessage('costPrice must be a non-negative number'),
    body('sellingPrice')
      .optional({ nullable: true })
      .isFloat({ min: 0 })
      .withMessage('sellingPrice must be a non-negative number'),
  ],
  async (req, res, next) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ success: false, errors: errors.array() });
    }

    try {
      const { recordId } = req.params;
      const { costPrice, sellingPrice } = req.body;

      const log = await prisma.activityLog.findUnique({
        where: { id: recordId },
        select: { id: true, action: true, metadata: true, batchId: true },
      });

      if (!log) throw new AppError('Bagging record not found', 404);
      if (log.action !== 'NOTE_ADDED' || log.metadata?.type !== 'BAGGING_RECORD') {
        throw new AppError('Record is not a bagging entry', 422);
      }

      const updatedMetadata = {
        ...log.metadata,
        costPrice:    costPrice    == null ? (log.metadata.costPrice    ?? null) : Number.parseFloat(costPrice),
        sellingPrice: sellingPrice == null ? (log.metadata.sellingPrice ?? null) : Number.parseFloat(sellingPrice),
      };

      const updated = await prisma.activityLog.update({
        where: { id: recordId },
        data:  { metadata: updatedMetadata },
        include: { performedBy: { select: { id: true, fullName: true } } },
      });

      res.json({ success: true, data: updated });
    } catch (error) {
      next(error);
    }
  },
);

/**
 * POST /api/post-processing/bagging-records/:recordId/approve
 * Approve a priced bagging record — creates a Product + variant in the catalogue
 * and stores the resulting productId back into the activity log metadata.
 * Requires both costPrice and sellingPrice to be set on the record.
 */
router.post(
  '/bagging-records/:recordId/approve',
  authenticate,
  authorize('MANAGER', 'ADMIN'),
  async (req, res, next) => {
    try {
      const { recordId } = req.params;

      const log = await prisma.activityLog.findUnique({
        where: { id: recordId },
        select: { id: true, action: true, metadata: true, batchId: true },
      });

      if (!log) throw new AppError('Bagging record not found', 404);
      if (log.action !== 'NOTE_ADDED' || log.metadata?.type !== 'BAGGING_RECORD') {
        throw new AppError('Record is not a bagging entry', 422);
      }
      if (log.metadata.productId) {
        throw new AppError('This bagging record has already been approved and listed', 409);
      }

      const { product: productName, baggedKg, bagCount, costPrice, sellingPrice } = log.metadata;

      if (!sellingPrice) {
        throw new AppError('Set a selling price before approving', 422);
      }
      if (!costPrice) {
        throw new AppError('Set a cost price before approving', 422);
      }

      // Fetch batch to get farmId for the product
      const batch = await prisma.processingBatch.findUnique({
        where: { id: log.batchId },
        select: { id: true, batchNumber: true, farmId: true },
      });

      const category = PRODUCT_CATEGORY_MAP[productName] ?? 'OTHER';
      const baseName = `${productName} — Batch ${batch.batchNumber}`;
      const slug = baseName.toLowerCase().replace(/[^a-z0-9]+/g, '-') + '-' + Date.now();
      const quantity = bagCount && bagCount > 0 ? bagCount : Math.ceil(baggedKg);

      const newProduct = await prisma.product.create({
        data: {
          name:             baseName,
          description:      `${productName} produced from BSF processing batch ${batch.batchNumber}. Total weight: ${baggedKg} kg.`,
          shortDescription: `${productName} — ${baggedKg} kg`,
          category,
          slug,
          images:           [],
          tags:             ['BSF', productName, batch.batchNumber],
          farmId:           batch.farmId ?? null,
          status:           'ACTIVE',
          variants: {
            create: [{
              name:     'Standard',
              sku:      `BSF-${batch.batchNumber}-${productName.replace(/\s+/g, '-').toUpperCase()}-${Date.now()}`,
              quantity,
              price:    Number.parseFloat(sellingPrice),
              cost:     Number.parseFloat(costPrice),
              unitType: 'kg',
              unitValue: baggedKg,
              isActive: true,
            }],
          },
        },
        include: { variants: true },
      });

      // Write productId back into the log metadata so the UI knows it's approved
      await prisma.activityLog.update({
        where: { id: recordId },
        data:  {
          metadata: {
            ...log.metadata,
            productId:   newProduct.id,
            productName: newProduct.name,
            approvedBy:  req.user.id,
            approvedAt:  new Date().toISOString(),
          },
        },
      });

      res.status(201).json({
        success: true,
        data: { product: newProduct },
        message: `${productName} listed in Products`,
      });
    } catch (error) {
      next(error);
    }
  },
);

module.exports = router;
