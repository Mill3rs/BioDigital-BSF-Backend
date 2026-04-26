const { prisma } = require('../config/database');
const { AppError } = require('../middleware/errorHandler');
const { calculatePagination } = require('../utils/helpers');

class FarmController {
  // Get all farms
  async getAllFarms(req, res, next) {
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
      
      const { skip, pagination } = calculatePagination(page, limit, 0);
      
      const [farms, total] = await Promise.all([
        prisma.farm.findMany({
          where,
          include: {
            manager: { select: { id: true, fullName: true, email: true, phoneNumber: true } },
            admin: { select: { id: true, companyName: true } },
            _count: { select: { wasteRecords: true, processingBatches: true, products: true, orders: true } }
          },
          skip,
          take: pagination.limit,
          orderBy: { createdAt: 'desc' }
        }),
        prisma.farm.count({ where })
      ]);
      
      pagination.total = total;
      pagination.pages = Math.ceil(total / pagination.limit);
      
      res.json({ success: true, data: farms, pagination });
    } catch (error) {
      next(error);
    }
  }

  // Create farm
  async createFarm(req, res, next) {
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
        location
      } = req.body;
      
      const farm = await prisma.farm.create({
        data: {
          name,
          type,
          description,
          area: area ? parseFloat(area) : null,
          areaUnit: areaUnit || 'hectares',
          country,
          region,
          city,
          postalCode,
          location,
          adminId: req.user.role === 'ADMIN' ? req.user.adminManaged?.id : null,
          status: 'PENDING_APPROVAL'
        },
        include: { manager: true }
      });
      
      res.status(201).json({ success: true, data: farm });
    } catch (error) {
      next(error);
    }
  }

  // Get farm by ID
  async getFarmById(req, res, next) {
    try {
      const farm = await prisma.farm.findUnique({
        where: { id: req.params.id },
        include: {
          manager: { select: { id: true, fullName: true, email: true, phoneNumber: true, profileImage: true } },
          admin: { select: { id: true, companyName: true, email: true, phoneNumber: true } },
          wasteRecords: { orderBy: { date: 'desc' }, take: 10 },
          processingBatches: { orderBy: { startDate: 'desc' }, take: 10 },
          products: { where: { status: 'ACTIVE' }, include: { variants: true }, take: 10 },
          _count: { select: { wasteRecords: true, processingBatches: true, products: true, orders: true } }
        }
      });
      
      if (!farm) {
        throw new AppError('Farm not found', 404);
      }
      
      res.json({ success: true, data: farm });
    } catch (error) {
      next(error);
    }
  }

  // Update farm
  async updateFarm(req, res, next) {
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
  }

  // Delete farm
  async deleteFarm(req, res, next) {
    try {
      await prisma.farm.delete({ where: { id: req.params.id } });
      res.json({ success: true, message: 'Farm deleted successfully' });
    } catch (error) {
      next(error);
    }
  }

  // Assign manager to farm
  async assignManager(req, res, next) {
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
  }

  // Get farm statistics
  async getFarmStats(req, res, next) {
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
          activeBatches: await prisma.processingBatch.count({ where: { farmId: id, status: 'ACTIVE' } }),
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
  }
}

module.exports = new FarmController();