const { prisma } = require('../config/database');
const { AppError } = require('../middleware/errorHandler');
const { calculatePagination, generateBatchNumber } = require('../utils/helpers');

class ProcessingController {
  // Get all processing batches
  async getAllBatches(req, res, next) {
    try {
      const { farmId, status, page = 1, limit = 20 } = req.query;
      const where = {};
      
      if (farmId) where.farmId = farmId;
      if (status) where.status = status;
      
      if (req.user.role === 'MANAGER' && req.user.farmId) {
        where.farmId = req.user.farmId;
      }
      
      const { skip, pagination } = calculatePagination(page, limit, 0);
      
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
          take: pagination.limit,
          orderBy: { startDate: 'desc' }
        }),
        prisma.processingBatch.count({ where })
      ]);
      
      pagination.total = total;
      pagination.pages = Math.ceil(total / pagination.limit);
      
      res.json({ success: true, data: batches, pagination });
    } catch (error) {
      next(error);
    }
  }

  // Create processing batch
  async createBatch(req, res, next) {
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
  }

  // Get batch by ID
  async getBatchById(req, res, next) {
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
  }

  // Update batch
  async updateBatch(req, res, next) {
    try {
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
  }

  // Add waste to batch
  async addWasteToBatch(req, res, next) {
    try {
      const { id } = req.params;
      const { wasteRecordIds } = req.body;
      
      const batch = await prisma.processingBatch.update({
        where: { id },
        data: {
          wasteRecords: { connect: wasteRecordIds.map(wasteId => ({ id: wasteId })) }
        },
        include: { wasteRecords: true }
      });
      
      await prisma.wasteRecord.updateMany({
        where: { id: { in: wasteRecordIds } },
        data: { status: 'PROCESSING', processingBatchId: id }
      });
      
      res.json({ success: true, data: batch });
    } catch (error) {
      next(error);
    }
  }

  // Record batch output
  async recordOutput(req, res, next) {
    try {
      const { id } = req.params;
      const {
        liquidOutput,
        fertilizerOutput,
        gasOutput,
        conversionRate,
        processingEfficiency
      } = req.body;
      
      const batch = await prisma.processingBatch.update({
        where: { id },
        data: {
          liquidOutput: liquidOutput ? parseFloat(liquidOutput) : undefined,
          fertilizerOutput: fertilizerOutput ? parseFloat(fertilizerOutput) : undefined,
          gasOutput: gasOutput ? parseFloat(gasOutput) : undefined,
          conversionRate: conversionRate ? parseFloat(conversionRate) : undefined,
          processingEfficiency: processingEfficiency ? parseFloat(processingEfficiency) : undefined,
          endDate: new Date(),
          status: 'COMPLETED',
          completedAt: new Date()
        }
      });
      
      await prisma.wasteRecord.updateMany({
        where: { processingBatchId: id },
        data: {
          status: 'PROCESSED',
          processedQuantity: batch.quantity,
          processingDate: new Date()
        }
      });
      
      await prisma.activityLog.create({
        data: {
          batchId: id,
          action: 'OUTPUT_RECORDED',
          description: `Output recorded: ${liquidOutput || 0}L liquid, ${fertilizerOutput || 0}kg fertilizer`,
          performedById: req.user.id,
          metadata: { liquidOutput, fertilizerOutput, gasOutput }
        }
      });
      
      res.json({ success: true, data: batch });
    } catch (error) {
      next(error);
    }
  }

  // Add quality check
  async addQualityCheck(req, res, next) {
    try {
      const { id } = req.params;
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
  }

  // Get batch activity logs
  async getActivityLogs(req, res, next) {
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
  }

  // Delete batch
  async deleteBatch(req, res, next) {
    try {
      await prisma.processingBatch.delete({ where: { id: req.params.id } });
      res.json({ success: true, message: 'Batch deleted successfully' });
    } catch (error) {
      next(error);
    }
  }

  // Get processing dashboard
  async getDashboard(req, res, next) {
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
  }
}

module.exports = new ProcessingController();