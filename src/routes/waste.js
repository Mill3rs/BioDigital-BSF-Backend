const express = require('express');
const { body, validationResult } = require('express-validator');
const { prisma } = require('../config/database');
const { Prisma } = require('@prisma/client');
const { authenticate } = require('../middleware/auth');
const { authorize } = require('../middleware/auth');
const { AppError } = require('../middleware/errorHandler');
const carbonService = require('../services/carbonService');
const notificationService = require('../services/notificationService');
const emailService = require('../services/emailService');
const { broadcastToRole, sendToUser } = require('../sockets');

const router = express.Router();

// Helper: notify admins + managers about new waste record
async function notifyAdminsAndManagers(wasteRecord) {
  try {
    const managers = await prisma.user.findMany({
      where: {
        role: { in: ['SUPER_ADMIN', 'ADMIN', 'MANAGER'] },
        status: 'ACTIVE',
      },
      select: { id: true, email: true, fullName: true },
    });

    const ids = managers.map((m) => m.id);
    const recipients = managers.map((m) => m.email).filter(Boolean);

    await Promise.allSettled([
      notificationService.create({
        userIds: ids,
        type: 'waste_submitted',
        title: 'New Waste Submission',
        message: `${wasteRecord.sourceName || 'A supplier'} submitted ${wasteRecord.quantity}kg of ${wasteRecord.sourceType} waste`,
        data: { wasteRecordId: wasteRecord.id },
      }),
      ...(wasteRecord.supplierId
        ? [sendToUser(wasteRecord.supplierId, 'waste_created', wasteRecord)]
        : []),
      ...(recipients.length
        ? [
            emailService.sendNewWasteNotification({
              recipients,
              quantity: wasteRecord.quantity,
              sourceType: wasteRecord.sourceType,
              sourceName: wasteRecord.sourceName,
              date: wasteRecord.date,
            }),
          ]
        : []),
    ]);
  } catch (err) {
    console.error('notifyAdminsAndManagers error:', err);
  }
}

// Get waste records (with pagination, filtering, role scoping)
router.get('/', authenticate, async (req, res, next) => {
  try {
    const { farmId, status, sourceType, startDate, endDate, page: rawPage = '1', limit: rawLimit = '20' } = req.query;
    const page = parseInt(rawPage, 10) || 1;
    const limit = parseInt(rawLimit, 10) || 20;
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
        take: limit,
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

// Get waste record by ID
router.get('/:id', authenticate, async (req, res, next) => {
  try {
    const wasteRecord = await prisma.wasteRecord.findUnique({
      where: { id: req.params.id },
      include: {
        farm: true,
        recordedBy: { select: { id: true, fullName: true, email: true, phoneNumber: true } },
        supplier: { select: { id: true, fullName: true, email: true, phoneNumber: true } },
        driver: { select: { id: true, fullName: true, email: true, phoneNumber: true } },
        processingBatch: true,
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

// Create waste record
router.post('/', authenticate, async (req, res, next) => {
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
      notes,
    } = req.body;

    // Validate required fields
    const errors = [];
    if (!sourceName) errors.push('Source name is required');
    if (!sourceType) errors.push('Source type is required');
    if (!quantity) errors.push('Quantity is required');
    if (!date) errors.push('Date is required');

    if (errors.length > 0) {
      return res.status(400).json({ success: false, errors });
    }

    // Allow ADMIN/SUPER_ADMIN to record waste for any supplier
    let finalFarmId = farmId;
    if (req.user.role === 'MANAGER' && req.user.farmId) {
      finalFarmId = req.user.farmId;
    }

    const carbonSaved = await carbonService.calculateCarbonSavings(
      parseFloat(quantity),
      sourceType
    );

    const wasteRecord = await prisma.wasteRecord.create({
      data: {
        sourceName,
        sourceType,
        quantity: parseFloat(quantity),
        unit,
        date: new Date(date),
        status: 'PENDING',
        description,
        location,
        farmId: finalFarmId,
        supplierId: supplierId || (req.user.role === 'SUPPLIER' ? req.user.id : null),
        recordedById: req.user.id,
        carbonSaved,
        notes,
        images: req.body.images || [],
      },
      include: {
        farm: true,
        recordedBy: { select: { id: true, fullName: true, email: true } },
      }
    });

    // Update farm total waste collected
    const finalSupplierId = wasteRecord.supplierId;
    await Promise.all([
      finalFarmId
        ? prisma.farm.update({
            where: { id: finalFarmId },
            data: { totalWasteCollected: { increment: wasteRecord.quantity } },
          })
        : Promise.resolve(),
      finalSupplierId
        ? prisma.supplierProfile.updateMany({
            where: { userId: finalSupplierId },
            data: { totalWasteSupplied: { increment: wasteRecord.quantity } },
          })
        : Promise.resolve(),
    ]);

    // Notify admins/managers
    notifyAdminsAndManagers(wasteRecord).catch(() => {});

    res.status(201).json({ success: true, data: wasteRecord });
  } catch (error) {
    next(error);
  }
});

// Update waste record
router.put('/:id', authenticate, async (req, res, next) => {
  try {
    const { id } = req.params;
    const updateData = { ...req.body };
    
    if (updateData.quantity) updateData.quantity = parseFloat(updateData.quantity);
    if (updateData.date) updateData.date = new Date(updateData.date);
    if (updateData.carbonSaved) updateData.carbonSaved = parseFloat(updateData.carbonSaved);
    
    const wasteRecord = await prisma.wasteRecord.update({
      where: { id },
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
    const { id } = req.params;
    
    const wasteRecord = await prisma.wasteRecord.findUnique({
      where: { id }
    });
    
    if (!wasteRecord) {
      throw new AppError('Waste record not found', 404);
    }
    
    await prisma.wasteRecord.delete({ where: { id } });
    
    // Update farm total
    if (wasteRecord.farmId) {
      await prisma.farm.update({
        where: { id: wasteRecord.farmId },
        data: { totalWasteCollected: { decrement: wasteRecord.quantity } },
      });
    }
    
    if (wasteRecord.supplierId) {
      await prisma.supplierProfile.updateMany({
        where: { userId: wasteRecord.supplierId },
        data: { totalWasteSupplied: { decrement: wasteRecord.quantity } },
      });
    }
    
    res.json({ success: true, message: 'Waste record deleted successfully' });
  } catch (error) {
    next(error);
  }
});

// Assign driver to waste record
router.patch('/:id/assign-driver', authenticate, async (req, res, next) => {
  try {
    const { id } = req.params;
    const { driverId } = req.body;
    
    if (!driverId) {
      throw new AppError('Driver ID is required', 400);
    }
    
    const wasteRecord = await prisma.wasteRecord.update({
      where: { id },
      data: { driverId, status: 'SCHEDULED' },
      include: {
        driver: { select: { id: true, fullName: true, email: true, phoneNumber: true } },
        vehicle: { select: { id: true, plateNumber: true, type: true, model: true, color: true } },
      }
    });
    
    // Notify driver
    try {
      const driverName = wasteRecord.driver?.fullName || 'Driver';
      const vehicleInfo = wasteRecord.vehicle
        ? `${wasteRecord.vehicle.type} ${wasteRecord.vehicle.model} (${wasteRecord.vehicle.plateNumber})`
        : 'No vehicle assigned';
      
      await notificationService.create({
        userIds: [driverId],
        type: 'waste_assigned',
        title: 'Collection Assigned',
        message: `You have been assigned to collect ${wasteRecord.quantity}kg of ${wasteRecord.sourceType} waste. ${vehicleInfo}`,
        data: { wasteRecordId: wasteRecord.id },
      });
      
      sendToUser(driverId, 'waste_assigned', wasteRecord);
    } catch (err) {
      console.error('Driver notification error:', err);
    }
    
    res.json({ success: true, data: wasteRecord });
  } catch (error) {
    next(error);
  }
});

// Mark waste as collected (Driver)
router.patch('/:id/collect', authenticate, async (req, res, next) => {
  try {
    const { id } = req.params;
    const { notes, images } = req.body;
    
    const wasteRecord = await prisma.wasteRecord.update({
      where: { id, driverId: req.user.id },
      data: {
        status: 'COLLECTED',
        notes,
        images: images ? { push: images } : undefined,
      }
    });
    
    // Notify admins
    broadcastToRole('SUPER_ADMIN', 'waste_collected', wasteRecord);
    broadcastToRole('ADMIN', 'waste_collected', wasteRecord);
    
    res.json({ success: true, data: wasteRecord });
  } catch (error) {
    next(error);
  }
});

// Acknowledge waste (ADMIN/SUPER_ADMIN)
router.patch('/:id/acknowledge', authenticate, async (req, res, next) => {
  try {
    const { id } = req.params;
    const { notes } = req.body;
    
    const wasteRecord = await prisma.wasteRecord.update({
      where: { id },
      data: { status: 'ACKNOWLEDGED', notes }
    });
    
    if (wasteRecord.supplierId) {
      sendToUser(wasteRecord.supplierId, 'waste_acknowledged', wasteRecord);
    }
    
    res.json({ success: true, data: wasteRecord });
  } catch (error) {
    next(error);
  }
});

// Mark waste as no-show (ADMIN/SUPER_ADMIN)
router.patch('/:id/no-show', authenticate, async (req, res, next) => {
  try {
    const { id } = req.params;
    const { notes } = req.body;
    
    const existing = await prisma.wasteRecord.findUnique({ where: { id } });
    if (!existing) throw new AppError('Waste record not found', 404);
    
    const wasteRecord = await prisma.wasteRecord.update({
      where: { id },
      data: { status: 'NO_SHOW', notes }
    });
    
    if (wasteRecord.supplierId) {
      sendToUser(wasteRecord.supplierId, 'waste_no_show', wasteRecord);
    }
    
    res.json({ success: true, data: wasteRecord });
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
    
    const [stats, bySourceType, byStatus] = await Promise.all([
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
      }
    });
  } catch (error) {
    next(error);
  }
});

module.exports = router;
