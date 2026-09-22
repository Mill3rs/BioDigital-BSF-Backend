const express = require('express');
const { body, validationResult } = require('express-validator');
const { prisma } = require('../config/database');
const { authenticate, authorize } = require('../middleware/auth');
const { AppError } = require('../middleware/errorHandler');
const { uploadMultiple, toUploadPath } = require('../middleware/upload');
const { batchOutputSummary, extractHarvest } = require('../utils/batchOutput');

const router = express.Router();

// ── Per-company data isolation helpers ────────────────────────────────────────
// Products belong to a company when: linked to one of the company's farms,
// created by any company staff member, or created by the requesting user.
function productCompanyScopes(adminId, userId) {
  return [
    { farm: { adminId } },
    { createdBy: { managedById: adminId } },
    { createdById: userId },
  ];
}

// Only ADMIN / MANAGER (company console) are scoped. SUPER_ADMIN sees all,
// and marketplace roles (BUYER etc.) keep browsing every product.
function shouldScopeProducts(user) {
  return (user.role === 'ADMIN' || user.role === 'MANAGER') && user.adminId;
}

// Throws 404 if an ADMIN/MANAGER tries to touch another company's product.
async function assertProductAccess(productId, req) {
  if (!shouldScopeProducts(req.user)) return;
  const count = await prisma.product.count({
    where: { id: productId, OR: productCompanyScopes(req.user.adminId, req.user.id) },
  });
  if (count === 0) throw new AppError('Product not found', 404);
}

// Get all products
router.get('/', authenticate, async (req, res, next) => {
  try {
    const {
      category,
      status,
      farmId,
      minPrice,
      maxPrice,
      search,
      page = 1,
      limit = 20
    } = req.query;
    
    const where = {};
    if (category) where.category = category;
    if (status) where.status = status;
    if (farmId) where.farmId = farmId;
    
    const conditions = [];
    if (search) {
      conditions.push({
        OR: [
          { name: { contains: search, mode: 'insensitive' } },
          { description: { contains: search, mode: 'insensitive' } },
          { tags: { has: search } }
        ]
      });
    }
    if (shouldScopeProducts(req.user)) {
      conditions.push({ OR: productCompanyScopes(req.user.adminId, req.user.id) });
    }
    if (conditions.length > 0) where.AND = conditions;
    
    const skip = (page - 1) * limit;
    
    const [products, total] = await Promise.all([
      prisma.product.findMany({
        where,
        include: {
          variants: {
            where: { isActive: true },
            orderBy: { price: 'asc' }
          },
          farm: { select: { id: true, name: true } },
          _count: { select: { reviews: true } }
        },
        skip,
        take: parseInt(limit),
        orderBy: { createdAt: 'desc' }
      }),
      prisma.product.count({ where })
    ]);
    
    let filteredProducts = products;
    if (minPrice || maxPrice) {
      filteredProducts = products.filter(product => {
        const minVariantPrice = Math.min(...product.variants.map(v => v.price));
        if (minPrice && minVariantPrice < parseFloat(minPrice)) return false;
        if (maxPrice && minVariantPrice > parseFloat(maxPrice)) return false;
        return true;
      });
    }

    const enriched = filteredProducts.map(product => ({
      ...product,
      minPrice: product.variants.length > 0 ? Math.min(...product.variants.map(v => v.price)) : 0,
      totalQuantity: product.variants.reduce((sum, v) => sum + (v.quantity ?? 0), 0),
      reviewCount: product._count.reviews,
    }));

    res.json({
      success: true,
      data: enriched,
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

// Create product
router.post('/', authenticate, authorize('MANAGER', 'ADMIN'), [
  body('name').notEmpty().withMessage('Product name is required'),
  body('category').isIn(['ORGANIC_FERTILIZER', 'PROTEIN_FEED', 'INSECT_OIL', 'SOIL_CONDITIONER', 'FRESH_LARVAE', 'DRIED_LARVAE', 'COMPOST', 'LIQUID_FERTILIZER', 'BIOCHAR', 'OTHER']),
  body('variants').isArray().withMessage('At least one variant is required'),
  body('variants.*.name').notEmpty(),
  body('variants.*.quantity').isInt({ min: 0 }),
  body('variants.*.price').isFloat({ min: 0 }),
  body('batchAllocations').optional().isArray().withMessage('batchAllocations must be an array')
], async (req, res, next) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({ success: false, errors: errors.array() });
  }

  try {
    const {
      name,
      description,
      shortDescription,
      category,
      images,
      tags,
      farmId,
      variants
    } = req.body;

    // ── Source batches (from Post-Processing) ─────────────────────────────────
    // A product can be drawn from one or more completed batches. Each selected
    // batch is validated against its remaining output; the used amount is then
    // recorded as a PRODUCT_ALLOCATION entry so it deducts from the batch.
    const batchAllocations = Array.isArray(req.body.batchAllocations)
      ? req.body.batchAllocations
      : [];
    const resolvedAllocations = [];

    for (const entry of batchAllocations) {
      const batchId = typeof entry?.batchId === 'string' ? entry.batchId : null;
      const quantityKg = Number(entry?.quantityKg) || 0;
      if (!batchId || quantityKg <= 0) continue;

      // ADMIN/MANAGER may only draw from batches their company owns.
      if (req.user.adminId) {
        const owns = await prisma.processingBatch.count({
          where: {
            id: batchId,
            OR: [
              { farm:      { adminId: req.user.adminId } },
              { createdBy: { managedById: req.user.adminId } },
            ],
          },
        });
        if (!owns) throw new AppError('Batch not found or access denied', 403);
      }

      const sourceBatch = await prisma.processingBatch.findUnique({
        where: { id: batchId },
        select: {
          id: true,
          batchNumber: true,
          status: true,
          activityLogs: { orderBy: { timestamp: 'desc' }, take: 300 },
        },
      });
      if (!sourceBatch) throw new AppError('Batch not found', 404);

      const availability = batchOutputSummary(sourceBatch);
      if (quantityKg > availability.remainingKg + 0.0001) {
        throw new AppError(
          `Batch ${sourceBatch.batchNumber} only has ${availability.remainingKg} kg remaining`,
          400
        );
      }

      resolvedAllocations.push({
        batchId:      sourceBatch.id,
        batchNumber:  sourceBatch.batchNumber,
        quantityKg,
      });
    }

    const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, '-');

    // ADMIN/MANAGER may only attach the product to a farm their company owns.
    if (farmId && req.user.adminId) {
      const farm = await prisma.farm.findFirst({
        where: { id: farmId, adminId: req.user.adminId },
        select: { id: true },
      });
      if (!farm) throw new AppError('Farm not found or access denied', 403);
    }
    
    const product = await prisma.product.create({
      data: {
        name,
        description,
        shortDescription,
        category,
        images: images || [],
        tags: [
          ...(tags || []),
          ...resolvedAllocations.map((a) => a.batchNumber),
        ],
        slug,
        farmId: farmId || req.user.farmId,
        createdById: req.user.id,
        status: 'ACTIVE',
        variants: {
          create: variants.map(variant => ({
            name: variant.name,
            sku: variant.sku || `${slug}-${Date.now()}-${Math.random().toString(36).substr(2, 4)}`,
            quantity: parseInt(variant.quantity),
            price: parseFloat(variant.price),
            comparePrice: variant.comparePrice ? parseFloat(variant.comparePrice) : null,
            cost: variant.cost ? parseFloat(variant.cost) : null,
            unitType: variant.unitType,
            unitValue: variant.unitValue ? parseFloat(variant.unitValue) : null,
            minOrderQuantity: variant.minOrderQuantity || 1,
            maxOrderQuantity: variant.maxOrderQuantity || null,
            weight: variant.weight ? parseFloat(variant.weight) : null,
            dimensions: variant.dimensions || null,
            images: variant.images || []
          }))
        }
      },
      include: { variants: true }
    });

    // Record the allocation against each source batch so the used amount is
    // deducted from that batch's remaining output in Post-Processing.
    if (resolvedAllocations.length > 0) {
      await Promise.all(
        resolvedAllocations.map((a) =>
          prisma.activityLog.create({
            data: {
              batchId:       a.batchId,
              action:        'NOTE_ADDED',
              description:   `${a.quantityKg} kg allocated to product "${name}"`,
              performedById: req.user.id,
              metadata: {
                type:        'PRODUCT_ALLOCATION',
                productId:   product.id,
                productName: name,
                quantityKg:  a.quantityKg,
                batchNumber: a.batchNumber,
              },
            },
          })
        )
      );
    }

    res.status(201).json({
      success: true,
      message: 'Product created successfully',
      data: product,
      allocations: resolvedAllocations,
    });
  } catch (error) {
    next(error);
  }
});

// Get product by ID
router.get('/:id', authenticate, async (req, res, next) => {
  try {
    await assertProductAccess(req.params.id, req);

    const product = await prisma.product.findUnique({
      where: { id: req.params.id },
      include: {
        variants: { where: { isActive: true } },
        farm: { select: { id: true, name: true, region: true } },
        reviews: {
          include: { user: { select: { id: true, fullName: true, profileImage: true } } },
          orderBy: { createdAt: 'desc' },
          take: 10
        },
        _count: { select: { reviews: true } }
      }
    });
    
    if (!product) {
      throw new AppError('Product not found', 404);
    }
    
    const avgRating = product.reviews.length > 0
      ? product.reviews.reduce((sum, r) => sum + r.rating, 0) / product.reviews.length
      : 0;
    
    res.json({
      success: true,
      data: { ...product, averageRating: avgRating }
    });
  } catch (error) {
    next(error);
  }
});

// Update product
router.put('/:id', authenticate, authorize('MANAGER', 'ADMIN'), async (req, res, next) => {
  try {
    await assertProductAccess(req.params.id, req);

    const product = await prisma.product.update({
      where: { id: req.params.id },
      data: req.body,
      include: { variants: true }
    });
    
    res.json({
      success: true,
      message: 'Product updated successfully',
      data: product
    });
  } catch (error) {
    next(error);
  }
});

// Delete product
router.delete('/:id', authenticate, authorize('ADMIN'), async (req, res, next) => {
  try {
    await assertProductAccess(req.params.id, req);

    await prisma.product.delete({ where: { id: req.params.id } });
    res.json({
      success: true,
      message: 'Product deleted successfully'
    });
  } catch (error) {
    next(error);
  }
});

// Upload product images
router.post('/:id/images', authenticate, authorize('MANAGER', 'ADMIN'),
  uploadMultiple('product_images', 5),
  async (req, res, next) => {
    try {
      const { id } = req.params;
      await assertProductAccess(id, req);
      const product = await prisma.product.findUnique({ where: { id }, select: { id: true, images: true } });
      if (!product) throw new AppError('Product not found', 404);

      // Store relative '/uploads/...' paths so they resolve against the API
      // origin at render time (see resolveImageUrl on the web client).
      const newImageUrls = (req.files || [])
        .map((f) => toUploadPath(f.path))
        .filter(Boolean);

      const updated = await prisma.product.update({
        where: { id },
        data: { images: [...(product.images || []), ...newImageUrls] },
      });

      res.json({ success: true, message: 'Images uploaded successfully', data: updated });
    } catch (error) {
      next(error);
    }
  }
);

// Remove a product image by URL
router.delete('/:id/images', authenticate, authorize('MANAGER', 'ADMIN'), async (req, res, next) => {
  try {
    const { id } = req.params;
    const { url } = req.body;
    if (!url) throw new AppError('Image URL is required', 400);

    await assertProductAccess(id, req);
    const product = await prisma.product.findUnique({ where: { id }, select: { id: true, images: true } });
    if (!product) throw new AppError('Product not found', 404);

    const updated = await prisma.product.update({
      where: { id },
      data: { images: (product.images || []).filter((img) => img !== url) },
    });

    res.json({ success: true, message: 'Image removed successfully', data: updated });
  } catch (error) {
    next(error);
  }
});

// Add product variant
router.post('/:id/variants', authenticate, authorize('MANAGER', 'ADMIN'), [
  body('name').notEmpty(),
  body('quantity').isInt({ min: 0 }),
  body('price').isFloat({ min: 0 }),
  body('unitType').notEmpty()
], async (req, res, next) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({ success: false, errors: errors.array() });
  }

  try {
    await assertProductAccess(req.params.id, req);

    const product = await prisma.product.findUnique({
      where: { id: req.params.id }
    });
    
    if (!product) {
      throw new AppError('Product not found', 404);
    }
    
    const {
      name,
      sku,
      quantity,
      price,
      comparePrice,
      cost,
      unitType,
      unitValue,
      minOrderQuantity,
      maxOrderQuantity,
      weight,
      dimensions,
      images
    } = req.body;
    
    const variant = await prisma.productVariant.create({
      data: {
        productId: req.params.id,
        name,
        sku: sku || `${product.slug}-${Date.now()}`,
        quantity: parseInt(quantity),
        price: parseFloat(price),
        comparePrice: comparePrice ? parseFloat(comparePrice) : null,
        cost: cost ? parseFloat(cost) : null,
        unitType,
        unitValue: unitValue ? parseFloat(unitValue) : null,
        minOrderQuantity: minOrderQuantity || 1,
        maxOrderQuantity: maxOrderQuantity || null,
        weight: weight ? parseFloat(weight) : null,
        dimensions: dimensions || null,
        images: images || []
      }
    });
    
    res.status(201).json({
      success: true,
      message: 'Variant added successfully',
      data: variant
    });
  } catch (error) {
    next(error);
  }
});

// Update product variant
router.put('/variants/:variantId', authenticate, authorize('MANAGER', 'ADMIN'), async (req, res, next) => {
  try {
    const variant = await prisma.productVariant.findUnique({
      where: { id: req.params.variantId },
      select: { id: true, productId: true },
    });
    if (!variant) throw new AppError('Variant not found', 404);
    await assertProductAccess(variant.productId, req);

    const numericFields = ['quantity', 'price', 'comparePrice', 'cost', 'unitValue', 'minOrderQuantity', 'maxOrderQuantity', 'weight'];
    const updateData = { ...req.body };
    
    numericFields.forEach(field => {
      if (updateData[field]) {
        updateData[field] = parseFloat(updateData[field]);
      }
    });
    
    const updatedVariant = await prisma.productVariant.update({
      where: { id: req.params.variantId },
      data: updateData
    });
    
    res.json({
      success: true,
      message: 'Variant updated successfully',
      data: updatedVariant
    });
  } catch (error) {
    next(error);
  }
});

// Delete product variant
router.delete('/variants/:variantId', authenticate, authorize('ADMIN'), async (req, res, next) => {
  try {
    const variant = await prisma.productVariant.findUnique({
      where: { id: req.params.variantId },
      select: { id: true, productId: true },
    });
    if (!variant) throw new AppError('Variant not found', 404);
    await assertProductAccess(variant.productId, req);

    await prisma.productVariant.delete({
      where: { id: req.params.variantId }
    });
    
    res.json({
      success: true,
      message: 'Variant deleted successfully'
    });
  } catch (error) {
    next(error);
  }
});

// Add product review
router.post('/:id/reviews', authenticate, [
  body('rating').isInt({ min: 1, max: 5 }),
  body('comment').optional().isString()
], async (req, res, next) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({ success: false, errors: errors.array() });
  }

  try {
    const product = await prisma.product.findUnique({
      where: { id: req.params.id }
    });
    
    if (!product) {
      throw new AppError('Product not found', 404);
    }
    
    const existingReview = await prisma.productReview.findFirst({
      where: {
        productId: req.params.id,
        userId: req.user.id
      }
    });
    
    if (existingReview) {
      throw new AppError('You have already reviewed this product', 400);
    }
    
    const review = await prisma.productReview.create({
      data: {
        productId: req.params.id,
        userId: req.user.id,
        rating: parseInt(req.body.rating),
        title: req.body.title,
        comment: req.body.comment,
        images: req.body.images || []
      },
      include: {
        user: { select: { id: true, fullName: true, profileImage: true } }
      }
    });

    // Recompute and persist averageRating + reviewCount on the product
    const agg = await prisma.productReview.aggregate({
      where: { productId: req.params.id },
      _avg: { rating: true },
      _count: { rating: true },
    });
    await prisma.product.update({
      where: { id: req.params.id },
      data: {
        averageRating: Math.round((agg._avg.rating ?? 0) * 10) / 10,
        reviewCount: agg._count.rating,
      },
    });

    res.status(201).json({
      success: true,
      message: 'Review added successfully',
      data: review
    });
  } catch (error) {
    next(error);
  }
});

// Get product reviews
router.get('/:id/reviews', authenticate, async (req, res, next) => {
  try {
    const { page = 1, limit = 20 } = req.query;
    const skip = (page - 1) * limit;
    
    const [reviews, total] = await Promise.all([
      prisma.productReview.findMany({
        where: { productId: req.params.id },
        include: {
          user: { select: { id: true, fullName: true, profileImage: true } }
        },
        orderBy: { createdAt: 'desc' },
        skip,
        take: parseInt(limit)
      }),
      prisma.productReview.count({
        where: { productId: req.params.id }
      })
    ]);
    
    res.json({
      success: true,
      data: reviews,
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

// Get product categories
router.get('/categories/list', authenticate, async (req, res) => {
  const categories = [
    { id: 'ORGANIC_FERTILIZER', name: 'Organic Fertilizer', icon: '🌱' },
    { id: 'PROTEIN_FEED', name: 'Protein Feed', icon: '🐓' },
    { id: 'INSECT_OIL', name: 'Insect Oil', icon: '🪲' },
    { id: 'SOIL_CONDITIONER', name: 'Soil Conditioner', icon: '🌍' },
    { id: 'FRESH_LARVAE', name: 'Fresh Larvae', icon: '🐛' },
    { id: 'DRIED_LARVAE', name: 'Dried Larvae', icon: '🐛' },
    { id: 'COMPOST', name: 'Compost', icon: '🗑️' },
    { id: 'LIQUID_FERTILIZER', name: 'Liquid Fertilizer', icon: '💧' },
    { id: 'BIOCHAR', name: 'Biochar', icon: '🔥' },
    { id: 'OTHER', name: 'Other', icon: '📦' }
  ];
  
  res.json({ success: true, data: categories });
});

/**
 * GET /api/products/:id/traceability
 * Returns the full production cycle for a BSF-batch product so the client
 * can embed it in a QR code.  Non-BSF products get a minimal payload.
 */
router.get('/:id/traceability', authenticate, async (req, res, next) => {
  try {
    await assertProductAccess(req.params.id, req);

    const product = await prisma.product.findUnique({
      where: { id: req.params.id },
      include: {
        variants: { where: { isActive: true } },
        farm:     { select: { id: true, name: true, region: true } },
      },
    });

    if (!product) throw new AppError('Product not found', 404);

    // Tags: ['BSF', <productName>, <batchNumber>] — set during approval
    const batchNumber = product.tags?.find(
      (t) => t !== 'BSF' && !['Frass Fertilizer', 'Prepupae', 'BSF Larvae', 'BSF Meal', 'BSF Oil', 'Live Larvae (recycled)'].includes(t),
    );

    let cycle = null;

    if (batchNumber) {
      const batch = await prisma.processingBatch.findUnique({
        where: { batchNumber },
        include: {
          farm:         { select: { id: true, name: true, region: true } },
          createdBy:    { select: { id: true, fullName: true } },
          wasteRecords: {
            orderBy: { date: 'asc' },
            select: {
              id: true, sourceName: true, sourceType: true,
              quantity: true, unit: true, date: true,
              carbonSaved: true, methanePrevented: true,
            },
          },
          activityLogs: {
            include: { performedBy: { select: { id: true, fullName: true } } },
            orderBy: { timestamp: 'asc' },
            take: 200,
          },
          qualityChecks: {
            orderBy: { checkedAt: 'desc' },
            take: 5,
            select: { checkType: true, parameter: true, value: true, unit: true, passed: true, notes: true, checkedAt: true },
          },
        },
      });

      if (batch) {
        // Gather stage transitions
        const stages = batch.activityLogs
          .filter((l) => l.action === 'NOTE_ADDED' && l.metadata?.type === 'STAGE_TRANSITION')
          .map((l) => ({
            stage:     l.metadata.stageNumber,
            name:      l.metadata.stageName ?? `Stage ${l.metadata.stageNumber}`,
            date:      l.timestamp,
            recordedBy: l.performedBy?.fullName ?? null,
          }))
          .sort((a, b) => a.stage - b.stage);

        // Extract harvest. The Stage 4 entry log holds the Larvae Rearing form
        // data, while the harvest figures live on the log created when the
        // Harvesting stage is completed — reuse the shared extractor, which
        // picks the entry that actually carries harvest data.
        const h = extractHarvest(batch.activityLogs);
        const harvest = h ? {
          bsfLarvaeKg: h.harvestBsfLarvae ?? h.larvaeHarvested ?? null,
          frassKg:     h.harvestFrass     ?? null,
          prepupaeKg:  h.harvestPrepupae  ?? null,
          recycledKg:  h.harvestRecycled  ?? null,
          totalKg:     h.harvestTotalKg   ?? null,
        } : null;

        // Extract output
        const outputLog = batch.activityLogs.find(
          (l) => l.action === 'OUTPUT_RECORDED' && (
            l.metadata?.bsfLarvaeKg != null ||
            l.metadata?.frassFertilizerKg != null ||
            l.metadata?.bsfMealKg != null ||
            l.metadata?.bsfOilKg != null ||
            l.metadata?.prepupaeWeight != null
          ),
        );
        const segLog = batch.activityLogs.find(
          (l) => l.action === 'NOTE_ADDED' && l.metadata?.type === 'SEGREGATION_OUTPUT',
        );
        const rawOutput = outputLog?.metadata ?? segLog?.metadata?.products ?? null;
        const output = rawOutput ? {
          bsfLarvaeKg:       rawOutput.bsfLarvaeKg       ?? rawOutput['BSF Larvae']               ?? null,
          bsfMealKg:         rawOutput.bsfMealKg         ?? rawOutput['BSF Meal']                  ?? null,
          bsfOilKg:          rawOutput.bsfOilKg          ?? rawOutput['BSF Oil']                   ?? null,
          frassFertilizerKg: rawOutput.frassFertilizerKg ?? rawOutput['Frass Fertilizer']          ?? null,
          prepupaeKg:        rawOutput.prepupaeWeight     ?? rawOutput['Prepupae']                  ?? null,
          recycledLarvaeKg:  rawOutput.recycledLarvaeKg  ?? rawOutput['Live Larvae (recycled)']    ?? null,
          totalKg:           rawOutput.totalOutputKg     ?? null,
        } : null;

        // Find bagging record for this specific product
        const bsfProductName = product.tags?.find((t) =>
          ['Frass Fertilizer', 'Prepupae', 'BSF Larvae', 'BSF Meal', 'BSF Oil', 'Live Larvae (recycled)'].includes(t),
        ) ?? null;
        const baggingLogs = batch.activityLogs.filter(
          (l) =>
            l.action === 'NOTE_ADDED' &&
            l.metadata?.type === 'BAGGING_RECORD' &&
            (!bsfProductName || l.metadata?.product === bsfProductName) &&
            l.metadata?.productId === product.id,
        );
        const bagging = baggingLogs.length > 0 ? {
          product:      baggingLogs[0].metadata.product,
          totalKg:      baggingLogs.reduce((s, l) => s + (l.metadata.baggedKg ?? 0), 0),
          totalBags:    baggingLogs.reduce((s, l) => s + (l.metadata.bagCount ?? 0), 0),
          costPrice:    baggingLogs[0].metadata.costPrice    ?? null,
          sellingPrice: baggingLogs[0].metadata.sellingPrice ?? null,
          approvedBy:   baggingLogs[0].metadata.approvedBy   ?? null,
          approvedAt:   baggingLogs[0].metadata.approvedAt   ?? null,
        } : null;

        // ── Input (organic waste) ──────────────────────────────────────────
        // Waste batches link their waste records directly. Lifecycle batches
        // (LC-) receive waste through the Larvae Rearing (Stage 3) feed form, so
        // fall back to the recorded feed sources when no waste records are
        // attached — otherwise the input would show as 0 kg.
        let inputTotalKg = batch.wasteRecords.reduce((s, w) => s + (w.quantity ?? 0), 0);
        let inputSources = batch.wasteRecords.map((w) => ({
          name:        w.sourceName,
          type:        w.sourceType,
          qty:         w.quantity,
          unit:        w.unit,
          date:        w.date,
          carbonSaved: w.carbonSaved,
        }));

        if (inputTotalKg <= 0) {
          // Newest feed entry wins (activity logs are ordered ascending).
          const feedLog = [...batch.activityLogs].reverse().find(
            (l) =>
              l.action === 'NOTE_ADDED' &&
              l.metadata &&
              (l.metadata.feedBatchId || l.metadata.feedBatchNumber || l.metadata.feedSources),
          );

          if (feedLog) {
            const rawSources = Array.isArray(feedLog.metadata.feedSources)
              ? feedLog.metadata.feedSources
              : [];
            const feedList = rawSources.length > 0
              ? rawSources
                  .map((f) => ({
                    batchId: f && f.batchId ? String(f.batchId) : null,
                    name:    f && f.batchNumber ? String(f.batchNumber) : 'Waste batch',
                    qty:     Number(f && f.quantity) || 0,
                  }))
                  .filter((f) => f.qty > 0)
              : (Number(feedLog.metadata.feedAdded) > 0
                  ? [{
                      batchId: feedLog.metadata.feedBatchId
                        ? String(feedLog.metadata.feedBatchId)
                        : null,
                      name:    feedLog.metadata.feedBatchNumber
                        ? String(feedLog.metadata.feedBatchNumber)
                        : 'Waste batch',
                      qty:     Number(feedLog.metadata.feedAdded) || 0,
                    }]
                  : []);

            // Best effort: prorate the CO₂ prevented from each source waste
            // batch onto the amount actually fed from it.
            const carbonPerKg = new Map();
            const feedBatchIds = feedList.map((f) => f.batchId).filter(Boolean);
            if (feedBatchIds.length > 0) {
              const feedBatches = await prisma.processingBatch.findMany({
                where: { id: { in: feedBatchIds } },
                select: {
                  id: true,
                  wasteRecords: { select: { quantity: true, carbonSaved: true } },
                },
              });
              for (const fb of feedBatches) {
                const qty    = fb.wasteRecords.reduce((s, w) => s + (w.quantity ?? 0), 0);
                const carbon = fb.wasteRecords.reduce((s, w) => s + (w.carbonSaved ?? 0), 0);
                if (qty > 0 && carbon > 0) carbonPerKg.set(fb.id, carbon / qty);
              }
            }

            inputTotalKg = feedList.reduce((s, f) => s + f.qty, 0);
            inputSources = feedList.map((f) => ({
              name:        f.name,
              type:        'FEED_SOURCE',
              qty:         f.qty,
              unit:        'kg',
              date:        feedLog.timestamp,
              carbonSaved: f.batchId && carbonPerKg.has(f.batchId)
                ? Math.round(f.qty * carbonPerKg.get(f.batchId) * 100) / 100
                : null,
            }));
          }
        }

        cycle = {
          batchNumber:    batch.batchNumber,
          processType:    batch.processType,
          startDate:      batch.startDate,
          completedAt:    batch.completedAt,
          farm:           batch.farm ?? product.farm,
          createdBy:      batch.createdBy?.fullName ?? null,
          input: {
            totalKg: inputTotalKg,
            sources:  inputSources,
          },
          stages,
          processing: {
            temperature:     batch.temperature,
            moisture:        batch.moistureContent,
            ph:              batch.phLevel,
            qualityScore:    batch.qualityScore,
            conversionRate:  batch.conversionRate,
            efficiency:      batch.processingEfficiency,
          },
          harvest,
          output,
          bagging,
          qualityChecks: batch.qualityChecks,
        };
      }
    }

    // Build the compact payload that goes into the QR code
    const qrPayload = {
      id:       product.id,
      name:     product.name,
      category: product.category,
      farm:     cycle?.farm?.name ?? product.farm?.name ?? null,
      batch:    cycle?.batchNumber ?? null,
      process:  cycle?.processType ?? null,
      start:    cycle?.startDate   ?? null,
      done:     cycle?.completedAt ?? null,
      inputKg:  cycle?.input?.totalKg ?? null,
      outputKg: cycle?.output?.totalKg ?? cycle?.bagging?.totalKg ?? null,
      baggedKg: cycle?.bagging?.totalKg ?? null,
      bags:     cycle?.bagging?.totalBags ?? null,
      price:    product.variants?.[0]?.price ?? null,
      stages:   cycle?.stages?.length ?? null,
      quality:  cycle?.processing?.qualityScore ?? null,
      ver:      '1',
    };

    res.json({
      success: true,
      data: {
        product: {
          id:       product.id,
          name:     product.name,
          category: product.category,
          tags:     product.tags,
          variants: product.variants,
          farm:     product.farm,
        },
        cycle,
        qrPayload,
      },
    });
  } catch (error) {
    next(error);
  }
});

module.exports = router;