const express = require('express');
const { body, validationResult } = require('express-validator');
const { prisma } = require('../config/database');
const { authenticate, authorize } = require('../middleware/auth');
const { AppError } = require('../middleware/errorHandler');
const { generatePDF } = require('../services/pdfService');
const { generateCSV } = require('../services/csvService');
const { generateExcel } = require('../services/excelService');

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