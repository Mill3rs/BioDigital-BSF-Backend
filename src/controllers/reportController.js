const { prisma } = require('../config/database');
const { AppError } = require('../middleware/errorHandler');
const { calculatePagination } = require('../utils/helpers');
const { generatePDF } = require('../services/pdfService');
const { generateCSV } = require('../services/csvService');
const { generateExcel } = require('../services/excelService');

class ReportController {
  // Generate report
  async generateReport(req, res, next) {
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
          
          reportData = { batches, stats: efficiencyStats, dateRange };
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
          
        default:
          throw new AppError('Unsupported report type', 400);
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
  }

  // Get my reports
  async getMyReports(req, res, next) {
    try {
      const { type, page = 1, limit = 20 } = req.query;
      const where = { generatedBy: req.user.id };
      
      if (type) where.type = type;
      
      const { skip, pagination } = calculatePagination(page, limit, 0);
      
      const [reports, total] = await Promise.all([
        prisma.report.findMany({
          where,
          orderBy: { generatedAt: 'desc' },
          skip,
          take: pagination.limit
        }),
        prisma.report.count({ where })
      ]);
      
      pagination.total = total;
      pagination.pages = Math.ceil(total / pagination.limit);
      
      res.json({ success: true, data: reports, pagination });
    } catch (error) {
      next(error);
    }
  }

  // Get report by ID
  async getReportById(req, res, next) {
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
  }

  // Download report
  async downloadReport(req, res, next) {
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
  }

  // Delete report
  async deleteReport(req, res, next) {
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
  }

  // Get report templates
  async getTemplates(req, res) {
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
  }
}

module.exports = new ReportController();