const express = require('express');
const fs = require('fs');
const path = require('path');
const PDFDocument = require('pdfkit');
const { body, validationResult } = require('express-validator');
const { prisma } = require('../config/database');
const { authenticate, authorize } = require('../middleware/auth');
const { AppError } = require('../middleware/errorHandler');
const { generatePDF } = require('../services/pdfService');
const { generateCSV } = require('../services/csvService');
const { generateExcel } = require('../services/excelService');

const LOGO_PATH = path.join(__dirname, '../assets/logo.png');

const router = express.Router();

// Generate report
router.post('/generate', authenticate, [
  body('type').isIn(['WASTE_SUMMARY', 'PROCESSING_EFFICIENCY', 'FINANCIAL_REPORT', 'CARBON_SAVINGS', 'PRODUCT_SALES', 'FARM_PERFORMANCE', 'DRIVER_PERFORMANCE', 'CUSTOMER_ANALYTICS', 'INVENTORY_REPORT', 'QUALITY_REPORT']),
  body('format').optional().isIn(['PDF', 'CSV', 'EXCEL']),
  body('dateRange.start').optional().isISO8601(),
  body('dateRange.end').optional().isISO8601()
], async (req, res, next) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({ success: false, errors: errors.array() });
  }

  try {
    const { type, format = 'PDF', dateRange, farmId, parameters = {} } = req.body;
    
    let where = {};
    if (dateRange) {
      where.createdAt = {};
      if (dateRange.start) where.createdAt.gte = new Date(dateRange.start);
      if (dateRange.end) where.createdAt.lte = new Date(dateRange.end);
    }
    
    if (req.user.role === 'MANAGER' && req.user.farmId) {
      where.farmId = req.user.farmId;
    } else if (farmId && req.user.role === 'ADMIN') {
      where.farmId = farmId;
    }
    
    let reportData = {};
    let title = '';
    
    switch (type) {
      case 'WASTE_SUMMARY':
        title = 'Waste Collection Summary Report';
        const wasteRecords = await prisma.wasteRecord.findMany({
          where,
          include: { farm: true, supplier: true, driver: true },
          orderBy: { date: 'desc' }
        });
        
        const wasteStats = await prisma.wasteRecord.aggregate({
          where,
          _sum: { quantity: true, carbonSaved: true },
          _count: true
        });
        
        const bySourceType = await prisma.wasteRecord.groupBy({
          by: ['sourceType'],
          where,
          _sum: { quantity: true }
        });
        
        reportData = {
          records: wasteRecords,
          summary: {
            totalWaste: wasteStats._sum.quantity || 0,
            totalCarbonSaved: wasteStats._sum.carbonSaved || 0,
            totalRecords: wasteStats._count,
            bySourceType
          },
          dateRange
        };
        break;
        
      case 'PROCESSING_EFFICIENCY':
        title = 'Processing Efficiency Report';
        const batches = await prisma.processingBatch.findMany({
          where,
          include: { farm: true, qualityChecks: true },
          orderBy: { startDate: 'desc' }
        });
        
        const efficiencyStats = {
          totalBatches: batches.length,
          completedBatches: batches.filter(b => b.status === 'COMPLETED').length,
          averageConversionRate: batches.reduce((sum, b) => sum + (b.conversionRate || 0), 0) / batches.length,
          totalOutput: batches.reduce((sum, b) => sum + (b.liquidOutput || 0) + (b.fertilizerOutput || 0), 0)
        };
        
        reportData = { batches: batches, stats: efficiencyStats, dateRange };
        break;
        
      case 'FINANCIAL_REPORT':
        title = 'Financial Performance Report';
        const orders = await prisma.order.findMany({
          where: { ...where, status: 'COMPLETED' },
          include: { items: { include: { variant: true } }, farm: true }
        });
        
        const financialStats = {
          totalRevenue: orders.reduce((sum, o) => sum + o.total, 0),
          totalOrders: orders.length,
          averageOrderValue: orders.reduce((sum, o) => sum + o.total, 0) / (orders.length || 1),
          byFarm: await prisma.order.groupBy({
            by: ['farmId'],
            where: { status: 'COMPLETED' },
            _sum: { total: true },
            _count: true
          })
        };
        
        reportData = { orders, stats: financialStats, dateRange };
        break;
        
      case 'CARBON_SAVINGS':
        title = 'Carbon Savings Report';
        const carbonRecords = await prisma.wasteRecord.findMany({
          where: { ...where, carbonSaved: { not: null } },
          include: { farm: true }
        });
        
        const carbonStats = {
          totalCarbonSaved: carbonRecords.reduce((sum, r) => sum + (r.carbonSaved || 0), 0),
          byFarm: await prisma.wasteRecord.groupBy({
            by: ['farmId'],
            where: { carbonSaved: { not: null } },
            _sum: { carbonSaved: true }
          }),
          bySourceType: await prisma.wasteRecord.groupBy({
            by: ['sourceType'],
            where: { carbonSaved: { not: null } },
            _sum: { carbonSaved: true }
          })
        };
        
        reportData = { records: carbonRecords, stats: carbonStats, dateRange };
        break;
        
      case 'PRODUCT_SALES':
        title = 'Product Sales Report';
        const productOrders = await prisma.orderItem.findMany({
          where: { order: where },
          include: {
            variant: { include: { product: true } },
            order: { include: { customer: true } }
          }
        });
        
        const productStats = {};
        productOrders.forEach(item => {
          const productName = item.variant.product.name;
          if (!productStats[productName]) {
            productStats[productName] = { quantity: 0, revenue: 0, orders: 0 };
          }
          productStats[productName].quantity += item.quantity;
          productStats[productName].revenue += item.subtotal;
          productStats[productName].orders += 1;
        });
        
        reportData = {
          items: productOrders,
          stats: productStats,
          totalRevenue: productOrders.reduce((sum, i) => sum + i.subtotal, 0),
          totalItems: productOrders.reduce((sum, i) => sum + i.quantity, 0),
          dateRange
        };
        break;
        
      case 'FARM_PERFORMANCE':
        title = 'Farm Performance Report';
        const farms = await prisma.farm.findMany({
          where: farmId ? { id: farmId } : {},
          include: {
            _count: {
              select: { wasteRecords: true, processingBatches: true, products: true, orders: true }
            }
          }
        });
        
        for (const farm of farms) {
          const wasteTotal = await prisma.wasteRecord.aggregate({
            where: { farmId: farm.id },
            _sum: { quantity: true, carbonSaved: true }
          });
          farm.totalWaste = wasteTotal._sum.quantity || 0;
          farm.totalCarbonSaved = wasteTotal._sum.carbonSaved || 0;
          
          const revenue = await prisma.order.aggregate({
            where: { farmId: farm.id, status: 'COMPLETED' },
            _sum: { total: true }
          });
          farm.totalRevenue = revenue._sum.total || 0;
        }
        
        reportData = { farms, dateRange };
        break;
        
      case 'DRIVER_PERFORMANCE':
        title = 'Driver Performance Report';
        const drivers = await prisma.user.findMany({
          where: { role: 'DRIVER' },
          include: {
            driverProfile: true,
            deliveries: {
              where: { status: 'COMPLETED' },
              include: { customer: true }
            }
          }
        });
        
        const driverStats = drivers.map(driver => ({
          id: driver.id,
          name: driver.fullName,
          totalDeliveries: driver.deliveries.length,
          totalRevenue: driver.deliveries.reduce((sum, d) => sum + d.total, 0),
          rating: driver.driverProfile?.rating || 0
        }));
        
        reportData = { drivers: driverStats, dateRange };
        break;
        
      case 'CUSTOMER_ANALYTICS':
        title = 'Customer Analytics Report';
        const customers = await prisma.user.findMany({
          where: { role: 'BUYER' },
          include: {
            buyerProfile: true,
            orders: {
              where: { status: 'COMPLETED' },
              include: { items: true }
            }
          }
        });
        
        const customerStats = customers.map(customer => ({
          id: customer.id,
          name: customer.fullName,
          totalOrders: customer.orders.length,
          totalSpent: customer.orders.reduce((sum, o) => sum + o.total, 0),
          averageOrderValue: customer.orders.reduce((sum, o) => sum + o.total, 0) / (customer.orders.length || 1)
        }));
        
        reportData = { customers: customerStats, dateRange };
        break;
        
      case 'INVENTORY_REPORT':
        title = 'Inventory Report';
        const products = await prisma.product.findMany({
          where: farmId ? { farmId } : {},
          include: {
            variants: true,
            farm: true
          }
        });
        
        const inventoryStats = products.map(product => ({
          id: product.id,
          name: product.name,
          variants: product.variants.map(v => ({
            name: v.name,
            quantity: v.quantity,
            price: v.price,
            value: v.quantity * v.price
          })),
          totalValue: product.variants.reduce((sum, v) => sum + (v.quantity * v.price), 0),
          totalQuantity: product.variants.reduce((sum, v) => sum + v.quantity, 0)
        }));
        
        reportData = { products: inventoryStats, dateRange };
        break;
        
      case 'QUALITY_REPORT':
        title = 'Quality Control Report';
        const qualityChecks = await prisma.qualityCheck.findMany({
          where,
          include: {
            batch: { include: { farm: true } },
            checkedBy: { select: { fullName: true } }
          },
          orderBy: { checkedAt: 'desc' }
        });
        
        const qualityStats = {
          totalChecks: qualityChecks.length,
          passedChecks: qualityChecks.filter(q => q.passed).length,
          failedChecks: qualityChecks.filter(q => !q.passed).length,
          passRate: (qualityChecks.filter(q => q.passed).length / qualityChecks.length) * 100 || 0,
          byType: await prisma.qualityCheck.groupBy({
            by: ['checkType'],
            where,
            _count: true
          })
        };
        
        reportData = { checks: qualityChecks, stats: qualityStats, dateRange };
        break;
    }
    
    // Save report to database
    const report = await prisma.report.create({
      data: {
        type,
        title,
        description: parameters.description || `${title} generated on ${new Date().toLocaleDateString()}`,
        data: reportData,
        parameters: { ...parameters, dateRange, farmId },
        generatedBy: req.user.id,
        farmId: farmId || req.user.farmId || null
      }
    });
    
    // Generate file if requested
    let fileUrl = null;
    if (format !== 'NONE') {
      const reportContent = {
        title,
        generatedAt: new Date().toISOString(),
        generatedBy: req.user.fullName,
        ...reportData
      };
      
      if (format === 'PDF') {
        fileUrl = await generatePDF(reportContent, report.id);
      } else if (format === 'CSV') {
        fileUrl = await generateCSV(reportContent, report.id);
      } else if (format === 'EXCEL') {
        fileUrl = await generateExcel(reportContent, report.id);
      }
      
      await prisma.report.update({
        where: { id: report.id },
        data: { fileUrl }
      });
    }
    
    res.status(201).json({
      success: true,
      message: 'Report generated successfully',
      data: { ...report, fileUrl }
    });
  } catch (error) {
    next(error);
  }
});

// Get my reports
router.get('/', authenticate, async (req, res, next) => {
  try {
    const { type, page = 1, limit = 20 } = req.query;
    const where = { generatedBy: req.user.id };
    
    if (type) where.type = type;
    
    const skip = (page - 1) * limit;
    
    const [reports, total] = await Promise.all([
      prisma.report.findMany({
        where,
        orderBy: { generatedAt: 'desc' },
        skip,
        take: parseInt(limit)
      }),
      prisma.report.count({ where })
    ]);
    
    res.json({
      success: true,
      data: reports,
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

// ─── Helper ────────────────────────────────────────────────────────────────
function buildDateWhere(startDate, endDate, field = 'createdAt') {
  if (!startDate && !endDate) return {};
  const w = {};
  if (startDate) w.gte = new Date(startDate);
  if (endDate) { const d = new Date(endDate); d.setHours(23, 59, 59, 999); w.lte = d; }
  return { [field]: w };
}

// ─── Drivers Report ────────────────────────────────────────────────────────
router.get('/drivers', authenticate, async (req, res, next) => {
  try {
    const { startDate, endDate } = req.query;
    const drivers = await prisma.user.findMany({
      where: { role: 'DRIVER', ...buildDateWhere(startDate, endDate) },
      include: {
        driverProfile: { select: { status: true, vehicleType: true, vehiclePlateNumber: true, rating: true } },
        deliveries: {
          where: buildDateWhere(startDate, endDate),
          select: { id: true, total: true, status: true }
        }
      },
      orderBy: { createdAt: 'desc' }
    });
    const rows = drivers.map(d => ({
      id: d.id,
      name: d.fullName,
      email: d.email ?? '-',
      status: d.driverProfile?.status ?? 'N/A',
      vehicleType: d.driverProfile?.vehicleType ?? '-',
      plateNumber: d.driverProfile?.vehiclePlateNumber ?? '-',
      totalDeliveries: d.deliveries.length,
      completedDeliveries: d.deliveries.filter(x => ['DELIVERED', 'COMPLETED'].includes(x.status)).length,
      earnings: +d.deliveries.filter(x => ['DELIVERED', 'COMPLETED'].includes(x.status)).reduce((s, x) => s + x.total, 0).toFixed(2),
      rating: d.driverProfile?.rating ?? 5,
    }));
    const stats = {
      total: rows.length,
      active: rows.filter(r => ['ACTIVE', 'APPROVED'].includes(r.status)).length,
      totalDeliveries: rows.reduce((s, r) => s + r.totalDeliveries, 0),
      avgRating: rows.length ? +(rows.reduce((s, r) => s + r.rating, 0) / rows.length).toFixed(1) : 0
    };
    res.json({ success: true, data: { stats, rows } });
  } catch (e) { next(e); }
});

// ─── Suppliers Report ──────────────────────────────────────────────────────
router.get('/suppliers', authenticate, async (req, res, next) => {
  try {
    const { startDate, endDate } = req.query;
    const suppliers = await prisma.user.findMany({
      where: { role: 'SUPPLIER', ...buildDateWhere(startDate, endDate) },
      include: {
        supplierProfile: { select: { status: true, totalWasteSupplied: true, pointsBalance: true, pointsEarned: true, rating: true, organizationName: true } },
        payoutRequests: {
          where: { status: 'PAID', ...buildDateWhere(startDate, endDate) },
          select: { amountGhs: true }
        }
      },
      orderBy: { createdAt: 'desc' }
    });
    const rows = suppliers.map(s => ({
      id: s.id,
      name: s.fullName,
      email: s.email ?? '-',
      organization: s.supplierProfile?.organizationName ?? '-',
      status: s.supplierProfile?.status ?? 'N/A',
      wasteSupplied: +(s.supplierProfile?.totalWasteSupplied ?? 0),
      pointsBalance: s.supplierProfile?.pointsBalance ?? 0,
      pointsEarned: s.supplierProfile?.pointsEarned ?? 0,
      totalEarnings: +s.payoutRequests.reduce((sum, p) => sum + p.amountGhs, 0).toFixed(2),
      rating: s.supplierProfile?.rating ?? 5,
    }));
    const stats = {
      total: rows.length,
      active: rows.filter(r => ['ACTIVE', 'APPROVED'].includes(r.status)).length,
      totalWasteKg: +rows.reduce((s, r) => s + r.wasteSupplied, 0).toFixed(2),
      totalEarningsPaid: +rows.reduce((s, r) => s + r.totalEarnings, 0).toFixed(2)
    };
    res.json({ success: true, data: { stats, rows } });
  } catch (e) { next(e); }
});

// ─── Buyers Report ─────────────────────────────────────────────────────────
router.get('/buyers', authenticate, async (req, res, next) => {
  try {
    const { startDate, endDate } = req.query;
    const buyers = await prisma.user.findMany({
      where: { role: 'BUYER', ...buildDateWhere(startDate, endDate) },
      include: {
        buyerProfile: { select: { status: true, companyName: true } },
        orders: {
          where: { status: 'COMPLETED', ...buildDateWhere(startDate, endDate) },
          select: { id: true, total: true, createdAt: true },
          orderBy: { createdAt: 'desc' }
        }
      },
      orderBy: { createdAt: 'desc' }
    });
    const rows = buyers.map(b => ({
      id: b.id,
      name: b.fullName,
      email: b.email ?? '-',
      company: b.buyerProfile?.companyName ?? '-',
      status: b.buyerProfile?.status ?? 'ACTIVE',
      totalOrders: b.orders.length,
      totalSpent: +b.orders.reduce((s, o) => s + o.total, 0).toFixed(2),
      avgOrderValue: b.orders.length ? +(b.orders.reduce((s, o) => s + o.total, 0) / b.orders.length).toFixed(2) : 0,
      lastOrderAt: b.orders[0]?.createdAt ?? null,
    }));
    const totalSpent = +rows.reduce((s, r) => s + r.totalSpent, 0).toFixed(2);
    const withOrders = rows.filter(r => r.totalOrders > 0);
    const stats = {
      total: rows.length,
      withOrders: withOrders.length,
      totalSpent,
      avgOrderValue: withOrders.length ? +(totalSpent / withOrders.reduce((s, r) => s + r.totalOrders, 0)).toFixed(2) : 0
    };
    res.json({ success: true, data: { stats, rows } });
  } catch (e) { next(e); }
});

// ─── Users Report ──────────────────────────────────────────────────────────
router.get('/users', authenticate, async (req, res, next) => {
  try {
    const { startDate, endDate } = req.query;
    const users = await prisma.user.findMany({
      where: { role: { notIn: ['SUPER_ADMIN', 'ADMIN', 'MANAGER'] }, ...buildDateWhere(startDate, endDate) },
      select: { id: true, fullName: true, email: true, role: true, status: true, createdAt: true },
      orderBy: { createdAt: 'desc' }
    });
    const rows = users.map(u => ({ id: u.id, name: u.fullName, email: u.email ?? '-', role: u.role, status: u.status }));
    const byRole = rows.reduce((acc, r) => { acc[r.role] = (acc[r.role] || 0) + 1; return acc; }, {});
    const chartData = Object.entries(byRole).map(([role, count]) => ({ role, count }));
    const stats = {
      total: rows.length,
      buyers: byRole.BUYER ?? 0,
      suppliers: byRole.SUPPLIER ?? 0,
      drivers: byRole.DRIVER ?? 0,
      active: rows.filter(r => r.status === 'ACTIVE').length
    };
    res.json({ success: true, data: { stats, rows, chartData } });
  } catch (e) { next(e); }
});

// ─── Orders Report ─────────────────────────────────────────────────────────
router.get('/orders', authenticate, async (req, res, next) => {
  try {
    const { startDate, endDate } = req.query;
    const orders = await prisma.order.findMany({
      where: { deletedAt: null, ...buildDateWhere(startDate, endDate) },
      include: {
        customer: { select: { fullName: true } },
        driver: { select: { fullName: true } },
        items: { select: { quantity: true } }
      },
      orderBy: { createdAt: 'desc' }
    });
    const rows = orders.map(o => ({
      id: o.id,
      orderNumber: o.orderNumber,
      customer: o.customer.fullName,
      total: o.total,
      status: o.status,
      paymentStatus: o.paymentStatus,
      paymentMethod: o.paymentMethod,
      items: o.items.reduce((s, i) => s + i.quantity, 0),
      driver: o.driver?.fullName ?? '-',
      createdAt: o.createdAt
    }));
    const byDate = {};
    rows.forEach(r => { const d = new Date(r.createdAt).toISOString().slice(0, 10); byDate[d] = (byDate[d] || 0) + 1; });
    const chartData = Object.entries(byDate).sort(([a], [b]) => a.localeCompare(b)).map(([date, count]) => ({ date, count }));
    const byStatus = rows.reduce((acc, r) => { acc[r.status] = (acc[r.status] || 0) + 1; return acc; }, {});
    const stats = {
      total: rows.length,
      pending: byStatus.PENDING ?? 0,
      completed: byStatus.COMPLETED ?? 0,
      cancelled: byStatus.CANCELLED ?? 0,
      totalRevenue: +rows.filter(r => r.status === 'COMPLETED').reduce((s, r) => s + r.total, 0).toFixed(2)
    };
    res.json({ success: true, data: { stats, rows, chartData } });
  } catch (e) { next(e); }
});

// ─── Fleet Report ──────────────────────────────────────────────────────────
router.get('/fleet', authenticate, async (req, res, next) => {
  try {
    const { startDate, endDate } = req.query;
    const vehicles = await prisma.vehicle.findMany({
      include: {
        wasteRecords: {
          where: buildDateWhere(startDate, endDate, 'date'),
          select: { id: true, quantity: true, date: true }
        }
      },
      orderBy: { createdAt: 'desc' }
    });
    const rows = vehicles.map(v => ({
      id: v.id,
      plateNumber: v.plateNumber,
      type: v.type,
      model: v.model ?? '-',
      color: v.color ?? '-',
      isActive: v.isActive,
      totalPickups: v.wasteRecords.length,
      totalWasteCollected: +v.wasteRecords.reduce((s, r) => s + r.quantity, 0).toFixed(2),
      lastUsed: v.wasteRecords.length ? v.wasteRecords.sort((a, b) => new Date(b.date) - new Date(a.date))[0].date : null
    }));
    const stats = {
      total: rows.length,
      active: rows.filter(r => r.isActive).length,
      inactive: rows.filter(r => !r.isActive).length,
      totalPickups: rows.reduce((s, r) => s + r.totalPickups, 0)
    };
    res.json({ success: true, data: { stats, rows } });
  } catch (e) { next(e); }
});

// ─── Payouts Report ────────────────────────────────────────────────────────
router.get('/payouts', authenticate, async (req, res, next) => {
  try {
    const { startDate, endDate } = req.query;
    const payouts = await prisma.payoutRequest.findMany({
      where: buildDateWhere(startDate, endDate),
      include: { supplier: { select: { fullName: true, email: true } } },
      orderBy: { createdAt: 'desc' }
    });
    const rows = payouts.map(p => ({
      id: p.id,
      supplier: p.supplier.fullName,
      email: p.supplier.email ?? '-',
      points: p.points,
      amountGhs: p.amountGhs,
      status: p.status,
      paymentMethod: p.paymentMethod ?? '-',
      adminPaymentMethod: p.adminPaymentMethod ?? '-',
      processedAt: p.processedAt,
      createdAt: p.createdAt
    }));
    const paid = rows.filter(r => r.status === 'PAID');
    const stats = {
      total: rows.length,
      pending: rows.filter(r => r.status === 'PENDING').length,
      approved: rows.filter(r => r.status === 'APPROVED').length,
      paid: paid.length,
      rejected: rows.filter(r => r.status === 'REJECTED').length,
      totalPaidGhs: +paid.reduce((s, r) => s + r.amountGhs, 0).toFixed(2),
      totalPointsRedeemed: paid.reduce((s, r) => s + r.points, 0)
    };
    res.json({ success: true, data: { stats, rows } });
  } catch (e) { next(e); }
});

// ─── Support Report ────────────────────────────────────────────────────────
router.get('/support', authenticate, async (req, res, next) => {
  try {
    const { startDate, endDate } = req.query;
    const tickets = await prisma.supportTicket.findMany({
      where: buildDateWhere(startDate, endDate),
      include: { user: { select: { fullName: true } } },
      orderBy: { createdAt: 'desc' }
    });
    const rows = tickets.map(t => ({
      id: t.id,
      ticketNumber: t.ticketNumber,
      user: t.user.fullName,
      userRole: t.userRole,
      category: t.category,
      title: t.title,
      priority: t.priority,
      status: t.status,
      resolvedAt: t.resolvedAt,
      createdAt: t.createdAt
    }));
    const byCategory = rows.reduce((acc, r) => { acc[r.category] = (acc[r.category] || 0) + 1; return acc; }, {});
    const chartData = Object.entries(byCategory).map(([category, count]) => ({ category, count }));
    const stats = {
      total: rows.length,
      open: rows.filter(r => r.status === 'OPEN').length,
      inProgress: rows.filter(r => r.status === 'IN_PROGRESS').length,
      resolved: rows.filter(r => ['RESOLVED', 'CLOSED'].includes(r.status)).length,
      urgent: rows.filter(r => r.priority === 'URGENT').length
    };
    res.json({ success: true, data: { stats, rows, chartData } });
  } catch (e) { next(e); }
});

// ─── Waste Report ──────────────────────────────────────────────────────────
router.get('/waste', authenticate, async (req, res, next) => {
  try {
    const { startDate, endDate } = req.query;
    const dateFilter = buildDateWhere(startDate, endDate, 'date');
    const records = await prisma.wasteRecord.findMany({
      where: { deletedAt: null, ...dateFilter },
      include: {
        supplier: { select: { fullName: true } },
        driver: { select: { fullName: true } },
        farm: { select: { name: true } }
      },
      orderBy: { date: 'desc' }
    });
    const rows = records.map(r => ({
      id: r.id,
      sourceName: r.sourceName,
      sourceType: r.sourceType,
      quantity: r.quantity,
      unit: r.unit,
      status: r.status,
      supplier: r.supplier?.fullName ?? '-',
      driver: r.driver?.fullName ?? '-',
      farm: r.farm?.name ?? '-',
      carbonSaved: r.carbonSaved ?? 0,
      pointsAwarded: r.pointsAwarded,
      date: r.date
    }));
    const byType = {};
    rows.forEach(r => { byType[r.sourceType] = (byType[r.sourceType] || 0) + r.quantity; });
    const chartData = Object.entries(byType).map(([type, quantity]) => ({ type, quantity: +quantity.toFixed(2) }));
    const agg = await prisma.wasteRecord.aggregate({
      where: { deletedAt: null, ...dateFilter },
      _sum: { quantity: true, carbonSaved: true, pointsAwarded: true },
      _count: true
    });
    const stats = {
      total: agg._count,
      totalKg: +(agg._sum.quantity ?? 0).toFixed(2),
      totalCarbonSaved: +(agg._sum.carbonSaved ?? 0).toFixed(2),
      totalPointsAwarded: agg._sum.pointsAwarded ?? 0,
      pending: rows.filter(r => r.status === 'PENDING').length,
      collected: rows.filter(r => r.status === 'COLLECTED').length
    };
    res.json({ success: true, data: { stats, rows, chartData } });
  } catch (e) { next(e); }
});

// ─── Processed / Unprocessed Waste Report ─────────────────────────────────
router.get('/processed-waste', authenticate, async (req, res, next) => {
  try {
    const { startDate, endDate } = req.query;
    const dateFilter = buildDateWhere(startDate, endDate, 'date');
    const [processed, unprocessed] = await Promise.all([
      prisma.wasteRecord.findMany({
        where: { deletedAt: null, status: 'PROCESSED', ...dateFilter },
        include: { supplier: { select: { fullName: true } }, processingBatch: { select: { batchNumber: true } } },
        orderBy: { date: 'desc' }
      }),
      prisma.wasteRecord.findMany({
        where: { deletedAt: null, status: { in: ['PENDING', 'SCHEDULED', 'COLLECTED', 'ACKNOWLEDGED'] }, ...dateFilter },
        include: { supplier: { select: { fullName: true } } },
        orderBy: { date: 'desc' }
      })
    ]);
    const processedRows = processed.map(r => ({ id: r.id, sourceName: r.sourceName, sourceType: r.sourceType, quantity: r.quantity, unit: r.unit, status: r.status, supplier: r.supplier?.fullName ?? '-', batch: r.processingBatch?.batchNumber ?? '-', category: 'PROCESSED', date: r.date }));
    const unprocessedRows = unprocessed.map(r => ({ id: r.id, sourceName: r.sourceName, sourceType: r.sourceType, quantity: r.quantity, unit: r.unit, status: r.status, supplier: r.supplier?.fullName ?? '-', batch: '-', category: 'UNPROCESSED', date: r.date }));
    const rows = [...processedRows, ...unprocessedRows];
    const processedKg = +processed.reduce((s, r) => s + r.quantity, 0).toFixed(2);
    const unprocessedKg = +unprocessed.reduce((s, r) => s + r.quantity, 0).toFixed(2);
    const chartData = [{ name: 'Processed', value: processedKg }, { name: 'Unprocessed', value: unprocessedKg }];
    const stats = {
      totalProcessed: processed.length,
      totalUnprocessed: unprocessed.length,
      processedKg,
      unprocessedKg,
      carbonSaved: +processed.reduce((s, r) => s + (r.carbonSaved ?? 0), 0).toFixed(2)
    };
    res.json({ success: true, data: { stats, rows, chartData } });
  } catch (e) { next(e); }
});

// ─── Batches Report ────────────────────────────────────────────────────────
router.get('/batches', authenticate, async (req, res, next) => {
  try {
    const { startDate, endDate } = req.query;
    const batches = await prisma.processingBatch.findMany({
      where: buildDateWhere(startDate, endDate, 'startDate'),
      include: {
        farm: { select: { name: true } },
        createdBy: { select: { fullName: true } },
        _count: { select: { wasteRecords: true } }
      },
      orderBy: { startDate: 'desc' }
    });
    const rows = batches.map(b => ({
      id: b.id,
      batchNumber: b.batchNumber,
      name: b.name ?? '-',
      processType: b.processType,
      status: b.status,
      quantity: b.quantity,
      conversionRate: b.conversionRate ?? 0,
      qualityScore: b.qualityScore ?? 0,
      farm: b.farm?.name ?? '-',
      createdBy: b.createdBy.fullName,
      wasteRecords: b._count.wasteRecords,
      startDate: b.startDate,
      endDate: b.endDate
    }));
    const completed = rows.filter(r => r.status === 'COMPLETED');
    const stats = {
      total: rows.length,
      active: rows.filter(r => r.status === 'ACTIVE').length,
      completed: completed.length,
      failed: rows.filter(r => r.status === 'FAILED').length,
      totalInputKg: +rows.reduce((s, r) => s + r.quantity, 0).toFixed(2),
      avgConversionRate: completed.length ? +(completed.reduce((s, r) => s + r.conversionRate, 0) / completed.length).toFixed(1) : 0
    };
    res.json({ success: true, data: { stats, rows } });
  } catch (e) { next(e); }
});

// ─── Harvested Batches Report ──────────────────────────────────────────────
router.get('/harvested', authenticate, async (req, res, next) => {
  try {
    const { startDate, endDate } = req.query;
    const batches = await prisma.processingBatch.findMany({
      where: { status: 'COMPLETED', ...buildDateWhere(startDate, endDate, 'completedAt') },
      include: { farm: { select: { name: true } } },
      orderBy: { completedAt: 'desc' }
    });
    const rows = batches.map(b => ({
      id: b.id,
      batchNumber: b.batchNumber,
      processType: b.processType,
      inputKg: b.quantity,
      liquidOutput: b.liquidOutput ?? 0,
      larvaeOutput: b.larvaeOutput ?? 0,
      fertilizerOutput: b.fertilizerOutput ?? 0,
      conversionRate: b.conversionRate ?? 0,
      qualityScore: b.qualityScore ?? 0,
      farm: b.farm?.name ?? '-',
      completedAt: b.completedAt
    }));
    const stats = {
      total: rows.length,
      totalInputKg: +rows.reduce((s, r) => s + r.inputKg, 0).toFixed(2),
      totalLiquidL: +rows.reduce((s, r) => s + r.liquidOutput, 0).toFixed(2),
      totalLarvaeKg: +rows.reduce((s, r) => s + r.larvaeOutput, 0).toFixed(2),
      totalFertilizerKg: +rows.reduce((s, r) => s + r.fertilizerOutput, 0).toFixed(2),
      avgConversionRate: rows.length ? +(rows.reduce((s, r) => s + r.conversionRate, 0) / rows.length).toFixed(1) : 0
    };
    res.json({ success: true, data: { stats, rows } });
  } catch (e) { next(e); }
});

// ─── Products Report ───────────────────────────────────────────────────────
router.get('/products', authenticate, async (req, res, next) => {
  try {
    const { startDate, endDate } = req.query;
    const products = await prisma.product.findMany({
      where: { deletedAt: null, ...buildDateWhere(startDate, endDate) },
      include: {
        variants: { select: { id: true, quantity: true, price: true, isActive: true } },
        farm: { select: { name: true } }
      },
      orderBy: { createdAt: 'desc' }
    });
    const rows = products.map(p => ({
      id: p.id,
      name: p.name,
      category: p.category,
      status: p.status,
      farm: p.farm?.name ?? '-',
      variantCount: p.variants.length,
      totalStock: p.variants.reduce((s, v) => s + v.quantity, 0),
      totalValue: +p.variants.reduce((s, v) => s + v.quantity * v.price, 0).toFixed(2),
      featured: p.featured,
      rating: p.averageRating,
      reviewCount: p.reviewCount,
      createdAt: p.createdAt
    }));
    const stats = {
      total: rows.length,
      active: rows.filter(r => r.status === 'ACTIVE').length,
      outOfStock: rows.filter(r => r.status === 'OUT_OF_STOCK').length,
      totalStock: rows.reduce((s, r) => s + r.totalStock, 0),
      totalInventoryValue: +rows.reduce((s, r) => s + r.totalValue, 0).toFixed(2)
    };
    res.json({ success: true, data: { stats, rows } });
  } catch (e) { next(e); }
});

// ─── Bags (Product Variants) Report ───────────────────────────────────────
router.get('/bags', authenticate, async (req, res, next) => {
  try {
    const { startDate, endDate } = req.query;
    const variants = await prisma.productVariant.findMany({
      where: buildDateWhere(startDate, endDate),
      include: { product: { select: { name: true, category: true } } },
      orderBy: { createdAt: 'desc' }
    });
    const rows = variants.map(v => ({
      id: v.id,
      product: v.product.name,
      category: v.product.category,
      variantName: v.name,
      sku: v.sku,
      quantity: v.quantity,
      price: v.price,
      cost: v.cost ?? 0,
      unitType: v.unitType,
      unitValue: v.unitValue ?? 0,
      inventoryValue: +(v.quantity * v.price).toFixed(2),
      isActive: v.isActive,
      minOrderQty: v.minOrderQuantity,
      createdAt: v.createdAt
    }));
    const stats = {
      total: rows.length,
      active: rows.filter(r => r.isActive).length,
      lowStock: rows.filter(r => r.quantity > 0 && r.quantity < 10).length,
      outOfStock: rows.filter(r => r.quantity === 0).length,
      totalInventoryValue: +rows.reduce((s, r) => s + r.inventoryValue, 0).toFixed(2)
    };
    res.json({ success: true, data: { stats, rows } });
  } catch (e) { next(e); }
});

// ─── Costs Report ──────────────────────────────────────────────────────────
router.get('/costs', authenticate, async (req, res, next) => {
  try {
    const { startDate, endDate } = req.query;
    const variants = await prisma.productVariant.findMany({
      where: { cost: { not: null }, ...buildDateWhere(startDate, endDate) },
      include: { product: { select: { name: true, category: true } } }
    });
    const rows = variants.map(v => ({
      id: v.id,
      product: v.product.name,
      category: v.product.category,
      variantName: v.name,
      sku: v.sku,
      unitCost: v.cost ?? 0,
      unitPrice: v.price,
      quantity: v.quantity,
      totalCostValue: +((v.cost ?? 0) * v.quantity).toFixed(2),
      totalSaleValue: +(v.price * v.quantity).toFixed(2),
      margin: v.cost ? +(((v.price - v.cost) / v.price) * 100).toFixed(1) : 0
    }));
    const stats = {
      totalVariants: rows.length,
      totalCostValue: +rows.reduce((s, r) => s + r.totalCostValue, 0).toFixed(2),
      totalSaleValue: +rows.reduce((s, r) => s + r.totalSaleValue, 0).toFixed(2),
      avgMargin: rows.length ? +(rows.reduce((s, r) => s + r.margin, 0) / rows.length).toFixed(1) : 0
    };
    res.json({ success: true, data: { stats, rows } });
  } catch (e) { next(e); }
});

// ─── Revenue / Sales Report ────────────────────────────────────────────────
router.get('/revenue', authenticate, async (req, res, next) => {
  try {
    const { startDate, endDate } = req.query;
    const orders = await prisma.order.findMany({
      where: { status: 'COMPLETED', deletedAt: null, ...buildDateWhere(startDate, endDate) },
      include: {
        customer: { select: { fullName: true } },
        items: { select: { quantity: true } }
      },
      orderBy: { createdAt: 'desc' }
    });
    const rows = orders.map(o => ({
      id: o.id,
      orderNumber: o.orderNumber,
      customer: o.customer.fullName,
      items: o.items.reduce((s, i) => s + i.quantity, 0),
      subtotal: o.subtotal,
      tax: o.tax,
      shippingCost: o.shippingCost,
      discount: o.discount,
      total: o.total,
      paymentMethod: o.paymentMethod,
      createdAt: o.createdAt
    }));
    const byDate = {};
    rows.forEach(r => { const d = new Date(r.createdAt).toISOString().slice(0, 10); byDate[d] = (byDate[d] || 0) + r.total; });
    const chartData = Object.entries(byDate).sort(([a], [b]) => a.localeCompare(b)).map(([date, revenue]) => ({ date, revenue: +revenue.toFixed(2) }));
    const stats = {
      totalOrders: rows.length,
      totalRevenue: +rows.reduce((s, r) => s + r.total, 0).toFixed(2),
      avgOrderValue: rows.length ? +(rows.reduce((s, r) => s + r.total, 0) / rows.length).toFixed(2) : 0,
      totalItemsSold: rows.reduce((s, r) => s + r.items, 0)
    };
    res.json({ success: true, data: { stats, rows, chartData } });
  } catch (e) { next(e); }
});

// ─── Processing Report ─────────────────────────────────────────────────────
router.get('/processing', authenticate, async (req, res, next) => {
  try {
    const { startDate, endDate } = req.query;
    const batches = await prisma.processingBatch.findMany({
      where: buildDateWhere(startDate, endDate, 'startDate'),
      select: { id: true, batchNumber: true, processType: true, status: true, quantity: true, conversionRate: true, qualityScore: true, startDate: true }
    });
    const completed = batches.filter(b => b.status === 'COMPLETED');
    const chartData = completed.map(b => ({
      date: new Date(b.startDate).toISOString().slice(0, 10),
      output: +(b.quantity * ((b.conversionRate ?? 0) / 100)).toFixed(2)
    }));
    const stats = {
      total: batches.length,
      completed: completed.length,
      avgConversionRate: completed.length ? +(completed.reduce((s, b) => s + (b.conversionRate ?? 0), 0) / completed.length).toFixed(1) : 0,
      avgQualityScore: completed.length ? +(completed.reduce((s, b) => s + (b.qualityScore ?? 0), 0) / completed.length).toFixed(1) : 0
    };
    res.json({ success: true, data: { stats, rows: batches, chartData } });
  } catch (e) { next(e); }
});

// ─── CSV helpers ───────────────────────────────────────────────────────────

function toCSV(rows) {
  if (!rows || rows.length === 0) return '';
  const headers = Object.keys(rows[0]);
  const esc = (v) => {
    if (v == null) return '';
    const s = v instanceof Date ? v.toISOString().slice(0, 19).replace('T', ' ') : String(v);
    return s.includes(',') || s.includes('"') || s.includes('\n')
      ? `"${s.replace(/"/g, '""')}"` : s;
  };
  return [headers.join(','), ...rows.map(r => headers.map(h => esc(r[h])).join(','))].join('\n');
}

async function fetchExportRows(type, startDate, endDate) {
  switch (type) {
    case 'drivers': {
      const drivers = await prisma.user.findMany({
        where: { role: 'DRIVER', ...buildDateWhere(startDate, endDate) },
        include: {
          driverProfile: { select: { status: true, vehicleType: true, vehiclePlateNumber: true, rating: true } },
          deliveries: { where: buildDateWhere(startDate, endDate), select: { id: true, total: true, status: true } }
        },
        orderBy: { createdAt: 'desc' }
      });
      return drivers.map(d => ({
        name: d.fullName, email: d.email ?? '-', status: d.driverProfile?.status ?? 'N/A',
        vehicleType: d.driverProfile?.vehicleType ?? '-', plateNumber: d.driverProfile?.vehiclePlateNumber ?? '-',
        totalDeliveries: d.deliveries.length,
        completedDeliveries: d.deliveries.filter(x => ['DELIVERED', 'COMPLETED'].includes(x.status)).length,
        earnings: +d.deliveries.filter(x => ['DELIVERED', 'COMPLETED'].includes(x.status)).reduce((s, x) => s + x.total, 0).toFixed(2),
        rating: d.driverProfile?.rating ?? 5
      }));
    }
    case 'suppliers': {
      const suppliers = await prisma.user.findMany({
        where: { role: 'SUPPLIER', ...buildDateWhere(startDate, endDate) },
        include: {
          supplierProfile: { select: { status: true, totalWasteSupplied: true, pointsBalance: true, rating: true, organizationName: true } },
          payoutRequests: { where: { status: 'PAID', ...buildDateWhere(startDate, endDate) }, select: { amountGhs: true } }
        },
        orderBy: { createdAt: 'desc' }
      });
      return suppliers.map(s => ({
        name: s.fullName, email: s.email ?? '-', organization: s.supplierProfile?.organizationName ?? '-',
        status: s.supplierProfile?.status ?? 'N/A',
        wasteSupplied: +(s.supplierProfile?.totalWasteSupplied ?? 0),
        pointsBalance: s.supplierProfile?.pointsBalance ?? 0,
        totalEarnings: +s.payoutRequests.reduce((sum, p) => sum + p.amountGhs, 0).toFixed(2),
        rating: s.supplierProfile?.rating ?? 5
      }));
    }
    case 'buyers': {
      const buyers = await prisma.user.findMany({
        where: { role: 'BUYER', ...buildDateWhere(startDate, endDate) },
        include: {
          buyerProfile: { select: { status: true, companyName: true } },
          orders: { where: { status: 'COMPLETED', ...buildDateWhere(startDate, endDate) }, select: { id: true, total: true, createdAt: true }, orderBy: { createdAt: 'desc' } }
        },
        orderBy: { createdAt: 'desc' }
      });
      return buyers.map(b => ({
        name: b.fullName, email: b.email ?? '-', company: b.buyerProfile?.companyName ?? '-',
        status: b.buyerProfile?.status ?? 'ACTIVE', totalOrders: b.orders.length,
        totalSpent: +b.orders.reduce((s, o) => s + o.total, 0).toFixed(2),
        avgOrderValue: b.orders.length ? +(b.orders.reduce((s, o) => s + o.total, 0) / b.orders.length).toFixed(2) : 0,
        lastOrderAt: b.orders[0]?.createdAt ?? '-'
      }));
    }
    case 'users': {
      const users = await prisma.user.findMany({
        where: { role: { notIn: ['SUPER_ADMIN', 'ADMIN', 'MANAGER'] }, ...buildDateWhere(startDate, endDate) },
        select: { fullName: true, email: true, role: true, status: true, createdAt: true },
        orderBy: { createdAt: 'desc' }
      });
      return users.map(u => ({ name: u.fullName, email: u.email ?? '-', role: u.role, status: u.status }));
    }
    case 'orders': {
      const orders = await prisma.order.findMany({
        where: { deletedAt: null, ...buildDateWhere(startDate, endDate) },
        include: {
          customer: { select: { fullName: true } },
          driver: { select: { fullName: true } },
          items: { select: { quantity: true } }
        },
        orderBy: { createdAt: 'desc' }
      });
      return orders.map(o => ({
        orderNumber: o.orderNumber, customer: o.customer.fullName, total: o.total,
        status: o.status, paymentMethod: o.paymentMethod,
        items: o.items.reduce((s, i) => s + i.quantity, 0),
        driver: o.driver?.fullName ?? '-', date: o.createdAt
      }));
    }
    case 'fleet': {
      const vehicles = await prisma.vehicle.findMany({
        include: { wasteRecords: { where: buildDateWhere(startDate, endDate, 'date'), select: { id: true, quantity: true, date: true } } },
        orderBy: { createdAt: 'desc' }
      });
      return vehicles.map(v => ({
        plateNumber: v.plateNumber, type: v.type, model: v.model ?? '-', color: v.color ?? '-',
        isActive: v.isActive ? 'Yes' : 'No', totalPickups: v.wasteRecords.length,
        totalWasteCollected: +v.wasteRecords.reduce((s, r) => s + r.quantity, 0).toFixed(2),
        lastUsed: v.wasteRecords.length ? v.wasteRecords.sort((a, b) => new Date(b.date) - new Date(a.date))[0].date : '-'
      }));
    }
    case 'payouts': {
      const payouts = await prisma.payoutRequest.findMany({
        where: buildDateWhere(startDate, endDate),
        include: { supplier: { select: { fullName: true, email: true } } },
        orderBy: { createdAt: 'desc' }
      });
      return payouts.map(p => ({
        supplier: p.supplier.fullName, email: p.supplier.email ?? '-',
        points: p.points, amountGhs: p.amountGhs, status: p.status,
        paymentMethod: p.paymentMethod ?? '-', processedAt: p.processedAt ?? '-', date: p.createdAt
      }));
    }
    case 'support': {
      const tickets = await prisma.supportTicket.findMany({
        where: buildDateWhere(startDate, endDate),
        include: { user: { select: { fullName: true } } },
        orderBy: { createdAt: 'desc' }
      });
      return tickets.map(t => ({
        ticketNumber: t.ticketNumber, user: t.user.fullName, userRole: t.userRole,
        category: t.category, title: t.title, priority: t.priority, status: t.status, date: t.createdAt
      }));
    }
    case 'waste': {
      const dateFilter = buildDateWhere(startDate, endDate, 'date');
      const records = await prisma.wasteRecord.findMany({
        where: { deletedAt: null, ...dateFilter },
        include: {
          supplier: { select: { fullName: true } },
          driver: { select: { fullName: true } },
          farm: { select: { name: true } }
        },
        orderBy: { date: 'desc' }
      });
      return records.map(r => ({
        sourceName: r.sourceName, sourceType: r.sourceType, quantity: r.quantity, unit: r.unit,
        status: r.status, supplier: r.supplier?.fullName ?? '-', driver: r.driver?.fullName ?? '-',
        farm: r.farm?.name ?? '-', carbonSaved: r.carbonSaved ?? 0, pointsAwarded: r.pointsAwarded, date: r.date
      }));
    }
    case 'processed-waste': {
      const dateFilter = buildDateWhere(startDate, endDate, 'date');
      const [processed, unprocessed] = await Promise.all([
        prisma.wasteRecord.findMany({
          where: { deletedAt: null, status: 'PROCESSED', ...dateFilter },
          include: { supplier: { select: { fullName: true } }, processingBatch: { select: { batchNumber: true } } },
          orderBy: { date: 'desc' }
        }),
        prisma.wasteRecord.findMany({
          where: { deletedAt: null, status: { in: ['PENDING', 'SCHEDULED', 'COLLECTED', 'ACKNOWLEDGED'] }, ...dateFilter },
          include: { supplier: { select: { fullName: true } } },
          orderBy: { date: 'desc' }
        })
      ]);
      return [
        ...processed.map(r => ({ sourceName: r.sourceName, sourceType: r.sourceType, quantity: r.quantity, unit: r.unit, status: r.status, supplier: r.supplier?.fullName ?? '-', batch: r.processingBatch?.batchNumber ?? '-', category: 'PROCESSED', date: r.date })),
        ...unprocessed.map(r => ({ sourceName: r.sourceName, sourceType: r.sourceType, quantity: r.quantity, unit: r.unit, status: r.status, supplier: r.supplier?.fullName ?? '-', batch: '-', category: 'UNPROCESSED', date: r.date }))
      ];
    }
    case 'batches': {
      const batches = await prisma.processingBatch.findMany({
        where: buildDateWhere(startDate, endDate, 'startDate'),
        include: {
          farm: { select: { name: true } },
          createdBy: { select: { fullName: true } },
          _count: { select: { wasteRecords: true } }
        },
        orderBy: { startDate: 'desc' }
      });
      return batches.map(b => ({
        batchNumber: b.batchNumber, name: b.name ?? '-', processType: b.processType,
        status: b.status, quantity: b.quantity, conversionRate: b.conversionRate ?? 0,
        qualityScore: b.qualityScore ?? 0, farm: b.farm?.name ?? '-',
        createdBy: b.createdBy.fullName, wasteRecords: b._count.wasteRecords,
        startDate: b.startDate, endDate: b.endDate ?? '-'
      }));
    }
    case 'harvested': {
      const batches = await prisma.processingBatch.findMany({
        where: { status: 'COMPLETED', ...buildDateWhere(startDate, endDate, 'completedAt') },
        include: { farm: { select: { name: true } } },
        orderBy: { completedAt: 'desc' }
      });
      return batches.map(b => ({
        batchNumber: b.batchNumber, processType: b.processType, inputKg: b.quantity,
        liquidOutput: b.liquidOutput ?? 0, larvaeOutput: b.larvaeOutput ?? 0,
        fertilizerOutput: b.fertilizerOutput ?? 0, conversionRate: b.conversionRate ?? 0,
        qualityScore: b.qualityScore ?? 0, farm: b.farm?.name ?? '-', completedAt: b.completedAt
      }));
    }
    case 'products': {
      const products = await prisma.product.findMany({
        where: { deletedAt: null, ...buildDateWhere(startDate, endDate) },
        include: {
          variants: { select: { quantity: true, price: true } },
          farm: { select: { name: true } }
        },
        orderBy: { createdAt: 'desc' }
      });
      return products.map(p => ({
        name: p.name, category: p.category, status: p.status, farm: p.farm?.name ?? '-',
        variantCount: p.variants.length,
        totalStock: p.variants.reduce((s, v) => s + v.quantity, 0),
        totalValue: +p.variants.reduce((s, v) => s + v.quantity * v.price, 0).toFixed(2),
        rating: p.averageRating, date: p.createdAt
      }));
    }
    case 'bags': {
      const variants = await prisma.productVariant.findMany({
        where: buildDateWhere(startDate, endDate),
        include: { product: { select: { name: true, category: true } } },
        orderBy: { createdAt: 'desc' }
      });
      return variants.map(v => ({
        product: v.product.name, category: v.product.category,
        variantName: v.name, sku: v.sku, quantity: v.quantity,
        price: v.price, cost: v.cost ?? 0, unitType: v.unitType,
        inventoryValue: +(v.quantity * v.price).toFixed(2),
        isActive: v.isActive ? 'Yes' : 'No', date: v.createdAt
      }));
    }
    case 'costs': {
      const variants = await prisma.productVariant.findMany({
        where: { cost: { not: null }, ...buildDateWhere(startDate, endDate) },
        include: { product: { select: { name: true, category: true } } }
      });
      return variants.map(v => ({
        product: v.product.name, category: v.product.category,
        variantName: v.name, sku: v.sku,
        unitCost: v.cost ?? 0, unitPrice: v.price, quantity: v.quantity,
        totalCostValue: +((v.cost ?? 0) * v.quantity).toFixed(2),
        totalSaleValue: +(v.price * v.quantity).toFixed(2),
        margin: v.cost ? +(((v.price - v.cost) / v.price) * 100).toFixed(1) : 0
      }));
    }
    case 'revenue': {
      const orders = await prisma.order.findMany({
        where: { status: 'COMPLETED', deletedAt: null, ...buildDateWhere(startDate, endDate) },
        include: {
          customer: { select: { fullName: true } },
          items: { select: { quantity: true } }
        },
        orderBy: { createdAt: 'desc' }
      });
      return orders.map(o => ({
        orderNumber: o.orderNumber, customer: o.customer.fullName,
        items: o.items.reduce((s, i) => s + i.quantity, 0),
        subtotal: o.subtotal, shippingCost: o.shippingCost,
        discount: o.discount, total: o.total,
        paymentMethod: o.paymentMethod, date: o.createdAt
      }));
    }
    default: return [];
  }
}

// ─── Export CSV ────────────────────────────────────────────────────────────
router.get('/export/:type', authenticate, async (req, res, next) => {
  try {
    const { type } = req.params;
    const { startDate, endDate } = req.query;
    const validTypes = ['drivers', 'suppliers', 'buyers', 'users', 'orders', 'fleet', 'payouts', 'support', 'waste', 'processed-waste', 'batches', 'harvested', 'products', 'bags', 'costs', 'revenue'];
    if (!validTypes.includes(type)) {
      return res.status(400).json({ success: false, message: 'Invalid report type' });
    }
    const rows = await fetchExportRows(type, startDate, endDate);
    const reportLabel = type.replace(/-/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
    const generatedAt = new Date().toISOString().slice(0, 19).replace('T', ' ');
    const periodLine = startDate || endDate
      ? `Period,${startDate || 'start'} to ${endDate || 'present'}`
      : 'Period,All time';
    const heading = [
      'Company,BioDigital BSF Farm',
      `Report,${reportLabel}`,
      `Generated,${generatedAt}`,
      periodLine,
      ''
    ].join('\n');
    const csv = toCSV(rows);
    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', `attachment; filename="bsf-${type}-report-${Date.now()}.csv"`);
    res.send(heading + (csv || 'No data available for the selected period.\n'));
  } catch (e) { next(e); }
});

// ─── Export PDF ────────────────────────────────────────────────────────────
router.get('/export/pdf/:type', authenticate, async (req, res, next) => {
  try {
    const { type } = req.params;
    const { startDate, endDate } = req.query;
    const validTypes = ['drivers', 'suppliers', 'buyers', 'users', 'orders', 'fleet', 'payouts', 'support', 'waste', 'processed-waste', 'batches', 'harvested', 'products', 'bags', 'costs', 'revenue'];
    if (!validTypes.includes(type)) {
      return res.status(400).json({ success: false, message: 'Invalid report type' });
    }

    const rows = await fetchExportRows(type, startDate, endDate);
    const reportLabel = type.replace(/-/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
    const generatedAt = new Date().toISOString().slice(0, 19).replace('T', ' ');
    const periodLine = startDate || endDate
      ? `${startDate || 'start'} to ${endDate || 'present'}`
      : 'All time';

    const doc = new PDFDocument({ margin: 40, size: 'A4', layout: 'landscape', autoFirstPage: true });
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="bsf-${type}-report-${Date.now()}.pdf"`);
    doc.pipe(res);

    const hasLogo = fs.existsSync(LOGO_PATH);
    const logoW = 52;
    const logoH = 52;
    const headerTextX = hasLogo ? 40 + logoW + 14 : 40;

    // ── Logo ──
    if (hasLogo) {
      doc.image(LOGO_PATH, 40, 28, { width: logoW, height: logoH });
    }

    // ── Company / report heading ──
    doc.font('Helvetica-Bold').fontSize(18).fillColor('#1a7a4a')
      .text('BioDigital BSF Farm', headerTextX, 30, { lineBreak: false });
    doc.font('Helvetica-Bold').fontSize(13).fillColor('#1f2937')
      .text(`${reportLabel} Report`, headerTextX, 52, { lineBreak: false });
    doc.font('Helvetica').fontSize(9).fillColor('#6b7280')
      .text(`Generated: ${generatedAt}   |   Period: ${periodLine}`, headerTextX, 70, { lineBreak: false });

    // ── Divider ──
    const pageW = doc.page.width - 80;
    doc.moveTo(40, 92).lineTo(40 + pageW, 92).strokeColor('#d1fae5').lineWidth(2).stroke();

    // ── Table ──
    const formatCell = (v) => {
      if (v == null) return '';
      if (v instanceof Date) return v.toISOString().slice(0, 10);
      return String(v);
    };

    if (rows.length === 0) {
      doc.font('Helvetica').fontSize(11).fillColor('#9ca3af')
        .text('No data available for the selected period.', 40, 108);
    } else {
      const headers = Object.keys(rows[0]);
      const colWidth = pageW / headers.length;
      const rowH = 20;
      let y = 100;

      const drawHeader = (atY) => {
        doc.rect(40, atY, pageW, rowH).fill('#1a7a4a');
        doc.font('Helvetica-Bold').fontSize(7.5).fillColor('#ffffff');
        headers.forEach((h, i) => {
          const label = h.replace(/([A-Z])/g, ' $1').replace(/^./, c => c.toUpperCase());
          doc.text(label, 44 + i * colWidth, atY + 6, { width: colWidth - 6, lineBreak: false });
        });
      };

      drawHeader(y);
      y += rowH;

      rows.forEach((row, ri) => {
        if (y + rowH > doc.page.height - 50) {
          doc.addPage({ layout: 'landscape' });
          y = 40;
          drawHeader(y);
          y += rowH;
        }
        if (ri % 2 === 0) {
          doc.rect(40, y, pageW, rowH).fill('#f0fdf4');
        }
        doc.font('Helvetica').fontSize(7).fillColor('#374151');
        headers.forEach((h, i) => {
          doc.text(formatCell(row[h]), 44 + i * colWidth, y + 6, { width: colWidth - 6, lineBreak: false });
        });
        y += rowH;
      });

      // ── Row count footer ──
      doc.font('Helvetica').fontSize(8).fillColor('#6b7280')
        .text(`Total records: ${rows.length}`, 40, y + 8);
    }

    doc.end();
  } catch (e) { next(e); }
});

// Get report by ID
router.get('/:id', authenticate, async (req, res, next) => {
  try {
    const report = await prisma.report.findUnique({
      where: { id: req.params.id }
    });
    
    if (!report) {
      throw new AppError('Report not found', 404);
    }
    
    if (report.generatedBy !== req.user.id && req.user.role !== 'SUPER_ADMIN') {
      throw new AppError('Access denied', 403);
    }
    
    res.json({ success: true, data: report });
  } catch (error) {
    next(error);
  }
});

// Download report
router.get('/:id/download', authenticate, async (req, res, next) => {
  try {
    const report = await prisma.report.findUnique({
      where: { id: req.params.id }
    });
    
    if (!report) {
      throw new AppError('Report not found', 404);
    }
    
    if (!report.fileUrl) {
      throw new AppError('No file available for this report', 404);
    }
    
    res.json({ success: true, data: { downloadUrl: report.fileUrl } });
  } catch (error) {
    next(error);
  }
});

// Delete report
router.delete('/:id', authenticate, async (req, res, next) => {
  try {
    const report = await prisma.report.findUnique({
      where: { id: req.params.id }
    });
    
    if (!report) {
      throw new AppError('Report not found', 404);
    }
    
    if (report.generatedBy !== req.user.id && req.user.role !== 'SUPER_ADMIN') {
      throw new AppError('Access denied', 403);
    }
    
    await prisma.report.delete({ where: { id: req.params.id } });
    
    res.json({ success: true, message: 'Report deleted successfully' });
  } catch (error) {
    next(error);
  }
});

// Get report templates
router.get('/templates/list', authenticate, async (req, res) => {
  const templates = [
    { id: 'WASTE_SUMMARY', name: 'Waste Collection Summary', description: 'Overview of all waste collected', category: 'Operations' },
    { id: 'PROCESSING_EFFICIENCY', name: 'Processing Efficiency', description: 'BSF processing efficiency metrics', category: 'Production' },
    { id: 'FINANCIAL_REPORT', name: 'Financial Performance', description: 'Revenue and financial metrics', category: 'Finance' },
    { id: 'CARBON_SAVINGS', name: 'Carbon Savings', description: 'Environmental impact report', category: 'Sustainability' },
    { id: 'PRODUCT_SALES', name: 'Product Sales', description: 'Sales analytics by product', category: 'Sales' },
    { id: 'FARM_PERFORMANCE', name: 'Farm Performance', description: 'Farm KPIs and metrics', category: 'Operations' },
    { id: 'DRIVER_PERFORMANCE', name: 'Driver Performance', description: 'Delivery driver analytics', category: 'Logistics' },
    { id: 'CUSTOMER_ANALYTICS', name: 'Customer Analytics', description: 'Customer behavior insights', category: 'Sales' },
    { id: 'INVENTORY_REPORT', name: 'Inventory Report', description: 'Stock levels and values', category: 'Inventory' },
    { id: 'QUALITY_REPORT', name: 'Quality Control', description: 'Quality check results', category: 'Quality' }
  ];
  
  res.json({ success: true, data: templates });
});

module.exports = router;