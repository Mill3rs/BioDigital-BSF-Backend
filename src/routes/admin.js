const express = require('express');
const { body, validationResult } = require('express-validator');
const { prisma } = require('../config/database');
const { authenticate, authorize } = require('../middleware/auth');
const { AppError } = require('../middleware/errorHandler');
const bcrypt = require('bcryptjs');
const logger = require('../utils/logger');

const router = express.Router();

// ── Period filter helper ──────────────────────────────────────────────────────
// Returns a Date for the start of the requested period, or null for all-time.
function periodStart(period) {
  const now = new Date();
  switch (period) {
    case 'daily':   { const d = new Date(now); d.setHours(0,0,0,0); return d; }
    case 'weekly':  { const d = new Date(now); d.setDate(now.getDate() - 7); return d; }
    case 'monthly': { const d = new Date(now); d.setMonth(now.getMonth() - 1); return d; }
    case 'yearly':  { const d = new Date(now); d.setFullYear(now.getFullYear() - 1); return d; }
    default: return null; // all-time
  }
}

// Get system statistics (Super Admin only)
router.get('/stats', authenticate, authorize('SUPER_ADMIN'), async (req, res, next) => {
  try {
    const since = periodStart(req.query.period);
    const dateFilter = since ? { gte: since } : undefined;
    const wasteWhere   = dateFilter ? { date: dateFilter }      : {};
    const orderWhere   = { status: 'COMPLETED', ...(dateFilter ? { createdAt: dateFilter } : {}) };
    const userWhere    = dateFilter ? { createdAt: dateFilter } : {};
    const processWhere = dateFilter ? { startDate: dateFilter } : {};

    const [
      totalUsers,
      totalFarms,
      totalWasteRecords,
      totalProcessingBatches,
      totalOrders,
      totalRevenue,
      activeAdmins,
      systemHealth,
      supportCounts,
    ] = await Promise.all([
      prisma.user.count({ where: userWhere }),
      prisma.farm.count(),
      prisma.wasteRecord.count({ where: wasteWhere }),
      prisma.processingBatch.count({ where: processWhere }),
      prisma.order.count({ where: orderWhere }),
      prisma.order.aggregate({ where: orderWhere, _sum: { total: true } }),
      prisma.admin.count({ where: { subscription: 'ACTIVE' } }),
      prisma.$queryRaw`SELECT NOW() as time, pg_database_size(current_database())::float8 as db_size`,
      Promise.all([
        prisma.supportTicket.count({ where: { status: 'OPEN',        ...(dateFilter ? { createdAt: dateFilter } : {}) } }),
        prisma.supportTicket.count({ where: { status: 'IN_PROGRESS', ...(dateFilter ? { createdAt: dateFilter } : {}) } }),
        prisma.supportTicket.count({ where: { status: 'RESOLVED',    ...(dateFilter ? { createdAt: dateFilter } : {}) } }),
        prisma.supportTicket.count({ where: { status: 'CLOSED',      ...(dateFilter ? { createdAt: dateFilter } : {}) } }),
      ]),
    ]);
    
    // Get daily active users (last 7 days)
    const sevenDaysAgo = new Date();
    sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);
    
    const activeUsers = await prisma.user.count({
      where: { lastLogin: { gte: sevenDaysAgo } }
    });
    
    // Get waste trends (cast to float8 to avoid BigInt serialization)
    const wasteTrendRaw = await prisma.$queryRaw`
      SELECT 
        DATE_TRUNC('month', date) as month,
        SUM(quantity)::float8 as total
      FROM "WasteRecord"
      WHERE date >= NOW() - INTERVAL '6 months'
      GROUP BY DATE_TRUNC('month', date)
      ORDER BY month DESC
    `;
    const wasteTrend = wasteTrendRaw.map((r) => ({ month: r.month, total: Number(r.total) }));

    const processingOutputs = await prisma.processingBatch.aggregate({
      where: processWhere,
      _sum: { larvaeOutput: true, fertilizerOutput: true },
    });

    const wasteAgg = await prisma.wasteRecord.aggregate({
      where: wasteWhere,
      _sum: { quantity: true, carbonSaved: true },
    });

    const [ticketOpen, ticketInProgress, ticketResolved, ticketClosed] = supportCounts;
    
    res.json({
      success: true,
      data: {
        users: { total: totalUsers, active: activeUsers },
        farms: { total: totalFarms, activeAdmins },
        waste: {
          totalRecords: totalWasteRecords,
          totalWaste: wasteAgg._sum.quantity || 0,
          totalCarbonSaved: wasteAgg._sum.carbonSaved || 0,
          monthlyTrend: wasteTrend,
        },
        processing: {
          totalBatches: totalProcessingBatches,
          totalLarvaeOutput: processingOutputs._sum.larvaeOutput || 0,
          totalFertilizerOutput: processingOutputs._sum.fertilizerOutput || 0,
        },
        sales: { totalOrders, totalRevenue: totalRevenue._sum.total || 0 },
        support: { open: ticketOpen, inProgress: ticketInProgress, resolved: ticketResolved, closed: ticketClosed, total: ticketOpen + ticketInProgress + ticketResolved + ticketClosed },
        system: systemHealth[0],
      }
    });
  } catch (error) {
    next(error);
  }
});

// Get stats summary for ADMIN / MANAGER (scoped to their organisation)
router.get('/stats/summary', authenticate, authorize('ADMIN', 'MANAGER'), async (req, res, next) => {
  try {
    const adminId = req.user.adminManaged?.id;
    if (!adminId) {
      return res.status(403).json({ success: false, message: 'No organisation found for this user.' });
    }

    // All farms belonging to this admin
    const adminFarms = await prisma.farm.findMany({
      where: { adminId },
      select: { id: true },
    });
    const farmIds = adminFarms.map((f) => f.id);

    const since = periodStart(req.query.period);
    const dateFilter = since ? { gte: since } : undefined;

    const sevenDaysAgo = new Date();
    sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);

    const orgUserWhere = { managedById: adminId };
    const wasteWhere = {
      ...(farmIds.length > 0 ? { farmId: { in: farmIds } } : { farmId: null }),
      ...(dateFilter ? { date: dateFilter } : {}),
    };
    const processWhere = {
      ...(farmIds.length > 0 ? { farmId: { in: farmIds } } : {}),
      ...(dateFilter ? { startDate: dateFilter } : {}),
    };
    const orderWhere = {
      status: 'COMPLETED',
      ...(dateFilter ? { createdAt: dateFilter } : {}),
    };
    const orgUserCreatedWhere = {
      ...orgUserWhere,
      ...(dateFilter ? { createdAt: dateFilter } : {}),
    };
    const supportWhere = {
      user: { managedById: adminId },
      ...(dateFilter ? { createdAt: dateFilter } : {}),
    };

    const [
      usersByRole,
      activeDrivers,
      farmCount,
      wasteAgg,
      processingAgg,
      processingBatchCount,
      orderCount,
      orderRevenue,
      monthlyWasteRaw,
      processingMonthlyRaw,
      supportCounts,
    ] = await Promise.all([
      Promise.all(
        ['ADMIN', 'MANAGER', 'DRIVER', 'SUPPLIER', 'BUYER'].map(async (role) => ({
          role,
          count: await prisma.user.count({ where: { ...orgUserCreatedWhere, role } }),
        }))
      ),
      prisma.user.count({
        where: { ...orgUserWhere, role: 'DRIVER', lastLogin: { gte: sevenDaysAgo } },
      }),
      prisma.farm.count({ where: { adminId } }),
      prisma.wasteRecord.aggregate({
        where: wasteWhere,
        _sum: { quantity: true, carbonSaved: true },
        _count: true,
      }),
      prisma.processingBatch.aggregate({
        where: processWhere,
        _sum: { larvaeOutput: true, fertilizerOutput: true },
      }),
      prisma.processingBatch.count({ where: processWhere }),
      prisma.order.count({ where: orderWhere }),
      prisma.order.aggregate({ where: orderWhere, _sum: { total: true } }),
      farmIds.length > 0
        ? prisma.$queryRaw`
            SELECT DATE_TRUNC('month', date) as month, SUM(quantity)::float8 as total
            FROM "WasteRecord"
            WHERE "farmId" = ANY(${farmIds}::text[])
              AND date >= NOW() - INTERVAL '6 months'
            GROUP BY DATE_TRUNC('month', date)
            ORDER BY month DESC`
        : Promise.resolve([]),
      farmIds.length > 0
        ? prisma.$queryRaw`
            SELECT DATE_TRUNC('month', "startDate") as month,
              SUM("larvaeOutput")::float8 as larvae,
              SUM("fertilizerOutput")::float8 as fertilizer
            FROM "ProcessingBatch"
            WHERE "farmId" = ANY(${farmIds}::text[])
              AND "startDate" >= NOW() - INTERVAL '6 months'
            GROUP BY DATE_TRUNC('month', "startDate")
            ORDER BY month DESC`
        : Promise.resolve([]),
      Promise.all([
        prisma.supportTicket.count({ where: { ...supportWhere, status: 'OPEN' } }),
        prisma.supportTicket.count({ where: { ...supportWhere, status: 'IN_PROGRESS' } }),
        prisma.supportTicket.count({ where: { ...supportWhere, status: 'RESOLVED' } }),
        prisma.supportTicket.count({ where: { ...supportWhere, status: 'CLOSED' } }),
      ]),
    ]);

    const byRole = Object.fromEntries(usersByRole.map(({ role, count }) => [role, count]));
    const monthlyWasteTrend = monthlyWasteRaw.map((r) => ({ month: r.month, total: Number(r.total) }));
    const monthlyProcessingTrend = processingMonthlyRaw.map((r) => ({
      month: r.month,
      larvae: Number(r.larvae ?? 0),
      fertilizer: Number(r.fertilizer ?? 0),
    }));
    const [ticketOpen, ticketInProgress, ticketResolved, ticketClosed] = supportCounts;

    res.json({
      success: true,
      data: {
        users: { byRole, activeDrivers },
        farms: { total: farmCount },
        waste: {
          totalWaste: wasteAgg._sum.quantity || 0,
          totalCarbonSaved: wasteAgg._sum.carbonSaved || 0,
          totalRecords: wasteAgg._count,
          monthlyTrend: monthlyWasteTrend,
        },
        processing: {
          totalBatches: processingBatchCount,
          totalLarvaeOutput: processingAgg._sum.larvaeOutput || 0,
          totalFertilizerOutput: processingAgg._sum.fertilizerOutput || 0,
          monthlyTrend: monthlyProcessingTrend,
        },
        sales: { totalOrders: orderCount, totalRevenue: orderRevenue._sum.total || 0 },
        support: { open: ticketOpen, inProgress: ticketInProgress, resolved: ticketResolved, closed: ticketClosed, total: ticketOpen + ticketInProgress + ticketResolved + ticketClosed },
      },
    });
  } catch (error) {
    next(error);
  }
});

// Get top-performing companies (Super Admin only) — ranked by total waste processed
router.get('/top-companies', authenticate, authorize('SUPER_ADMIN'), async (req, res, next) => {
  try {
    const limit = Math.min(parseInt(req.query.limit) || 5, 20);

    // WasteRecord.supplierId → User.id → User.managedById (= Admin.id)
    const [wasteBySupplier, admins] = await Promise.all([
      prisma.wasteRecord.groupBy({
        by: ['supplierId'],
        where: { supplierId: { not: null } },
        _sum: { quantity: true, carbonSaved: true },
      }),
      prisma.admin.findMany({
        select: { id: true, companyName: true, country: true, region: true },
      }),
    ]);

    // Fetch Users for all supplierIds to get their managedById (adminId)
    const supplierIds = wasteBySupplier.map((w) => w.supplierId).filter(Boolean);
    const supplierUsers = supplierIds.length
      ? await prisma.user.findMany({
          where: { id: { in: supplierIds } },
          select: { id: true, managedById: true },
        })
      : [];

    // Build userId → adminId map
    const userToAdmin = {};
    supplierUsers.forEach((u) => {
      if (u.managedById) userToAdmin[u.id] = u.managedById;
    });

    // Aggregate waste/carbon per adminId
    const adminTotals = {};
    wasteBySupplier.forEach((w) => {
      const adminId = userToAdmin[w.supplierId];
      if (!adminId) return;
      if (!adminTotals[adminId]) adminTotals[adminId] = { totalWaste: 0, totalCarbon: 0, totalRevenue: 0 };
      adminTotals[adminId].totalWaste += w._sum.quantity || 0;
      adminTotals[adminId].totalCarbon += w._sum.carbonSaved || 0;
    });

    const data = admins
      .map((admin) => ({
        id: admin.id,
        name: admin.companyName,
        country: admin.country ?? null,
        region: admin.region ?? null,
        totalWasteCollected: adminTotals[admin.id]?.totalWaste ?? 0,
        totalCarbonSaved: adminTotals[admin.id]?.totalCarbon ?? 0,
        totalRevenue: adminTotals[admin.id]?.totalRevenue ?? 0,
      }))
      .sort((a, b) => b.totalWasteCollected - a.totalWasteCollected)
      .slice(0, limit);

    res.json({ success: true, data });
  } catch (error) {
    next(error);
  }
});

// Get all admins
router.get('/admins', authenticate, authorize('SUPER_ADMIN'), async (req, res, next) => {
  try {
    const { status, page = 1, limit = 20 } = req.query;
    const where = {};
    if (status) where.subscription = status;
    
    const skip = (page - 1) * limit;
    
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
        take: parseInt(limit),
        orderBy: { createdAt: 'desc' }
      }),
      prisma.admin.count({ where })
    ]);
    
    res.json({
      success: true,
      data: admins,
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

// Create new admin
router.post('/admins', authenticate, authorize('SUPER_ADMIN'), [
  body('companyName').notEmpty().withMessage('Company name is required'),
  body('email').isEmail().withMessage('Valid email is required'),
  body('password').isLength({ min: 6 }).withMessage('Password must be at least 6 characters'),
  body('fullName').notEmpty().withMessage('Full name is required'),
  body('subscription').optional().isIn(['TRIAL', 'ACTIVE', 'EXPIRED', 'CANCELLED', 'SUSPENDED'])
], async (req, res, next) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({ success: false, errors: errors.array() });
  }

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
        onboardingStep: 'PENDING_PROFILE',
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
});

// Update admin subscription
router.put('/admins/:adminId/subscription', authenticate, authorize('SUPER_ADMIN'), [
  body('subscription').isIn(['TRIAL', 'ACTIVE', 'EXPIRED', 'CANCELLED', 'SUSPENDED']),
  body('subscriptionEnd').optional().isISO8601(),
  body('maxManagers').optional().isInt({ min: 1 }),
  body('maxFarms').optional().isInt({ min: 1 })
], async (req, res, next) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({ success: false, errors: errors.array() });
  }

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
});

// Get audit logs (aggregated activity across the system) — Super Admin only
router.get('/audit-logs', authenticate, authorize('SUPER_ADMIN'), async (req, res, next) => {
  try {
    const limit = Math.min(parseInt(req.query.limit ?? '100'), 200);

    const [wasteEvents, userEvents, batchEvents] = await Promise.all([
      prisma.wasteRecord.findMany({
        take: limit,
        orderBy: { createdAt: 'desc' },
        select: {
          id: true,
          sourceName: true,
          quantity: true,
          unit: true,
          status: true,
          createdAt: true,
          recordedBy: { select: { fullName: true, email: true } },
          supplier: { select: { fullName: true, email: true } },
        },
      }),
      prisma.user.findMany({
        take: limit,
        orderBy: { createdAt: 'desc' },
        select: { id: true, fullName: true, email: true, role: true, createdAt: true },
      }),
      prisma.processingBatch.findMany({
        take: limit,
        orderBy: { createdAt: 'desc' },
        select: {
          id: true,
          batchNumber: true,
          name: true,
          status: true,
          processType: true,
          createdAt: true,
          createdBy: { select: { fullName: true, email: true } },
        },
      }),
    ]);

    const entries = [
      ...wasteEvents.map((r) => ({
        id: `waste-${r.id}`,
        type: 'WASTE',
        action: 'Waste Record Submitted',
        actor: r.recordedBy?.fullName ?? r.recordedBy?.email ?? 'Unknown',
        detail: `${r.sourceName} — ${r.quantity}${r.unit} (${r.status})`,
        timestamp: r.createdAt,
      })),
      ...userEvents.map((u) => ({
        id: `user-${u.id}`,
        type: 'USER',
        action: 'User Registered',
        actor: u.fullName ?? u.email,
        detail: `${u.email} — Role: ${u.role}`,
        timestamp: u.createdAt,
      })),
      ...batchEvents.map((b) => ({
        id: `batch-${b.id}`,
        type: 'BATCH',
        action: 'Processing Batch Created',
        actor: b.createdBy?.fullName ?? b.createdBy?.email ?? 'System',
        detail: `Batch #${b.batchNumber}${b.name ? ` — ${b.name}` : ''} (${b.status})`,
        timestamp: b.createdAt,
      })),
    ]
      .sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp))
      .slice(0, limit);

    res.json({ success: true, data: entries });
  } catch (error) {
    next(error);
  }
});

// Get system logs
router.get('/logs', authenticate, authorize('SUPER_ADMIN'), async (req, res, next) => {
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
});

// Get system health
router.get('/health', authenticate, authorize('SUPER_ADMIN'), async (req, res, next) => {
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
});

// Clear system cache
router.post('/clear-cache', authenticate, authorize('SUPER_ADMIN'), async (req, res, next) => {
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
});

// ─── Waste Points Rate (Admin / Manager / Super Admin) ───────────────────────

// Get the waste points rate (points awarded per kg of waste acknowledged)
router.get('/waste-points-rate', authenticate, authorize('ADMIN', 'SUPER_ADMIN'), async (req, res, next) => {
  try {
    const setting = await prisma.systemSetting.findUnique({ where: { key: 'waste_points_rate' } });
    const pointsPerKg = setting ? Number(setting.value) : 0;
    res.json({ success: true, data: { pointsPerKg } });
  } catch (error) {
    next(error);
  }
});

// Set the waste points rate
router.put('/waste-points-rate', authenticate, authorize('ADMIN', 'SUPER_ADMIN'), [
  body('pointsPerKg').isFloat({ min: 0 }).withMessage('pointsPerKg must be a non-negative number'),
], async (req, res, next) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({ success: false, errors: errors.array() });
  }
  try {
    const { pointsPerKg } = req.body;
    const setting = await prisma.systemSetting.upsert({
      where: { key: 'waste_points_rate' },
      update: { value: pointsPerKg, updatedBy: req.user.id, updatedAt: new Date() },
      create: {
        key: 'waste_points_rate',
        value: pointsPerKg,
        description: 'Points awarded to supplier per kg of waste when acknowledged',
        category: 'rewards',
        updatedBy: req.user.id,
      },
    });
    res.json({ success: true, message: 'Points rate updated successfully', data: { pointsPerKg: Number(setting.value) } });
  } catch (error) {
    next(error);
  }
});

// ─── Payout Rate (GHS per point) ─────────────────────────────────────────────

// Get the payout rate per point
router.get('/payout-rate', authenticate, authorize('ADMIN', 'MANAGER', 'SUPER_ADMIN'), async (req, res, next) => {
  try {
    const setting = await prisma.systemSetting.findUnique({ where: { key: 'payout_rate_per_point' } });
    const ratePerPoint = setting ? Number(setting.value) : 0;
    res.json({ success: true, data: { ratePerPoint } });
  } catch (error) {
    next(error);
  }
});

// Set the payout rate per point
router.put('/payout-rate', authenticate, authorize('ADMIN', 'SUPER_ADMIN'), [
  body('ratePerPoint').isFloat({ min: 0 }).withMessage('ratePerPoint must be a non-negative number'),
], async (req, res, next) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) return res.status(400).json({ success: false, errors: errors.array() });
  try {
    const { ratePerPoint } = req.body;
    const setting = await prisma.systemSetting.upsert({
      where: { key: 'payout_rate_per_point' },
      update: { value: ratePerPoint, updatedBy: req.user.id, updatedAt: new Date() },
      create: {
        key: 'payout_rate_per_point',
        value: ratePerPoint,
        description: 'GHS cash value given to supplier per redeemed point',
        category: 'rewards',
        updatedBy: req.user.id,
      },
    });
    res.json({ success: true, message: 'Payout rate updated successfully', data: { ratePerPoint: Number(setting.value) } });
  } catch (error) {
    next(error);
  }
});

// ─── Points Reward Toggle ─────────────────────────────────────────────────────

router.get('/points-reward-enabled', authenticate, authorize('ADMIN', 'MANAGER', 'SUPER_ADMIN'), async (req, res, next) => {
  try {
    const setting = await prisma.systemSetting.findUnique({ where: { key: 'points_reward_enabled' } });
    const enabled = setting ? setting.value === 'true' : true; // default on
    res.json({ success: true, data: { enabled } });
  } catch (error) {
    next(error);
  }
});

router.put('/points-reward-enabled', authenticate, authorize('ADMIN', 'SUPER_ADMIN'), [
  body('enabled').isBoolean().withMessage('enabled must be a boolean'),
], async (req, res, next) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) return res.status(400).json({ success: false, errors: errors.array() });
  try {
    const { enabled } = req.body;
    await prisma.systemSetting.upsert({
      where: { key: 'points_reward_enabled' },
      update: { value: String(enabled), updatedBy: req.user.id, updatedAt: new Date() },
      create: {
        key: 'points_reward_enabled',
        value: String(enabled),
        description: 'Whether the points reward system is active for suppliers',
        category: 'rewards',
        updatedBy: req.user.id,
      },
    });
    res.json({ success: true, message: `Points reward ${enabled ? 'enabled' : 'disabled'} successfully`, data: { enabled } });
  } catch (error) {
    next(error);
  }
});

// ─── Enabled Payout Methods ───────────────────────────────────────────────────

router.get('/payout-methods', authenticate, authorize('ADMIN', 'MANAGER', 'SUPER_ADMIN'), async (req, res, next) => {
  try {
    const setting = await prisma.systemSetting.findUnique({ where: { key: 'payout_methods_enabled' } });
    const methods = setting ? JSON.parse(setting.value) : ['mobile_money'];
    res.json({ success: true, data: { methods } });
  } catch (error) {
    next(error);
  }
});

router.put('/payout-methods', authenticate, authorize('ADMIN', 'SUPER_ADMIN'), [
  body('methods').isArray({ min: 1 }).withMessage('methods must be a non-empty array'),
  body('methods.*').isIn(['mobile_money', 'fertilizer', 'animal_feed']).withMessage('Invalid payout method'),
], async (req, res, next) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) return res.status(400).json({ success: false, errors: errors.array() });
  try {
    const { methods } = req.body;
    await prisma.systemSetting.upsert({
      where: { key: 'payout_methods_enabled' },
      update: { value: JSON.stringify(methods), updatedBy: req.user.id, updatedAt: new Date() },
      create: {
        key: 'payout_methods_enabled',
        value: JSON.stringify(methods),
        description: 'Payout methods available to suppliers (mobile_money, fertilizer, animal_feed)',
        category: 'rewards',
        updatedBy: req.user.id,
      },
    });
    res.json({ success: true, message: 'Payout methods updated successfully', data: { methods } });
  } catch (error) {
    next(error);
  }
});

// ─── Payout Minimum Points ────────────────────────────────────────────────────

router.get('/payout-minimum-points', authenticate, authorize('ADMIN', 'MANAGER', 'SUPER_ADMIN'), async (req, res, next) => {
  try {
    const [minSetting, rateSetting] = await Promise.all([
      prisma.systemSetting.findUnique({ where: { key: 'payout_minimum_points' } }),
      prisma.systemSetting.findUnique({ where: { key: 'payout_rate_per_point' } }),
    ]);
    const minimumPoints = minSetting ? Number(minSetting.value) : 0;
    const ratePerPoint = rateSetting ? Number(rateSetting.value) : 0;

    // Return active products with their variants so admin can cross-reference prices
    const products = await prisma.product.findMany({
      where: { status: 'ACTIVE', deletedAt: null },
      select: {
        id: true,
        name: true,
        category: true,
        variants: {
          where: { isActive: true },
          select: { id: true, name: true, price: true, unitType: true, unitValue: true, pointsCost: true },
          orderBy: { price: 'asc' },
        },
      },
      orderBy: { name: 'asc' },
    });

    res.json({ success: true, data: { minimumPoints, ratePerPoint, products } });
  } catch (error) {
    next(error);
  }
});

router.put('/payout-minimum-points', authenticate, authorize('ADMIN', 'SUPER_ADMIN'), [
  body('minimumPoints').isInt({ min: 0 }).withMessage('minimumPoints must be a non-negative integer'),
], async (req, res, next) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) return res.status(400).json({ success: false, errors: errors.array() });
  try {
    const { minimumPoints } = req.body;
    await prisma.systemSetting.upsert({
      where: { key: 'payout_minimum_points' },
      update: { value: String(minimumPoints), updatedBy: req.user.id, updatedAt: new Date() },
      create: {
        key: 'payout_minimum_points',
        value: String(minimumPoints),
        description: 'Minimum points a supplier must have before they can request a payout',
        category: 'rewards',
        updatedBy: req.user.id,
      },
    });
    res.json({ success: true, message: 'Minimum payout points updated', data: { minimumPoints } });
  } catch (error) {
    next(error);
  }
});

// ─── Product Variant Points Cost ─────────────────────────────────────────────

router.put('/product-variants/:id/points-cost', authenticate, authorize('ADMIN', 'SUPER_ADMIN'), [
  body('pointsCost').if(body('pointsCost').exists()).isInt({ min: 0 }).withMessage('pointsCost must be a non-negative integer or null'),
], async (req, res, next) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) return res.status(400).json({ success: false, errors: errors.array() });
  try {
    const { id } = req.params;
    const pointsCost = req.body.pointsCost === null || req.body.pointsCost === undefined ? null : Number(req.body.pointsCost);
    const variant = await prisma.productVariant.update({
      where: { id },
      data: { pointsCost },
      select: { id: true, name: true, pointsCost: true },
    });
    res.json({ success: true, message: 'Points cost updated', data: variant });
  } catch (error) {
    if (error.code === 'P2025') return res.status(404).json({ success: false, message: 'Variant not found' });
    next(error);
  }
});

// ─── Company Vehicle Fleet ────────────────────────────────────────────────────

// List all vehicles
router.get('/vehicles', authenticate, authorize('ADMIN', 'MANAGER', 'SUPER_ADMIN'), async (req, res, next) => {
  try {
    const { activeOnly } = req.query;
    const where = activeOnly === 'true' ? { isActive: true } : {};
    const vehicles = await prisma.vehicle.findMany({
      where,
      orderBy: { createdAt: 'desc' },
    });
    res.json({ success: true, data: { vehicles } });
  } catch (error) {
    next(error);
  }
});

// Create a vehicle
router.post('/vehicles', authenticate, authorize('ADMIN', 'SUPER_ADMIN'), [
  body('plateNumber').trim().notEmpty().withMessage('Plate number is required'),
  body('type').trim().notEmpty().withMessage('Vehicle type is required'),
  body('model').optional().trim(),
  body('color').optional().trim(),
], async (req, res, next) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) return res.status(400).json({ success: false, errors: errors.array() });
  try {
    const { plateNumber, type, model, color } = req.body;
    const vehicle = await prisma.vehicle.create({
      data: { plateNumber: plateNumber.toUpperCase(), type, model, color },
    });
    res.status(201).json({ success: true, message: 'Vehicle added successfully', data: { vehicle } });
  } catch (error) {
    if (error.code === 'P2002') {
      return res.status(409).json({ success: false, message: 'A vehicle with that plate number already exists' });
    }
    next(error);
  }
});

// Update a vehicle
router.put('/vehicles/:id', authenticate, authorize('ADMIN', 'SUPER_ADMIN'), [
  body('plateNumber').optional().trim().notEmpty(),
  body('type').optional().trim().notEmpty(),
  body('model').optional().trim(),
  body('color').optional().trim(),
  body('isActive').optional().isBoolean(),
], async (req, res, next) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) return res.status(400).json({ success: false, errors: errors.array() });
  try {
    const { id } = req.params;
    const { plateNumber, type, model, color, isActive } = req.body;
    const data = {};
    if (plateNumber != null) data.plateNumber = plateNumber.toUpperCase();
    if (type != null) data.type = type;
    if (model !== undefined) data.model = model;
    if (color !== undefined) data.color = color;
    if (isActive != null) data.isActive = isActive;
    const vehicle = await prisma.vehicle.update({ where: { id }, data });
    res.json({ success: true, message: 'Vehicle updated', data: { vehicle } });
  } catch (error) {
    if (error.code === 'P2025') return res.status(404).json({ success: false, message: 'Vehicle not found' });
    if (error.code === 'P2002') return res.status(409).json({ success: false, message: 'Plate number already in use' });
    next(error);
  }
});

// Delete (deactivate) a vehicle
router.delete('/vehicles/:id', authenticate, authorize('ADMIN', 'SUPER_ADMIN'), async (req, res, next) => {
  try {
    const { id } = req.params;
    // Soft-delete: mark inactive rather than hard delete
    await prisma.vehicle.update({ where: { id }, data: { isActive: false } });
    res.json({ success: true, message: 'Vehicle deactivated' });
  } catch (error) {
    if (error.code === 'P2025') return res.status(404).json({ success: false, message: 'Vehicle not found' });
    next(error);
  }
});

// ─── System Settings (Super Admin only) ──────────────────────────────────────

// Get all system settings
router.get('/settings', authenticate, authorize('SUPER_ADMIN'), async (req, res, next) => {
  try {
    const settings = await prisma.systemSetting.findMany({
      orderBy: { category: 'asc' }
    });
    
    res.json({ success: true, data: settings });
  } catch (error) {
    next(error);
  }
});

// Update system setting
router.put('/settings/:key', authenticate, authorize('SUPER_ADMIN'), async (req, res, next) => {
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
});

// Get all integrations
router.get('/integrations', authenticate, authorize('SUPER_ADMIN'), async (req, res, next) => {
  try {
    const integrations = await prisma.integration.findMany({
      include: { admin: { select: { companyName: true } } }
    });
    
    res.json({ success: true, data: integrations });
  } catch (error) {
    next(error);
  }
});

// Create integration
router.post('/integrations', authenticate, authorize('SUPER_ADMIN'), [
  body('name').notEmpty(),
  body('type').isIn(['CARBON_API', 'PAYMENT_GATEWAY', 'SMS_GATEWAY', 'EMAIL_SERVICE', 'MAP_SERVICE', 'IOT_DEVICE', 'ERP_SYSTEM', 'OTHER'])
], async (req, res, next) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({ success: false, errors: errors.array() });
  }

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
});

// ── Environment Configuration (SUPER_ADMIN only) ────────────────────────────

const fs = require('fs');
const path = require('path');
const ENV_PATH = path.resolve(__dirname, '../../.env');

// Keys whose values are always masked when reading
const SENSITIVE_KEYS = new Set([
  'DATABASE_URL', 'JWT_SECRET', 'JWT_REFRESH_SECRET', 'SESSION_SECRET',
  'SMTP_PASS', 'AWS_SECRET_ACCESS_KEY', 'STRIPE_SECRET_KEY',
  'STRIPE_WEBHOOK_SECRET', 'TWILIO_AUTH_TOKEN', 'FCM_SERVER_KEY',
  'CARBON_API_KEY',
]);

function parseEnv(raw) {
  const entries = [];
  for (const line of raw.split('\n')) {
    const trimmed = line.trimEnd();
    // Preserve blank lines and comments as-is using a sentinel type
    if (trimmed === '' || trimmed.startsWith('#')) {
      entries.push({ type: 'raw', line: trimmed });
      continue;
    }
    const eqIdx = trimmed.indexOf('=');
    if (eqIdx === -1) {
      entries.push({ type: 'raw', line: trimmed });
      continue;
    }
    const key = trimmed.slice(0, eqIdx).trim();
    const value = trimmed.slice(eqIdx + 1);
    entries.push({ type: 'kv', key, value });
  }
  return entries;
}

function serializeEnv(entries) {
  return entries.map((e) => (e.type === 'raw' ? e.line : `${e.key}=${e.value}`)).join('\n');
}

// GET /admin/env – return all keys (sensitive values masked)
router.get('/env', authenticate, authorize('SUPER_ADMIN'), (req, res, next) => {
  try {
    const raw = fs.readFileSync(ENV_PATH, 'utf8');
    const entries = parseEnv(raw);
    const variables = entries
      .filter((e) => e.type === 'kv')
      .map((e) => ({
        key: e.key,
        value: SENSITIVE_KEYS.has(e.key) ? '' : e.value,
        sensitive: SENSITIVE_KEYS.has(e.key),
      }));
    res.json({ success: true, data: variables });
  } catch (error) {
    next(error);
  }
});

// PUT /admin/env – update one or more key-value pairs
// Body: { variables: [{ key, value }] }
router.put('/env', authenticate, authorize('SUPER_ADMIN'), (req, res, next) => {
  try {
    const { variables } = req.body;
    if (!Array.isArray(variables) || variables.length === 0) {
      return res.status(400).json({ success: false, message: 'variables array is required' });
    }

    // Validate: keys must be non-empty identifiers, values must contain no raw newlines
    for (const { key, value } of variables) {
      if (!/^[A-Z_][A-Z0-9_]*$/i.test(key)) {
        return res.status(400).json({ success: false, message: `Invalid key: ${key}` });
      }
      if (typeof value !== 'string' || /[\r\n]/.test(value)) {
        return res.status(400).json({ success: false, message: `Invalid value for key: ${key}` });
      }
    }

    const updateMap = new Map(variables.map(({ key, value }) => [key, value]));
    const raw = fs.readFileSync(ENV_PATH, 'utf8');
    const entries = parseEnv(raw);
    const seen = new Set();

    // Update existing keys
    for (const entry of entries) {
      if (entry.type === 'kv' && updateMap.has(entry.key)) {
        const newVal = updateMap.get(entry.key);
        // Only update if the caller actually sent a non-empty value (empty = "keep existing" for sensitive keys)
        if (newVal !== '') {
          entry.value = newVal;
        }
        seen.add(entry.key);
      }
    }

    // Append brand-new keys
    for (const [key, value] of updateMap) {
      if (!seen.has(key) && value !== '') {
        entries.push({ type: 'kv', key, value });
      }
    }

    fs.writeFileSync(ENV_PATH, serializeEnv(entries), 'utf8');
    logger.info(`SUPER_ADMIN ${req.user.id} updated .env keys: ${[...updateMap.keys()].join(', ')}`);

    res.json({ success: true, message: '.env updated successfully' });
  } catch (error) {
    next(error);
  }
});

// ── Admin User Management ────────────────────────────────────────────────────
// Rules:
//   SUPER_ADMIN  → can only list / create / manage ADMIN users
//                  creating an ADMIN auto-creates the linked Admin entity
//   ADMIN        → can only list / create / manage DRIVER, MANAGER, SUPPLIER
//                  under their own Admin entity (managedById)

const SUPER_ADMIN_ALLOWED_ROLES = ['ADMIN'];
const ADMIN_ALLOWED_ROLES = ['DRIVER', 'MANAGER', 'SUPPLIER'];
const MANAGER_ALLOWED_ROLES = ['DRIVER', 'SUPPLIER'];

// Resolve scope constraints for the requesting user
function userScope(reqUser) {
  if (reqUser.role === 'SUPER_ADMIN') {
    // Super Admin sees ALL users; creation is separately restricted
    return { allowedRoles: SUPER_ADMIN_ALLOWED_ROLES, where: {} };
  }
  const adminId = reqUser.adminManaged?.id;
  if (reqUser.role === 'MANAGER') {
    // Manager can only see/manage Driver and Supplier within their org
    return {
      allowedRoles: MANAGER_ALLOWED_ROLES,
      where: { role: { in: MANAGER_ALLOWED_ROLES }, managedById: adminId },
    };
  }
  // ADMIN – scope to their own managed users
  return {
    allowedRoles: ADMIN_ALLOWED_ROLES,
    where: { role: { in: ADMIN_ALLOWED_ROLES }, managedById: adminId },
  };
}

// Verify the target user is within the requester's scope
async function assertOwnership(reqUser, targetUserId) {
  const target = await prisma.user.findUnique({ where: { id: targetUserId } });
  if (!target) throw new AppError('User not found', 404);
  // Super Admin can act on any user
  if (reqUser.role === 'SUPER_ADMIN') return target;
  if (reqUser.role === 'ADMIN') {
    if (!ADMIN_ALLOWED_ROLES.includes(target.role)) {
      throw new AppError('Admin can only manage Driver, Manager or Supplier users', 403);
    }
    const adminId = reqUser.adminManaged?.id;
    if (target.managedById !== adminId) {
      throw new AppError('Access denied – user does not belong to your organisation', 403);
    }
  }
  if (reqUser.role === 'MANAGER') {
    if (!MANAGER_ALLOWED_ROLES.includes(target.role)) {
      throw new AppError('Manager can only manage Driver or Supplier users', 403);
    }
    const adminId = reqUser.adminManaged?.id;
    if (target.managedById !== adminId) {
      throw new AppError('Access denied – user does not belong to your organisation', 403);
    }
  }
  return target;
}

// User statistics
router.get('/users/stats', authenticate, authorize('SUPER_ADMIN', 'ADMIN', 'MANAGER'), async (req, res, next) => {
  try {
    const isSuperAdmin = req.user.role === 'SUPER_ADMIN';
    const adminId = req.user.adminManaged?.id;
    // Scope user queries for non-superadmin roles
    const scopeWhere = isSuperAdmin ? {} : { managedById: adminId };

    const allRoles = isSuperAdmin
      ? ['SUPER_ADMIN', 'ADMIN', 'MANAGER', 'DRIVER', 'SUPPLIER', 'BUYER']
      : ['MANAGER', 'DRIVER', 'SUPPLIER', 'BUYER'];

    const [byRole, byStatus, total] = await Promise.all([
      Promise.all(
        allRoles.map(async (role) => ({
          role,
          count: await prisma.user.count({ where: { ...scopeWhere, role } }),
        }))
      ),
      Promise.all(
        ['ACTIVE', 'INACTIVE', 'SUSPENDED', 'PENDING_VERIFICATION'].map(async (status) => ({
          status,
          count: await prisma.user.count({ where: { ...scopeWhere, status } }),
        }))
      ),
      prisma.user.count({ where: scopeWhere }),
    ]);
    res.json({
      success: true,
      data: {
        total,
        byRole: Object.fromEntries(byRole.map(({ role, count }) => [role, count])),
        byStatus: Object.fromEntries(byStatus.map(({ status, count }) => [status, count])),
      },
    });
  } catch (error) {
    next(error);
  }
});

// List users
router.get('/users', authenticate, authorize('SUPER_ADMIN', 'ADMIN', 'MANAGER'), async (req, res, next) => {
  try {
    const { role, status, search, page = 1, limit = 15 } = req.query;
    const { where: scopeWhere } = userScope(req.user);

    const where = { ...scopeWhere };

    // For SUPER_ADMIN: allow filtering by any role; for ADMIN: restrict to allowed roles
    if (role && role !== 'ALL') {
      if (req.user.role !== 'SUPER_ADMIN') {
        const { allowedRoles } = userScope(req.user);
        if (!allowedRoles.includes(role)) {
          return res.json({ success: true, data: { users: [], pagination: { page: 1, limit: 15, total: 0, pages: 0 } } });
        }
      }
      where.role = role;
    }

    if (status) where.status = status;
    if (search) {
      where.OR = [
        { fullName: { contains: search, mode: 'insensitive' } },
        { email: { contains: search, mode: 'insensitive' } },
        { phoneNumber: { contains: search, mode: 'insensitive' } },
      ];
    }

    const skip = (parseInt(page) - 1) * parseInt(limit);
    const [users, total] = await Promise.all([
      prisma.user.findMany({
        where,
        skip,
        take: parseInt(limit),
        select: {
          id: true,
          email: true,
          fullName: true,
          phoneNumber: true,
          location: true,
          role: true,
          status: true,
          profileImage: true,
          createdAt: true,
          lastLogin: true,
          managedById: true,
          supplierProfile: true,
          driverProfile: true,
        },
        orderBy: { createdAt: 'desc' },
      }),
      prisma.user.count({ where }),
    ]);
    res.json({
      success: true,
      data: {
        users,
        pagination: { page: parseInt(page), limit: parseInt(limit), total, pages: Math.ceil(total / parseInt(limit)) },
      },
    });
  } catch (error) {
    next(error);
  }
});

// Get user by ID
router.get('/users/:id', authenticate, authorize('SUPER_ADMIN', 'ADMIN', 'MANAGER'), async (req, res, next) => {
  try {
    await assertOwnership(req.user, req.params.id);
    const user = await prisma.user.findUnique({
      where: { id: req.params.id },
      include: { driverProfile: true, buyerProfile: true, supplierProfile: true },
    });
    const { password: _, ...userData } = user;
    res.json({ success: true, data: userData });
  } catch (error) {
    next(error);
  }
});

// Create user
router.post(
  '/users',
  authenticate,
  authorize('SUPER_ADMIN', 'ADMIN'),
  [
    body('email').isEmail().normalizeEmail().withMessage('Valid email is required'),
    body('password').isLength({ min: 6 }).withMessage('Password must be at least 6 characters'),
    body('fullName').notEmpty().withMessage('Full name is required'),
    body('role').notEmpty().withMessage('Role is required'),
  ],
  async (req, res, next) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ success: false, errors: errors.array() });
    }
    try {
      const { email, password, fullName, phoneNumber, location, role } = req.body;
      const { allowedRoles } = userScope(req.user);

      if (!allowedRoles.includes(role)) {
        throw new AppError(
          req.user.role === 'SUPER_ADMIN'
            ? 'Super Admin can only create Admin users'
            : 'Admin can only create Driver, Manager or Supplier users',
          403,
        );
      }

      const existing = await prisma.user.findUnique({ where: { email } });
      if (existing) throw new AppError('Email already registered', 400);

      const hashedPassword = await bcrypt.hash(password, 10);

      let managedById = null;

      if (req.user.role === 'SUPER_ADMIN') {
        // Creating an ADMIN user: auto-create the Admin entity so they can later
        // manage sub-users under their own organisation.
        const adminEntity = await prisma.admin.create({
          data: { companyName: fullName, subscription: 'TRIAL' },
        });
        managedById = adminEntity.id;
      } else {
        // ADMIN creating sub-user: link to their own Admin entity
        const adminId = req.user.adminManaged?.id;
        if (!adminId) throw new AppError('Your account is not linked to an Admin organisation', 500);
        managedById = adminId;
      }

      const user = await prisma.user.create({
        data: { email, password: hashedPassword, fullName, phoneNumber, location, role, status: 'ACTIVE', managedById, onboardingStep: role === 'ADMIN' ? 'PENDING_PROFILE' : 'COMPLETE' },
        select: { id: true, email: true, fullName: true, phoneNumber: true, location: true, role: true, status: true, onboardingStep: true, createdAt: true, managedById: true },
      });

      // Create role-specific profile
      if (role === 'DRIVER') await prisma.driverProfile.create({ data: { userId: user.id } });
      else if (role === 'SUPPLIER') await prisma.supplierProfile.create({ data: { userId: user.id, primaryProducts: [], wasteTypes: [] } });

      logger.info(`${req.user.role} ${req.user.id} created ${role} user ${user.id}`);
      res.status(201).json({ success: true, message: 'User created successfully', data: user });
    } catch (error) {
      next(error);
    }
  },
);

// Update driver profile fields
router.patch('/users/:id/driver-profile', authenticate, authorize('SUPER_ADMIN', 'ADMIN', 'MANAGER'), async (req, res, next) => {
  try {
    await assertOwnership(req.user, req.params.id);
    const {
      licenseNumber, licenseExpiry, vehicleType, vehicleModel,
      vehiclePlateNumber, vehicleRegistration, status, rating,
    } = req.body;
    const VALID_DRIVER_STATUSES = ['PENDING', 'APPROVED', 'REJECTED', 'ACTIVE', 'OFFLINE', 'SUSPENDED'];
    if (status && !VALID_DRIVER_STATUSES.includes(status)) {
      throw new AppError('Invalid driver status', 400);
    }
    const data = {};
    if (licenseNumber !== undefined) data.licenseNumber = licenseNumber;
    if (licenseExpiry !== undefined) data.licenseExpiry = licenseExpiry ? new Date(licenseExpiry) : null;
    if (vehicleType !== undefined) data.vehicleType = vehicleType;
    if (vehicleModel !== undefined) data.vehicleModel = vehicleModel;
    if (vehiclePlateNumber !== undefined) data.vehiclePlateNumber = vehiclePlateNumber;
    if (vehicleRegistration !== undefined) data.vehicleRegistration = vehicleRegistration;
    if (status !== undefined) data.status = status;
    if (rating !== undefined) data.rating = Number.parseFloat(rating);
    const profile = await prisma.driverProfile.update({
      where: { userId: req.params.id },
      data,
    });
    logger.info(`${req.user.role} ${req.user.id} updated driver profile for user ${req.params.id}`);
    res.json({ success: true, data: profile });
  } catch (error) {
    next(error);
  }
});

// Update supplier profile fields
router.patch('/users/:id/supplier-profile', authenticate, authorize('SUPER_ADMIN', 'ADMIN', 'MANAGER'), async (req, res, next) => {
  try {
    await assertOwnership(req.user, req.params.id);
    const {
      farmName, farmType, farmSize, farmSizeRange, primaryProducts, wasteTypes, crops,
      weeklyWasteAmount, weeklyWasteAmountRange, preferredPickupTime,
      status, supplierType, organizationName,
    } = req.body;
    const VALID_SUPPLIER_STATUSES = ['PENDING', 'APPROVED', 'REJECTED', 'ACTIVE', 'SUSPENDED'];
    if (status && !VALID_SUPPLIER_STATUSES.includes(status)) {
      throw new AppError('Invalid supplier status', 400);
    }
    const data = {};
    if (farmName !== undefined) data.farmName = farmName;
    if (farmType !== undefined) data.farmType = farmType;
    if (farmSize !== undefined) data.farmSize = farmSize == null ? null : Number.parseFloat(farmSize);
    if (farmSizeRange !== undefined) data.farmSizeRange = farmSizeRange || null;
    if (primaryProducts !== undefined) data.primaryProducts = primaryProducts;
    if (wasteTypes !== undefined) data.wasteTypes = wasteTypes;
    if (crops !== undefined) data.crops = crops;
    if (weeklyWasteAmount !== undefined) data.weeklyWasteAmount = weeklyWasteAmount == null ? null : Number.parseFloat(weeklyWasteAmount);
    if (weeklyWasteAmountRange !== undefined) data.weeklyWasteAmountRange = weeklyWasteAmountRange || null;
    if (preferredPickupTime !== undefined) data.preferredPickupTime = preferredPickupTime;
    if (status !== undefined) data.status = status;
    if (supplierType !== undefined) data.supplierType = supplierType;
    if (organizationName !== undefined) data.organizationName = organizationName;
    const profile = await prisma.supplierProfile.update({
      where: { userId: req.params.id },
      data,
    });
    logger.info(`${req.user.role} ${req.user.id} updated supplier profile for user ${req.params.id}`);
    res.json({ success: true, data: profile });
  } catch (error) {
    next(error);
  }
});

// Delete user (removes profile + user record; fails gracefully if linked records exist)
router.delete('/users/:id', authenticate, authorize('SUPER_ADMIN', 'ADMIN', 'MANAGER'), async (req, res, next) => {
  try {
    const target = await assertOwnership(req.user, req.params.id);
    await prisma.$transaction(async (tx) => {
      // Remove role-specific profiles (FK RESTRICT)
      if (target.role === 'DRIVER') {
        await tx.driverProfile.deleteMany({ where: { userId: target.id } });
      } else if (target.role === 'SUPPLIER') {
        await tx.supplierProfile.deleteMany({ where: { userId: target.id } });
      } else if (target.role === 'BUYER') {
        await tx.buyerProfile.deleteMany({ where: { userId: target.id } });
      }
      // Remove low-risk owned records (FK RESTRICT)
      await tx.notification.deleteMany({ where: { userId: target.id } });
      await tx.offlineSync.deleteMany({ where: { userId: target.id } });
      // Remove cart + cart items
      const cart = await tx.cart.findUnique({ where: { userId: target.id } });
      if (cart) {
        await tx.cartItem.deleteMany({ where: { cartId: cart.id } });
        await tx.cart.delete({ where: { id: cart.id } });
      }
      await tx.user.delete({ where: { id: target.id } });
    });
    logger.info(`${req.user.role} ${req.user.id} deleted user ${req.params.id}`);
    res.json({ success: true, message: 'User deleted successfully' });
  } catch (error) {
    // P2003: FK constraint violation
    if (error.code === 'P2003' || error.message?.includes('Foreign key')) {
      return next(new AppError('Cannot delete this user – they have linked records (waste, orders, batches). Disable their account instead.', 409));
    }
    next(error);
  }
});

// Update user
router.put('/users/:id', authenticate, authorize('SUPER_ADMIN', 'ADMIN'), async (req, res, next) => {
  try {
    await assertOwnership(req.user, req.params.id);
    const { fullName, phoneNumber, location, status } = req.body; // role changes not permitted here
    const user = await prisma.user.update({
      where: { id: req.params.id },
      data: { fullName, phoneNumber, location, status },
      select: { id: true, email: true, fullName: true, phoneNumber: true, location: true, role: true, status: true },
    });
    res.json({ success: true, data: user });
  } catch (error) {
    next(error);
  }
});

// Disable user
router.patch('/users/:id/disable', authenticate, authorize('SUPER_ADMIN', 'ADMIN'), async (req, res, next) => {
  try {
    await assertOwnership(req.user, req.params.id);
    await prisma.user.update({ where: { id: req.params.id }, data: { status: 'INACTIVE' } });
    res.json({ success: true, message: 'User disabled' });
  } catch (error) {
    next(error);
  }
});

// Enable user
router.patch('/users/:id/enable', authenticate, authorize('SUPER_ADMIN', 'ADMIN'), async (req, res, next) => {
  try {
    await assertOwnership(req.user, req.params.id);
    await prisma.user.update({ where: { id: req.params.id }, data: { status: 'ACTIVE' } });
    res.json({ success: true, message: 'User enabled' });
  } catch (error) {
    next(error);
  }
});

// Reset user password (role-scoped)
// SUPER_ADMIN → can reset ADMIN passwords
// ADMIN        → can reset MANAGER, DRIVER, SUPPLIER passwords (own org)
// MANAGER      → can reset DRIVER, SUPPLIER passwords (own org)
router.patch(
  '/users/:id/reset-password',
  authenticate,
  authorize('SUPER_ADMIN', 'ADMIN', 'MANAGER'),
  [
    body('newPassword')
      .isLength({ min: 6 })
      .withMessage('New password must be at least 6 characters'),
  ],
  async (req, res, next) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ success: false, errors: errors.array() });
    }
    try {
      await assertOwnership(req.user, req.params.id);
      const { newPassword } = req.body;
      const hashedPassword = await bcrypt.hash(newPassword, 12);
      await prisma.user.update({
        where: { id: req.params.id },
        data: { password: hashedPassword },
      });
      logger.info(`${req.user.role} ${req.user.id} reset password for user ${req.params.id}`);
      res.json({ success: true, message: 'Password reset successfully' });
    } catch (error) {
      next(error);
    }
  },
);

// ─── Company Location (ADMIN / MANAGER) ──────────────────────────────────────
// Get current processing center location
router.get('/company-location', authenticate, authorize('ADMIN', 'MANAGER'), async (req, res, next) => {
  try {
    const adminId = req.user.adminManaged?.id;
    if (!adminId) throw new AppError('Admin profile not found', 404);
    const admin = await prisma.admin.findUnique({
      where: { id: adminId },
      select: { companyName: true, address: true, city: true, country: true, region: true, lat: true, lng: true },
    });
    if (!admin) throw new AppError('Admin profile not found', 404);
    res.json({ success: true, data: admin });
  } catch (error) {
    next(error);
  }
});

// Update processing center location (ADMIN only)
router.put('/company-location', authenticate, authorize('ADMIN'), async (req, res, next) => {
  try {
    const adminId = req.user.adminManaged?.id;
    if (!adminId) throw new AppError('Admin profile not found', 404);
    const { address, city, country, region, lat, lng } = req.body;
    if (lat != null && (typeof lat !== 'number' || lat < -90 || lat > 90)) {
      throw new AppError('Invalid latitude', 400);
    }
    if (lng != null && (typeof lng !== 'number' || lng < -180 || lng > 180)) {
      throw new AppError('Invalid longitude', 400);
    }
    const admin = await prisma.admin.update({
      where: { id: adminId },
      data: { address, city, country, region, lat, lng },
      select: { companyName: true, address: true, city: true, country: true, region: true, lat: true, lng: true },
    });
    res.json({ success: true, message: 'Company location updated', data: admin });
  } catch (error) {
    next(error);
  }
});

// ─── Company Invite Code (ADMIN role only) ────────────────────────────────────
// Get current invite code for the logged-in admin
router.get('/company-code', authenticate, authorize('ADMIN'), async (req, res, next) => {
  try {
    const admin = await prisma.admin.findFirst({
      where: { id: req.user.adminManaged?.id },
      select: { id: true, companyName: true, inviteCode: true }
    });
    if (!admin) throw new AppError('Admin profile not found', 404);
    res.json({ success: true, data: { companyName: admin.companyName, inviteCode: admin.inviteCode } });
  } catch (error) {
    next(error);
  }
});

// Generate / rotate invite code
router.post('/company-code/generate', authenticate, authorize('ADMIN'), async (req, res, next) => {
  try {
    const adminId = req.user.adminManaged?.id;
    if (!adminId) throw new AppError('Admin profile not found', 404);

    // Generate a human-readable 8-char alphanumeric code
    const crypto = require('crypto');
    const newCode = crypto.randomBytes(4).toString('hex').toUpperCase();

    const admin = await prisma.admin.update({
      where: { id: adminId },
      data: { inviteCode: newCode },
      select: { companyName: true, inviteCode: true }
    });

    res.json({
      success: true,
      message: 'Invite code generated successfully',
      data: { companyName: admin.companyName, inviteCode: admin.inviteCode }
    });
  } catch (error) {
    next(error);
  }
});

// Monthly user onboarding trend grouped by role (last 12 months)
router.get('/users/onboarding-trend', authenticate, authorize('SUPER_ADMIN', 'ADMIN', 'MANAGER'), async (req, res, next) => {
  try {
    const isSuperAdmin = req.user.role === 'SUPER_ADMIN';
    const adminId = req.user.adminManaged?.id;

    let rows;
    if (isSuperAdmin) {
      rows = await prisma.$queryRaw`
        SELECT
          DATE_TRUNC('month', "createdAt") as month,
          role,
          COUNT(*)::int as count
        FROM "User"
        WHERE "createdAt" >= NOW() - INTERVAL '12 months'
        GROUP BY DATE_TRUNC('month', "createdAt"), role
        ORDER BY month ASC
      `;
    } else if (adminId) {
      rows = await prisma.$queryRaw`
        SELECT
          DATE_TRUNC('month', "createdAt") as month,
          role,
          COUNT(*)::int as count
        FROM "User"
        WHERE "managedById" = ${adminId}
          AND "createdAt" >= NOW() - INTERVAL '12 months'
        GROUP BY DATE_TRUNC('month', "createdAt"), role
        ORDER BY month ASC
      `;
    } else {
      rows = [];
    }

    const data = rows.map((r) => ({ month: r.month, role: r.role, count: Number(r.count) }));
    res.json({ success: true, data });
  } catch (error) {
    next(error);
  }
});

// Reward points summary — total earned vs redeemed across all suppliers
router.get('/rewards/stats', authenticate, authorize('SUPER_ADMIN', 'ADMIN', 'MANAGER'), async (req, res, next) => {
  try {
    const isSuperAdmin = req.user.role === 'SUPER_ADMIN';

    // Scope via User.managedById — SupplierProfile.adminId is unreliable (often null)
    let where = {};
    if (!isSuperAdmin) {
      const adminId = req.user.adminManaged?.id ?? req.user.farm?.adminId ?? null;
      where = adminId ? { user: { managedById: adminId } } : { user: { managedById: null } };
    }

    const agg = await prisma.supplierProfile.aggregate({
      where,
      _sum: { pointsEarned: true, pointsBalance: true },
    });

    const totalEarned = agg._sum.pointsEarned ?? 0;
    const totalBalance = agg._sum.pointsBalance ?? 0;
    // Redeemed = earned minus what's still in balance
    const totalRedeemed = Math.max(totalEarned - totalBalance, 0);

    res.json({
      success: true,
      data: {
        earned: totalEarned,
        redeemed: totalRedeemed,
        balance: totalBalance,
      },
    });
  } catch (error) {
    next(error);
  }
});

// ─── Delivery Price ───────────────────────────────────────────────────────────

// Get delivery price
router.get('/delivery-price', authenticate, authorize('ADMIN', 'MANAGER', 'SUPER_ADMIN'), async (req, res, next) => {
  try {
    const setting = await prisma.systemSetting.findUnique({ where: { key: 'delivery_price' } });
    const price = setting ? Number(setting.value) : 0;
    res.json({ success: true, data: { price } });
  } catch (error) {
    next(error);
  }
});

// Set delivery price
router.put('/delivery-price', authenticate, authorize('ADMIN', 'MANAGER', 'SUPER_ADMIN'), [
  body('price').isFloat({ min: 0 }).withMessage('price must be a non-negative number'),
], async (req, res, next) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) return res.status(400).json({ success: false, errors: errors.array() });
  try {
    const { price } = req.body;
    const setting = await prisma.systemSetting.upsert({
      where: { key: 'delivery_price' },
      update: { value: String(price), updatedBy: req.user.id, updatedAt: new Date() },
      create: {
        key: 'delivery_price',
        value: String(price),
        description: 'Fixed delivery fee charged to buyers per order (GHS)',
        category: 'orders',
        updatedBy: req.user.id,
      },
    });
    res.json({ success: true, message: 'Delivery price updated', data: { price: Number(setting.value) } });
  } catch (error) {
    next(error);
  }
});

// ── Auth settings (phone auth) ──────────────────────────────────────────────
router.get('/auth-settings', authenticate, authorize('ADMIN', 'MANAGER', 'SUPER_ADMIN'), async (req, res, next) => {
  try {
    const setting = await prisma.systemSetting.findUnique({ where: { key: 'phone_auth_enabled' } });
    const phoneAuthEnabled = setting ? setting.value === 'true' : false;
    res.json({ success: true, data: { phoneAuthEnabled } });
  } catch (error) { next(error); }
});

router.put('/auth-settings', authenticate, authorize('ADMIN', 'SUPER_ADMIN'), [
  body('phoneAuthEnabled').isBoolean().withMessage('phoneAuthEnabled must be a boolean'),
], async (req, res, next) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) return res.status(400).json({ success: false, errors: errors.array() });
  try {
    const { phoneAuthEnabled } = req.body;
    await prisma.systemSetting.upsert({
      where: { key: 'phone_auth_enabled' },
      update: { value: String(phoneAuthEnabled), updatedBy: req.user.id, updatedAt: new Date() },
      create: {
        key: 'phone_auth_enabled',
        value: String(phoneAuthEnabled),
        description: 'Allow users to register and sign in with a phone number',
        category: 'auth',
        updatedBy: req.user.id,
      },
    });
    res.json({ success: true, message: 'Auth settings updated', data: { phoneAuthEnabled } });
  } catch (error) { next(error); }
});

module.exports = router;