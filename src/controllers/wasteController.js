const { prisma } = require('../config/database');
const { AppError } = require('../middleware/errorHandler');
const { calculatePagination } = require('../utils/helpers');
const { calculateCarbonSavings } = require('../services/carbonService');

class WasteController {
  // Get waste records
  async getWasteRecords(req, res, next) {
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
      
      const { skip, pagination } = calculatePagination(page, limit, 0);
      
      const [wasteRecords, total] = await Promise.all([
        prisma.wasteRecord.findMany({
          where,
          include: {
            farm: { select: { id: true, name: true } },
            recordedBy: { select: { id: true, fullName: true, email: true } },
            supplier: { select: { id: true, fullName: true, email: true } },
            driver: { select: { id: true, fullName: true, email: true } },
            processingBatch: { select: { id: true, batchNumber: true, status: true } }
          },
          orderBy: { date: 'desc' },
          skip,
          take: pagination.limit
        }),
        prisma.wasteRecord.count({ where })
      ]);
      
      pagination.total = total;
      pagination.pages = Math.ceil(total / pagination.limit);
      
      res.json({ success: true, data: wasteRecords, pagination });
    } catch (error) {
      next(error);
    }
  }

  // Create waste record
  async createWasteRecord(req, res, next) {
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
      
      const carbonSaved = await calculateCarbonSavings(quantity, sourceType);
      
      let finalFarmId = farmId;
      if (req.user.role === 'MANAGER' && req.user.farmId) {
        finalFarmId = req.user.farmId;
      }
      
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
          images: req.body.images || []
        },
        include: {
          farm: true,
          recordedBy: { select: { id: true, fullName: true, email: true } }
        }
      });
      
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

      res.status(201).json({ success: true, data: wasteRecord });
    } catch (error) {
      next(error);
    }
  }

  // Get waste record by ID
  async getWasteRecordById(req, res, next) {
    try {
      const wasteRecord = await prisma.wasteRecord.findUnique({
        where: { id: req.params.id },
        include: {
          farm: true,
          recordedBy: { select: { id: true, fullName: true, email: true, phoneNumber: true } },
          supplier: { select: { id: true, fullName: true, email: true, phoneNumber: true } },
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
  }

  // Update waste record
  async updateWasteRecord(req, res, next) {
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
  }

  // Delete waste record
  async deleteWasteRecord(req, res, next) {
    try {
      const wasteRecord = await prisma.wasteRecord.findUnique({
        where: { id: req.params.id }
      });
      
      if (!wasteRecord) {
        throw new AppError('Waste record not found', 404);
      }
      
      await prisma.wasteRecord.delete({ where: { id: req.params.id } });
      
      await Promise.all([
        wasteRecord.farmId
          ? prisma.farm.update({
              where: { id: wasteRecord.farmId },
              data: { totalWasteCollected: { decrement: wasteRecord.quantity } },
            })
          : Promise.resolve(),
        wasteRecord.supplierId
          ? prisma.supplierProfile.updateMany({
              where: { userId: wasteRecord.supplierId },
              data: { totalWasteSupplied: { decrement: wasteRecord.quantity } },
            })
          : Promise.resolve(),
      ]);

      res.json({ success: true, message: 'Waste record deleted successfully' });
    } catch (error) {
      next(error);
    }
  }

  // Get waste statistics
  async getWasteStats(req, res, next) {
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
        prisma.$queryRaw`
          SELECT 
            DATE(date) as day,
            SUM(quantity) as total
          FROM waste_records
          ${where.farmId ? `WHERE farm_id = ${where.farmId}` : ''}
          GROUP BY DATE(date)
          ORDER BY day DESC
          LIMIT 30
        `
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
  }

  // Assign driver to waste
  async assignDriver(req, res, next) {
    try {
      const { id } = req.params;
      const { driverId } = req.body;
      
      const wasteRecord = await prisma.wasteRecord.update({
        where: { id },
        data: { driverId, status: 'SCHEDULED' },
        include: { driver: { select: { id: true, fullName: true, email: true, phoneNumber: true } } }
      });
      
      res.json({ success: true, data: wasteRecord });
    } catch (error) {
      next(error);
    }
  }

  // Mark waste as collected (Driver)
  async markAsCollected(req, res, next) {
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
      
      res.json({ success: true, data: wasteRecord });
    } catch (error) {
      next(error);
    }
  }
}

module.exports = new WasteController();