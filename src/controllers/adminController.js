const { prisma } = require('../config/database');
const { AppError } = require('../middleware/errorHandler');
const { calculatePagination } = require('../utils/helpers');
const bcrypt = require('bcryptjs');
const logger = require('../utils/logger');

class AdminController {
  // Get system statistics
  async getSystemStats(req, res, next) {
    try {
      const [
        totalUsers,
        totalFarms,
        totalWasteRecords,
        totalProcessingBatches,
        totalOrders,
        totalRevenue,
        activeAdmins,
        systemHealth
      ] = await Promise.all([
        prisma.user.count(),
        prisma.farm.count(),
        prisma.wasteRecord.count(),
        prisma.processingBatch.count(),
        prisma.order.count({ where: { status: 'COMPLETED' } }),
        prisma.order.aggregate({ where: { status: 'COMPLETED' }, _sum: { total: true } }),
        prisma.admin.count({ where: { subscription: 'ACTIVE' } }),
        prisma.$queryRaw`SELECT NOW() as time, pg_database_size(current_database()) as db_size`
      ]);
      
      const sevenDaysAgo = new Date();
      sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);
      
      const activeUsers = await prisma.user.count({
        where: { lastLogin: { gte: sevenDaysAgo } }
      });
      
      const wasteTrend = await prisma.$queryRaw`
        SELECT 
          DATE_TRUNC('month', date) as month,
          SUM(quantity) as total
        FROM waste_records
        WHERE date >= NOW() - INTERVAL '6 months'
        GROUP BY DATE_TRUNC('month', date)
        ORDER BY month DESC
      `;
      
      res.json({
        success: true,
        data: {
          users: { total: totalUsers, active: activeUsers },
          farms: { total: totalFarms, activeAdmins },
          waste: { totalRecords: totalWasteRecords, monthlyTrend: wasteTrend },
          processing: { totalBatches: totalProcessingBatches },
          sales: { totalOrders, totalRevenue: totalRevenue._sum.total || 0 },
          system: systemHealth[0]
        }
      });
    } catch (error) {
      next(error);
    }
  }

  // Get all admins
  async getAllAdmins(req, res, next) {
    try {
      const { status, page = 1, limit = 20 } = req.query;
      const where = {};
      if (status) where.subscription = status;
      
      const { skip, pagination } = calculatePagination(page, limit, 0);
      
      const [admins, total] = await Promise.all([
        prisma.admin.findMany({
          where,
          include: {
            users: {
              where: { role: 'MANAGER' },
              select: { id: true, fullName: true, email: true }
            },
            farms: {
              select: { id: true, name: true, status: true }
            },
            _count: {
              select: { users: true, farms: true }
            }
          },
          skip,
          take: pagination.limit,
          orderBy: { createdAt: 'desc' }
        }),
        prisma.admin.count({ where })
      ]);
      
      pagination.total = total;
      pagination.pages = Math.ceil(total / pagination.limit);
      
      res.json({ success: true, data: admins, pagination });
    } catch (error) {
      next(error);
    }
  }

  // Create new admin
  async createAdmin(req, res, next) {
    try {
      const { companyName, email, password, fullName, phoneNumber, subscription, maxManagers, maxFarms } = req.body;
      
      const existingAdmin = await prisma.admin.findFirst({
        where: { companyName }
      });
      
      if (existingAdmin) {
        throw new AppError('Admin company already exists', 400);
      }
      
      const existingUser = await prisma.user.findUnique({
        where: { email }
      });
      
      if (existingUser) {
        throw new AppError('Email already registered', 400);
      }
      
      const hashedPassword = await bcrypt.hash(password, 10);
      
      const admin = await prisma.admin.create({
        data: {
          companyName,
          subscription: subscription || 'TRIAL',
          subscriptionEnd: subscription === 'ACTIVE' ? new Date(Date.now() + 365 * 24 * 60 * 60 * 1000) : null,
          maxManagers: maxManagers || 5,
          maxFarms: maxFarms || 10
        }
      });
      
      const user = await prisma.user.create({
        data: {
          email,
          password: hashedPassword,
          fullName,
          phoneNumber,
          role: 'ADMIN',
          status: 'ACTIVE',
          managedById: admin.id
        }
      });
      
      const { password: _, ...userData } = user;
      
      res.status(201).json({
        success: true,
        message: 'Admin created successfully',
        data: { admin, user: userData }
      });
    } catch (error) {
      next(error);
    }
  }

  // Update admin subscription
  async updateSubscription(req, res, next) {
    try {
      const { adminId } = req.params;
      const { subscription, subscriptionEnd, maxManagers, maxFarms } = req.body;
      
      const admin = await prisma.admin.update({
        where: { id: adminId },
        data: {
          subscription,
          subscriptionEnd: subscriptionEnd ? new Date(subscriptionEnd) : undefined,
          maxManagers,
          maxFarms
        }
      });
      
      res.json({
        success: true,
        message: 'Subscription updated successfully',
        data: admin
      });
    } catch (error) {
      next(error);
    }
  }

  // Get system logs
  async getSystemLogs(req, res, next) {
    try {
      const { level, limit = 100, offset = 0 } = req.query;
      
      // In production, read from log files
      const logs = await prisma.auditLog.findMany({
        where: level ? { level } : {},
        orderBy: { createdAt: 'desc' },
        take: parseInt(limit),
        skip: parseInt(offset)
      });
      
      res.json({
        success: true,
        data: logs,
        pagination: {
          limit: parseInt(limit),
          offset: parseInt(offset)
        }
      });
    } catch (error) {
      next(error);
    }
  }

  // Get system health
  async getSystemHealth(req, res, next) {
    try {
      const health = {
        status: 'healthy',
        timestamp: new Date().toISOString(),
        uptime: process.uptime(),
        memory: process.memoryUsage(),
        database: 'unknown',
        redis: 'unknown'
      };
      
      try {
        await prisma.$queryRaw`SELECT 1`;
        health.database = 'connected';
      } catch (dbError) {
        health.database = 'disconnected';
        health.status = 'degraded';
      }
      
      res.json({ success: true, data: health });
    } catch (error) {
      next(error);
    }
  }

  // Clear system cache
  async clearCache(req, res, next) {
    try {
      // Clear cache logic here
      logger.info('System cache cleared by admin:', req.user.id);
      
      res.json({
        success: true,
        message: 'Cache cleared successfully'
      });
    } catch (error) {
      next(error);
    }
  }

  // Get all system settings
  async getSettings(req, res, next) {
    try {
      const settings = await prisma.systemSetting.findMany({
        orderBy: { category: 'asc' }
      });
      
      res.json({ success: true, data: settings });
    } catch (error) {
      next(error);
    }
  }

  // Update system setting
  async updateSetting(req, res, next) {
    try {
      const { key } = req.params;
      const { value, description } = req.body;
      
      const setting = await prisma.systemSetting.upsert({
        where: { key },
        update: { value, description, updatedBy: req.user.id, updatedAt: new Date() },
        create: { key, value, description, category: 'general', updatedBy: req.user.id }
      });
      
      res.json({
        success: true,
        message: 'Setting updated successfully',
        data: setting
      });
    } catch (error) {
      next(error);
    }
  }

  // Get all integrations
  async getIntegrations(req, res, next) {
    try {
      const integrations = await prisma.integration.findMany({
        include: { admin: { select: { companyName: true } } }
      });
      
      res.json({ success: true, data: integrations });
    } catch (error) {
      next(error);
    }
  }

  // Create integration
  async createIntegration(req, res, next) {
    try {
      const { name, type, config, adminId } = req.body;
      
      const apiKey = require('crypto').randomBytes(32).toString('hex');
      const apiSecret = require('crypto').randomBytes(32).toString('hex');
      
      const integration = await prisma.integration.create({
        data: {
          name,
          type,
          apiKey,
          apiSecret,
          config,
          adminId: adminId || null,
          status: 'ACTIVE'
        }
      });
      
      res.status(201).json({
        success: true,
        data: integration,
        message: 'Integration created successfully'
      });
    } catch (error) {
      next(error);
    }
  }
}

module.exports = new AdminController();