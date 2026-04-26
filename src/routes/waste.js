const express = require('express');
const { body, validationResult } = require('express-validator');
const { prisma } = require('../config/database');
const { Prisma } = require('@prisma/client');
const { authenticate, authorize } = require('../middleware/auth');
const { AppError } = require('../middleware/errorHandler');
const carbonService = require('../services/carbonService');
const notificationService = require('../services/notificationService');
const emailService = require('../services/emailService');
const { broadcastToRole, sendToUser } = require('../sockets');

const router = express.Router();

// Helper: notify Admins and Managers for a given farm about a waste event
async function notifyAdminsAndManagers(farmId, title, message, type, metadata, socketEvent, socketPayload) {
  try {
    const managers = await prisma.user.findMany({
      where: {
        role: { in: ['ADMIN', 'MANAGER'] },
        ...(farmId ? { farmId } : {})
      },
      select: { id: true, email: true, fullName: true }
    });

    const ids = managers.map((u) => u.id);
    if (ids.length) {
      await notificationService.sendBulkNotifications(ids, title, message, type, metadata);
    }

    for (const u of managers) {
      await emailService.sendEmail(
        u.email,
        title,
        `<p>Hello ${u.fullName},</p><p>${message}</p>`
      );
    }

    // Real-time socket push
    try {
      broadcastToRole('ADMIN', socketEvent, socketPayload);
      broadcastToRole('MANAGER', socketEvent, socketPayload);
    } catch (_) { /* socket may not be initialised yet */ }
  } catch (err) {
    // Non-fatal — log but don't block the primary response
    const logger = require('../utils/logger');
    logger.error('notifyAdminsAndManagers error:', err);
  }
}

// Get waste records
router.get('/', authenticate, async (req, res, next) => {
  try {
    const { farmId, status, sourceType, startDate, endDate, page = 1, limit = 20 } = req.query;
    const where = {};
    
    if (farmId) where.farmId = farmId;
    if (status) where.status = status;
    if (sourceType) where.sourceType = sourceType;
    
    if (startDate || endDate) {
      where.date = {};
      if (startDate) where.date.gte = new Date(startDate);
      if (endDate) where.date.lte = new Date(endDate);
    }
    
    if (req.user.role === 'MANAGER' && req.user.farmId) {
      where.farmId = req.user.farmId;
    } else if (req.user.role === 'SUPPLIER') {
      where.supplierId = req.user.id;
    } else if (req.user.role === 'DRIVER') {
      where.driverId = req.user.id;
    }
    
    const skip = (page - 1) * limit;
    
    const [wasteRecords, total] = await Promise.all([
      prisma.wasteRecord.findMany({
        where,
        include: {
          farm: {
            select: {
              id: true,
              name: true,
              location: true,
              city: true,
              region: true,
              country: true,
              postalCode: true,
            },
          },
          recordedBy: { select: { id: true, fullName: true, email: true } },
          supplier: {
            select: {
              id: true,
              fullName: true,
              email: true,
              phoneNumber: true,
              supplierProfile: { select: { collectionAddress: true } },
            },
          },
          driver: { select: { id: true, fullName: true, email: true } },
          processingBatch: { select: { id: true, batchNumber: true, status: true } }
        },
        orderBy: { date: 'desc' },
        skip,
        take: parseInt(limit)
      }),
      prisma.wasteRecord.count({ where })
    ]);
    
    res.json({
      success: true,
      data: wasteRecords,
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

// Create waste record
router.post('/', authenticate, [
  body('sourceName').notEmpty().withMessage('Source name is required'),
  body('sourceType').isIn(['AGRICULTURAL', 'FOOD_WASTE', 'MARKET_WASTE', 'HOUSEHOLD', 'INDUSTRIAL', 'MUNICIPAL', 'COMMERCIAL', 'BREWERY', 'OTHER']),  
  body('quantity').isFloat({ gt: 0 }).withMessage('Quantity must be greater than 0'),
  body('date').isISO8601().withMessage('Valid date is required')
], async (req, res, next) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({ success: false, errors: errors.array() });
  }

  try {
    const {
      sourceName,
      sourceType,
      quantity,
      unit = 'kg',
      date,
      description,
      location,
      farmId,
      supplierId,
      notes
    } = req.body;
    
    // Map BREWERY to COMMERCIAL (Prisma enum doesn't include BREWERY)
    const prismaSourceType = sourceType === 'BREWERY' ? 'COMMERCIAL' : sourceType;

    const carbonSaved = await carbonService.calculateCarbonSavings(quantity, prismaSourceType);
    
    let finalFarmId = farmId;
    // For MANAGER: if no farmId provided, default to their assigned farm
    if (req.user.role === 'MANAGER' && !finalFarmId && req.user.farmId) {
      finalFarmId = req.user.farmId;
    }
    // Admin/Manager recording on behalf of a supplier: status starts as COLLECTED
    // so it doesn't need driver pickup — it's already been physically received
    const isManualEntry = ['SUPER_ADMIN', 'ADMIN', 'MANAGER'].includes(req.user.role);

    const wasteRecord = await prisma.wasteRecord.create({
      data: {
        sourceName,
        sourceType: prismaSourceType,
        quantity: parseFloat(quantity),
        unit,
        date: new Date(date),
        status: isManualEntry ? 'COLLECTED' : 'PENDING',
        description,
        location,
        farmId: finalFarmId,
        supplierId: supplierId || (req.user.role === 'SUPPLIER' ? req.user.id : null),
        recordedById: req.user.id,
        carbonSaved,
        notes,
        images: req.body.images || []
      },
      include: {
        farm: true,
        recordedBy: { select: { id: true, fullName: true, email: true } }
      }
    });
    
    if (finalFarmId) {
      await prisma.farm.updateMany({
        where: { id: finalFarmId },
        data: { totalWasteCollected: { increment: wasteRecord.quantity } }
      });
    }

    // Notify Admins and Managers about the new submission
    await notifyAdminsAndManagers(
      finalFarmId,
      'New Waste Submission',
      `${req.user.fullName || 'A supplier'} submitted ${wasteRecord.quantity} ${wasteRecord.unit} of ${wasteRecord.sourceType} waste from "${wasteRecord.sourceName}".`,
      'WASTE_COLLECTION',
      { wasteRecordId: wasteRecord.id },
      'waste:new',
      { wasteRecord }
    );

    res.status(201).json({ success: true, data: wasteRecord });
  } catch (error) {
    next(error);
  }
});

// Get waste record by ID
router.get('/:id', authenticate, async (req, res, next) => {
  try {
    const wasteRecord = await prisma.wasteRecord.findUnique({
      where: { id: req.params.id },
      include: {
        farm: true,
        recordedBy: { select: { id: true, fullName: true, email: true, phoneNumber: true } },
        supplier: {
          select: {
            id: true,
            fullName: true,
            email: true,
            phoneNumber: true,
            supplierProfile: { select: { collectionAddress: true } },
          },
        },
        driver: { select: { id: true, fullName: true, email: true, phoneNumber: true } },
        processingBatch: true
      }
    });
    
    if (!wasteRecord) {
      throw new AppError('Waste record not found', 404);
    }
    
    res.json({ success: true, data: wasteRecord });
  } catch (error) {
    next(error);
  }
});

// Update waste record
router.put('/:id', authenticate, async (req, res, next) => {
  try {
    const updateData = { ...req.body };
    
    if (updateData.quantity) updateData.quantity = parseFloat(updateData.quantity);
    if (updateData.date) updateData.date = new Date(updateData.date);
    if (updateData.carbonSaved) updateData.carbonSaved = parseFloat(updateData.carbonSaved);
    
    const wasteRecord = await prisma.wasteRecord.update({
      where: { id: req.params.id },
      data: updateData,
      include: { farm: true }
    });
    
    res.json({ success: true, data: wasteRecord });
  } catch (error) {
    next(error);
  }
});

// Delete waste record
router.delete('/:id', authenticate, async (req, res, next) => {
  try {
    const wasteRecord = await prisma.wasteRecord.findUnique({
      where: { id: req.params.id }
    });
    
    if (!wasteRecord) {
      throw new AppError('Waste record not found', 404);
    }
    
    await prisma.wasteRecord.delete({ where: { id: req.params.id } });
    
    if (wasteRecord.farmId) {
      await prisma.farm.update({
        where: { id: wasteRecord.farmId },
        data: { totalWasteCollected: { decrement: wasteRecord.quantity } }
      });
    }
    
    res.json({ success: true, message: 'Waste record deleted successfully' });
  } catch (error) {
    next(error);
  }
});

// Get waste statistics
router.get('/summary/stats', authenticate, async (req, res, next) => {
  try {
    let where = {};
    
    if (req.user.role === 'MANAGER' && req.user.farmId) {
      where.farmId = req.user.farmId;
    } else if (req.user.role === 'SUPPLIER') {
      where.supplierId = req.user.id;
    }
    
    const [stats, bySourceType, byStatus, dailyStats] = await Promise.all([
      prisma.wasteRecord.aggregate({
        where,
        _sum: { quantity: true, carbonSaved: true },
        _count: true,
        _avg: { quantity: true }
      }),
      prisma.wasteRecord.groupBy({
        by: ['sourceType'],
        where,
        _sum: { quantity: true },
        _count: true
      }),
      prisma.wasteRecord.groupBy({
        by: ['status'],
        where,
        _count: true
      }),
(async () => {
        const whereClause = where.farmId
          ? Prisma.sql`WHERE "farmId" = ${where.farmId}`
          : Prisma.empty;
        const rows = await prisma.$queryRaw`
          SELECT 
            DATE(date) as day,
            SUM(quantity)::float8 as total
          FROM "WasteRecord"
          ${whereClause}
          GROUP BY DATE(date)
          ORDER BY day DESC
          LIMIT 30
        `;
        return rows.map((r) => ({ day: r.day, total: Number(r.total) }));
      })()
    ]);
    
    res.json({
      success: true,
      data: {
        totalWaste: stats._sum.quantity || 0,
        totalCarbonSaved: stats._sum.carbonSaved || 0,
        totalRecords: stats._count,
        averageQuantity: stats._avg.quantity || 0,
        bySourceType,
        byStatus,
        dailyStats
      }
    });
  } catch (error) {
    next(error);
  }
});

// Assign driver to waste
router.patch('/:id/assign-driver', authenticate, authorize('ADMIN', 'MANAGER'), [
  body('driverId').notEmpty().withMessage('Driver ID is required'),
  body('vehicleId').optional({ nullable: true }).isString(),
], async (req, res, next) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({ success: false, errors: errors.array() });
  }

  try {
    const { id } = req.params;
    const { driverId, vehicleId } = req.body;

    const updateData = { driverId, status: 'SCHEDULED' };
    if (vehicleId) updateData.vehicleId = vehicleId;

    const wasteRecord = await prisma.wasteRecord.update({
      where: { id },
      data: updateData,
      include: {
        driver: { select: { id: true, fullName: true, email: true, phoneNumber: true } },
        vehicle: { select: { id: true, plateNumber: true, type: true, model: true, color: true } },
      }
    });

    // Notify supplier that a driver has been assigned
    if (wasteRecord.supplierId) {
      const driverName = wasteRecord.driver?.fullName || 'A driver';
      const vehicleInfo = wasteRecord.vehicle?.plateNumber ? ` (${wasteRecord.vehicle.plateNumber})` : '';
      await notificationService.createNotification(
        wasteRecord.supplierId,
        'Driver Assigned 🚗',
        `${driverName}${vehicleInfo} has been assigned to collect your waste from "${wasteRecord.sourceName}". They will arrive shortly.`,
        'WASTE_COLLECTION',
        { wasteRecordId: wasteRecord.id }
      );
      try { sendToUser(wasteRecord.supplierId, 'waste:driver_assigned', { wasteRecord }); } catch (_) {}
    }

    // Notify the assigned driver about the new pickup job
    if (driverId) {
      const vehicleLabel = wasteRecord.vehicle?.plateNumber ? ` with vehicle ${wasteRecord.vehicle.plateNumber}` : '';
      await notificationService.createNotification(
        driverId,
        'New Pickup Assigned 📦',
        `You have been assigned to collect ${wasteRecord.quantity} ${wasteRecord.unit} of waste from "${wasteRecord.sourceName}"${vehicleLabel}. Please proceed to the pickup location.`,
        'WASTE_COLLECTION',
        { wasteRecordId: wasteRecord.id }
      );
      try { sendToUser(driverId, 'waste:driver_assigned', { wasteRecord }); } catch (_) {}
    }

    res.json({ success: true, data: wasteRecord });
  } catch (error) {
    next(error);
  }
});

// Mark waste as collected (Driver)
router.patch('/:id/collect', authenticate, authorize('DRIVER'), async (req, res, next) => {
  try {
    const { id } = req.params;
    const { notes, images } = req.body;
    
    const wasteRecord = await prisma.wasteRecord.update({
      where: { id, driverId: req.user.id },
      data: {
        status: 'COLLECTED',
        notes,
        images: images ? { push: images } : undefined
      }
    });

    await notifyAdminsAndManagers(
      wasteRecord.farmId,
      'Waste Collected by Driver',
      `Driver ${req.user.fullName || req.user.id} has collected ${wasteRecord.quantity} ${wasteRecord.unit} from "${wasteRecord.sourceName}".`,
      'WASTE_COLLECTION',
      { wasteRecordId: wasteRecord.id },
      'waste:collected',
      { wasteRecord }
    );

    // Notify supplier that their waste has been collected
    if (wasteRecord.supplierId) {
      await notificationService.createNotification(
        wasteRecord.supplierId,
        'Waste Collected ✅',
        `Your waste (${wasteRecord.quantity} ${wasteRecord.unit}) from "${wasteRecord.sourceName}" has been collected by the driver and is on its way to the processing center.`,
        'WASTE_COLLECTION',
        { wasteRecordId: wasteRecord.id }
      );
      try { sendToUser(wasteRecord.supplierId, 'waste:collected', { wasteRecord }); } catch (_) {}
    }

    res.json({ success: true, data: wasteRecord });
  } catch (error) {
    next(error);
  }
});

// Mark waste as delivered to processing center (Driver)
router.patch('/:id/deliver', authenticate, authorize('DRIVER'), async (req, res, next) => {
  try {
    const { id } = req.params;
    const { notes } = req.body;

    const wasteRecord = await prisma.wasteRecord.update({
      where: { id, driverId: req.user.id },
      data: {
        status: 'PROCESSING',
        notes: notes || undefined,
      },
    });

    await notifyAdminsAndManagers(
      wasteRecord.farmId,
      'Waste Delivered to Processing',
      `Driver ${req.user.fullName || req.user.id} has delivered ${wasteRecord.quantity} ${wasteRecord.unit} from "${wasteRecord.sourceName}" to the processing center.`,
      'WASTE_COLLECTION',
      { wasteRecordId: wasteRecord.id },
      'waste:delivered',
      { wasteRecord }
    );

    // Notify supplier that their waste has been delivered to the processing center
    if (wasteRecord.supplierId) {
      await notificationService.createNotification(
        wasteRecord.supplierId,
        'Waste Delivered to Processing 🏭',
        `Your waste (${wasteRecord.quantity} ${wasteRecord.unit}) from "${wasteRecord.sourceName}" has been delivered to the processing center.`,
        'WASTE_COLLECTION',
        { wasteRecordId: wasteRecord.id }
      );
      try { sendToUser(wasteRecord.supplierId, 'waste:delivered_processing', { wasteRecord }); } catch (_) {}
    }

    // Notify the driver confirming their delivery was logged
    await notificationService.createNotification(
      req.user.id,
      'Delivery Logged ✅',
      `Your delivery of ${wasteRecord.quantity} ${wasteRecord.unit} from "${wasteRecord.sourceName}" has been logged at the processing center. Awaiting verification.`,
      'WASTE_COLLECTION',
      { wasteRecordId: wasteRecord.id }
    );
    try { sendToUser(req.user.id, 'waste:delivery_logged', { wasteRecord }); } catch (_) {}

    res.json({ success: true, data: wasteRecord });
  } catch (error) {
    next(error);
  }
});

// Acknowledge receipt of delivery (Admin / Manager / Super Admin)
router.patch('/:id/acknowledge', authenticate, authorize('ADMIN', 'MANAGER', 'SUPER_ADMIN'), async (req, res, next) => {
  try {
    const { id } = req.params;
    const { notes } = req.body;

    const existing = await prisma.wasteRecord.findUnique({ where: { id } });
    if (!existing) throw new AppError('Waste record not found', 404);
    if (existing.status !== 'PROCESSING') {
      throw new AppError('Only waste records in PROCESSING status can be marked as delivered', 400);
    }

    const wasteRecord = await prisma.wasteRecord.update({
      where: { id },
      data: { status: 'ACKNOWLEDGED', notes: notes || undefined },
    });

    // Notify supplier that their delivery has been confirmed
    if (wasteRecord.supplierId) {
      await notificationService.createNotification(
        wasteRecord.supplierId,
        'Delivery Confirmed 🎉',
        `Your waste (${wasteRecord.quantity} ${wasteRecord.unit}) from "${wasteRecord.sourceName}" has been received and verified. Thank you!`,
        'WASTE_COLLECTION',
        { wasteRecordId: wasteRecord.id }
      );
      try { sendToUser(wasteRecord.supplierId, 'waste:acknowledged', { wasteRecord }); } catch (_) {}
    }

    // ─── Award points to the supplier ────────────────────────────────────────
    if (wasteRecord.supplierId) {
      try {
        const rateSetting = await prisma.systemSetting.findUnique({ where: { key: 'waste_points_rate' } });
        const pointsPerKg = rateSetting ? Number(rateSetting.value) : 0;
        if (pointsPerKg > 0 && wasteRecord.quantity > 0) {
          const pointsToAward = Math.round(wasteRecord.quantity * pointsPerKg);
          await Promise.all([
            prisma.supplierProfile.update({
              where: { userId: wasteRecord.supplierId },
              data: {
                pointsBalance: { increment: pointsToAward },
                pointsEarned:  { increment: pointsToAward },
              },
            }),
            prisma.wasteRecord.update({
              where: { id },
              data: { pointsAwarded: pointsToAward },
            }),
          ]);
          await notificationService.createNotification(
            wasteRecord.supplierId,
            'Points Earned! 🎉',
            `You earned ${pointsToAward} point${pointsToAward === 1 ? '' : 's'} for supplying ${wasteRecord.quantity} ${wasteRecord.unit} of waste.`,
            'WASTE_COLLECTION',
            { wasteRecordId: wasteRecord.id, pointsAwarded: pointsToAward }
          );
          try { sendToUser(wasteRecord.supplierId, 'points:awarded', { pointsAwarded: pointsToAward, wasteRecordId: wasteRecord.id }); } catch (_) {}
        }
      } catch (pointsError) {
        // Non-fatal: log but don't fail the acknowledgement
        logger.error('Failed to award points for waste record', wasteRecord.id, pointsError.message);
      }
    }
    // ─────────────────────────────────────────────────────────────────────────

    // Notify the assigned driver that the delivery has been verified
    if (wasteRecord.driverId) {
      await notificationService.createNotification(
        wasteRecord.driverId,
        'Delivery Verified 🎉',
        `Your delivery of ${wasteRecord.quantity} ${wasteRecord.unit} from "${wasteRecord.sourceName}" has been verified and confirmed by the processing center. Great work!`,
        'WASTE_COLLECTION',
        { wasteRecordId: wasteRecord.id }
      );
      try { sendToUser(wasteRecord.driverId, 'waste:acknowledged', { wasteRecord }); } catch (_) {}
    }

    try {
      broadcastToRole('ADMIN', 'waste:acknowledged', { wasteRecord });
      broadcastToRole('MANAGER', 'waste:acknowledged', { wasteRecord });
    } catch (_) {}

    res.json({ success: true, data: wasteRecord });
  } catch (error) {
    next(error);
  }
});

// Mark waste delivery as no-show (Admin / Manager / Super Admin)
router.patch('/:id/no-show', authenticate, authorize('ADMIN', 'MANAGER', 'SUPER_ADMIN'), async (req, res, next) => {
  try {
    const { id } = req.params;
    const { notes } = req.body;

    const existing = await prisma.wasteRecord.findUnique({ where: { id } });
    if (!existing) throw new AppError('Waste record not found', 404);
    if (!['PROCESSING', 'COLLECTED'].includes(existing.status)) {
      throw new AppError('Only PROCESSING or COLLECTED waste records can be marked as no-show', 400);
    }

    const wasteRecord = await prisma.wasteRecord.update({
      where: { id },
      data: { status: 'NO_SHOW', notes: notes || undefined },
    });

    // Notify the assigned driver if any
    if (wasteRecord.driverId) {
      await notificationService.createNotification(
        wasteRecord.driverId,
        'Delivery Marked as No-Show',
        `The delivery of ${wasteRecord.quantity} ${wasteRecord.unit} from "${wasteRecord.sourceName}" has been marked as no-show.`,
        'WASTE_COLLECTION',
        { wasteRecordId: wasteRecord.id }
      );
      try { sendToUser(wasteRecord.driverId, 'waste:no-show', { wasteRecord }); } catch (_) {}
    }

    try {
      broadcastToRole('ADMIN', 'waste:no-show', { wasteRecord });
      broadcastToRole('MANAGER', 'waste:no-show', { wasteRecord });
    } catch (_) {}

    res.json({ success: true, data: wasteRecord });
  } catch (error) {
    next(error);
  }
});

module.exports = router;