const express = require('express');
const { body, validationResult } = require('express-validator');
const { prisma } = require('../config/database');
const { authenticate, authorize, authorizeFarmAccess } = require('../middleware/auth');
const { AppError } = require('../middleware/errorHandler');
const { generateBatchNumber } = require('../utils/helpers');

const router = express.Router();

// Get all supplier organizations
router.get('/supplier-orgs', authenticate, authorize('SUPER_ADMIN', 'ADMIN', 'MANAGER'), async (req, res, next) => {
  try {
    const where = {};
    if (req.user.role === 'ADMIN') {
      where.adminId = req.user.adminManaged?.id;
    }
    const profiles = await prisma.supplierProfile.findMany({
      where,
      include: {
        user: { select: { id: true, fullName: true, email: true, phoneNumber: true, status: true, createdAt: true } },
      },
      orderBy: { user: { createdAt: 'desc' } },
    });
    res.json({ success: true, data: profiles });
  } catch (error) {
    next(error);
  }
});

// Get all farms
router.get('/', authenticate, async (req, res, next) => {
  try {
    const { status, type, region, page = 1, limit = 20 } = req.query;
    const where = {};
    
    if (status) where.status = status;
    if (type) where.type = type;
    if (region) where.region = { contains: region, mode: 'insensitive' };
    
    if (req.user.role === 'ADMIN') {
      where.adminId = req.user.adminManaged?.id;
    } else if (req.user.role === 'MANAGER') {
      where.id = req.user.farmId;
    }
    
    const skip = (page - 1) * limit;
    
    const [farms, total] = await Promise.all([
      prisma.farm.findMany({
        where,
        include: {
          manager: {
            select: { id: true, fullName: true, email: true, phoneNumber: true }
          },
          admin: {
            select: { id: true, companyName: true }
          },
          _count: {
            select: { wasteRecords: true, processingBatches: true, products: true, orders: true }
          }
        },
        skip,
        take: parseInt(limit),
        orderBy: { createdAt: 'desc' }
      }),
      prisma.farm.count({ where })
    ]);
    
    res.json({
      success: true,
      data: farms,
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

// Create farm
router.post('/', authenticate, authorize('SUPER_ADMIN', 'ADMIN', 'MANAGER'), [
  body('name').notEmpty().withMessage('Farm name is required'),
  body('type').optional().isIn(['FAMILY_FARM', 'PROFESSIONAL_FARM', 'CORPORATE_FARM', 'COOPERATIVE_FARM', 'PERSONAL_FARM', 'COMMUNITY_FARM', 'OTHER']),
  body('country').optional().isString(),
  body('region').optional().isString()
], async (req, res, next) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({ success: false, errors: errors.array() });
  }

  try {
    const {
      name,
      type,
      description,
      area,
      areaUnit,
      country,
      region,
      city,
      postalCode,
      location,
      contactName,
      contactEmail,
      contactPhone,
    } = req.body;

    // Normalise location: accept plain string or JSON object
    let locationData = null;
    if (location) {
      locationData = typeof location === 'string' ? { address: location } : location;
    }

    const farm = await prisma.farm.create({
      data: {
        name,
        type: type || 'OTHER',
        description: description || (contactName ? `Contact: ${contactName}` : null),
        area: area ? parseFloat(area) : null,
        areaUnit: areaUnit || 'hectares',
        country,
        region: region || (typeof location === 'string' ? location : null),
        city,
        postalCode,
        location: locationData,
        adminId: req.user.role === 'ADMIN' ? req.user.adminManaged?.id : null,
        // Auto-assign the creating manager as the farm manager
        managerId: req.user.role === 'MANAGER' ? req.user.id : undefined,
        status: 'ACTIVE',
        // contactName / contactEmail / contactPhone are not schema fields; stored in description or ignored
      },
      include: {
        manager: true
      }
    });
    
    res.status(201).json({ success: true, data: farm });
  } catch (error) {
    next(error);
  }
});

// Get farm by ID
router.get('/:id', authenticate, authorizeFarmAccess, async (req, res, next) => {
  try {
    const farm = await prisma.farm.findUnique({
      where: { id: req.params.id },
      include: {
        manager: {
          select: { id: true, fullName: true, email: true, phoneNumber: true, profileImage: true }
        },
        admin: {
          select: { id: true, companyName: true, email: true, phoneNumber: true }
        },
        wasteRecords: {
          orderBy: { date: 'desc' },
          take: 10
        },
        processingBatches: {
          orderBy: { startDate: 'desc' },
          take: 10,
          include: {
            _count: { select: { wasteRecords: true, activityLogs: true } }
          }
        },
        products: {
          where: { status: 'ACTIVE' },
          include: { variants: true },
          take: 10
        },
        _count: {
          select: {
            wasteRecords: true,
            processingBatches: true,
            products: true,
            orders: true
          }
        }
      }
    });
    
    if (!farm) {
      throw new AppError('Farm not found', 404);
    }
    
    res.json({ success: true, data: farm });
  } catch (error) {
    next(error);
  }
});

// Update farm
router.put('/:id', authenticate, authorize('SUPER_ADMIN', 'ADMIN', 'MANAGER'), authorizeFarmAccess, async (req, res, next) => {
  try {
    const updateData = { ...req.body };
    
    const numericFields = ['area', 'income', 'equipment', 'labor', 'output', 'expenses', 'profit'];
    numericFields.forEach(field => {
      if (updateData[field]) {
        updateData[field] = parseFloat(updateData[field]);
      }
    });
    
    const farm = await prisma.farm.update({
      where: { id: req.params.id },
      data: updateData
    });
    
    res.json({ success: true, data: farm });
  } catch (error) {
    next(error);
  }
});

// Delete farm
router.delete('/:id', authenticate, authorize('SUPER_ADMIN', 'ADMIN'), authorizeFarmAccess, async (req, res, next) => {
  try {
    await prisma.farm.delete({ where: { id: req.params.id } });
    res.json({ success: true, message: 'Farm deleted successfully' });
  } catch (error) {
    next(error);
  }
});

// Assign manager to farm
router.post('/:id/assign-manager', authenticate, authorize('SUPER_ADMIN', 'ADMIN'), authorizeFarmAccess, [
  body('managerId').notEmpty().withMessage('Manager ID is required')
], async (req, res, next) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({ success: false, errors: errors.array() });
  }

  try {
    const { id } = req.params;
    const { managerId } = req.body;
    
    const farm = await prisma.farm.update({
      where: { id },
      data: { managerId }
    });
    
    await prisma.user.update({
      where: { id: managerId },
      data: { role: 'MANAGER' }
    });
    
    res.json({ success: true, data: farm });
  } catch (error) {
    next(error);
  }
});

// Get farm statistics
router.get('/:id/stats', authenticate, authorizeFarmAccess, async (req, res, next) => {
  try {
    const { id } = req.params;
    
    const [wasteStats, processingStats, orderStats, productStats] = await Promise.all([
      prisma.wasteRecord.aggregate({
        where: { farmId: id },
        _sum: { quantity: true, carbonSaved: true },
        _count: true
      }),
      prisma.processingBatch.aggregate({
        where: { farmId: id },
        _sum: { quantity: true, liquidOutput: true, fertilizerOutput: true },
        _count: true
      }),
      prisma.order.aggregate({
        where: { farmId: id, status: 'COMPLETED' },
        _sum: { total: true },
        _count: true
      }),
      prisma.product.count({
        where: { farmId: id, status: 'ACTIVE' }
      })
    ]);
    
    // Get monthly waste data
    const monthlyWaste = await prisma.$queryRaw`
      SELECT 
        DATE_TRUNC('month', date) as month,
        SUM(quantity) as total
      FROM waste_records
      WHERE farm_id = ${id}
      GROUP BY DATE_TRUNC('month', date)
      ORDER BY month DESC
      LIMIT 12
    `;
    
    res.json({
      success: true,
      data: {
        totalWaste: wasteStats._sum.quantity || 0,
        totalCarbonSaved: wasteStats._sum.carbonSaved || 0,
        totalWasteRecords: wasteStats._count,
        totalProcessingBatches: processingStats._count,
        activeBatches: await prisma.processingBatch.count({
          where: { farmId: id, status: 'ACTIVE' }
        }),
        totalLiquidOutput: processingStats._sum.liquidOutput || 0,
        totalFertilizerOutput: processingStats._sum.fertilizerOutput || 0,
        totalRevenue: orderStats._sum.total || 0,
        totalOrders: orderStats._count,
        totalProducts: productStats,
        monthlyWaste
      }
    });
  } catch (error) {
    next(error);
  }
});

module.exports = router;