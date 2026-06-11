const express = require('express');
const { body, validationResult } = require('express-validator');
const { prisma } = require('../config/database');
const { authenticate, authorize } = require('../middleware/auth');
const { AppError } = require('../middleware/errorHandler');
const { uploadMultiple } = require('../middleware/upload');

const router = express.Router();

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
    
    if (search) {
      where.OR = [
        { name: { contains: search, mode: 'insensitive' } },
        { description: { contains: search, mode: 'insensitive' } },
        { tags: { has: search } }
      ];
    }
    
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
  body('category').isIn(['ORGANIC_FERTILIZER', 'PROTEIN_FEED', 'INSECT_OIL', 'SOIL_CONDITIONER', 'DRIED_LARVAE', 'COMPOST', 'LIQUID_FERTILIZER', 'BIOCHAR', 'OTHER']),
  body('variants').isArray().withMessage('At least one variant is required'),
  body('variants.*.name').notEmpty(),
  body('variants.*.quantity').isInt({ min: 0 }),
  body('variants.*.price').isFloat({ min: 0 })
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
    
    const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, '-');
    
    const product = await prisma.product.create({
      data: {
        name,
        description,
        shortDescription,
        category,
        images: images || [],
        tags: tags || [],
        slug,
        farmId: farmId || req.user.farmId,
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
    
    res.status(201).json({
      success: true,
      message: 'Product created successfully',
      data: product
    });
  } catch (error) {
    next(error);
  }
});

// Get product by ID
router.get('/:id', authenticate, async (req, res, next) => {
  try {
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
      const product = await prisma.product.findUnique({ where: { id }, select: { id: true, images: true } });
      if (!product) throw new AppError('Product not found', 404);

      const newImageUrls = (req.files || []).map((f) => {
        const relativePath = f.path.replace(/\\/g, '/');
        return `${req.protocol}://${req.get('host')}/${relativePath}`;
      });

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
    const numericFields = ['quantity', 'price', 'comparePrice', 'cost', 'unitValue', 'minOrderQuantity', 'maxOrderQuantity', 'weight'];
    const updateData = { ...req.body };
    
    numericFields.forEach(field => {
      if (updateData[field]) {
        updateData[field] = parseFloat(updateData[field]);
      }
    });
    
    const variant = await prisma.productVariant.update({
      where: { id: req.params.variantId },
      data: updateData
    });
    
    res.json({
      success: true,
      message: 'Variant updated successfully',
      data: variant
    });
  } catch (error) {
    next(error);
  }
});

// Delete product variant
router.delete('/variants/:variantId', authenticate, authorize('ADMIN'), async (req, res, next) => {
  try {
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

        // Extract harvest
        const harvestLog = batch.activityLogs.find(
          (l) => l.action === 'NOTE_ADDED' && l.metadata?.type === 'STAGE_TRANSITION' && Number(l.metadata?.stageNumber) === 4,
        );
        const harvest = harvestLog ? {
          bsfLarvaeKg:  harvestLog.metadata.harvestBsfLarvae ?? null,
          frassKg:      harvestLog.metadata.harvestFrass     ?? null,
          prepupaeKg:   harvestLog.metadata.harvestPrepupae  ?? null,
          recycledKg:   harvestLog.metadata.harvestRecycled  ?? null,
          totalKg:      harvestLog.metadata.harvestTotalKg   ?? null,
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

        const totalInput = batch.wasteRecords.reduce((s, w) => s + (w.quantity ?? 0), 0);

        cycle = {
          batchNumber:    batch.batchNumber,
          processType:    batch.processType,
          startDate:      batch.startDate,
          completedAt:    batch.completedAt,
          farm:           batch.farm ?? product.farm,
          createdBy:      batch.createdBy?.fullName ?? null,
          input: {
            totalKg: totalInput,
            sources:  batch.wasteRecords.map((w) => ({
              name:       w.sourceName,
              type:       w.sourceType,
              qty:        w.quantity,
              unit:       w.unit,
              date:       w.date,
              carbonSaved: w.carbonSaved,
            })),
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