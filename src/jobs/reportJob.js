const Queue = require('bull');
const { prisma } = require('../config/database');
const logger = require('../utils/logger');
const { generatePDF } = require('../services/pdfService');
const { generateCSV } = require('../services/csvService');
const { generateExcel } = require('../services/excelService');
const { sendEmail } = require('./emailJob');

// Create queue
const reportQueue = new Queue('report-generation', {
  redis: {
    host: process.env.REDIS_HOST || 'localhost',
    port: parseInt(process.env.REDIS_PORT, 10) || 6379,
    password: process.env.REDIS_PASSWORD
  },
  defaultJobOptions: {
    attempts: 2,
    backoff: 5000,
    removeOnComplete: 50,
    removeOnFail: 100,
    timeout: 300000 // 5 minutes timeout
  }
});

// Process report jobs
reportQueue.process(async (job) => {
  const { 
    reportId, 
    type, 
    format, 
    parameters, 
    userId, 
    emailOnComplete 
  } = job.data;
  
  logger.info(`Generating report ${reportId}: ${type} in ${format} format`);
  
  try {
    // Update report status to processing
    await prisma.report.update({
      where: { id: reportId },
      data: { status: 'PROCESSING', startedAt: new Date() }
    });
    
    // Generate report data based on type
    let reportData;
    switch (type) {
      case 'WASTE_SUMMARY':
        reportData = await generateWasteSummary(parameters);
        break;
      case 'PROCESSING_EFFICIENCY':
        reportData = await generateProcessingEfficiency(parameters);
        break;
      case 'FINANCIAL_REPORT':
        reportData = await generateFinancialReport(parameters);
        break;
      case 'CARBON_SAVINGS':
        reportData = await generateCarbonSavingsReport(parameters);
        break;
      case 'PRODUCT_SALES':
        reportData = await generateProductSalesReport(parameters);
        break;
      case 'FARM_PERFORMANCE':
        reportData = await generateFarmPerformanceReport(parameters);
        break;
      case 'DRIVER_PERFORMANCE':
        reportData = await generateDriverPerformanceReport(parameters);
        break;
      case 'CUSTOMER_ANALYTICS':
        reportData = await generateCustomerAnalytics(parameters);
        break;
      case 'INVENTORY_REPORT':
        reportData = await generateInventoryReport(parameters);
        break;
      case 'QUALITY_REPORT':
        reportData = await generateQualityReport(parameters);
        break;
      default:
        throw new Error(`Unknown report type: ${type}`);
    }
    
    // Generate file
    let fileUrl;
    switch (format) {
      case 'PDF':
        fileUrl = await generatePDF(reportData, reportId);
        break;
      case 'CSV':
        fileUrl = await generateCSV(reportData, reportId);
        break;
      case 'EXCEL':
        fileUrl = await generateExcel(reportData, reportId);
        break;
      default:
        throw new Error(`Unknown format: ${format}`);
    }
    
    // Update report with file URL
    await prisma.report.update({
      where: { id: reportId },
      data: {
        fileUrl,
        status: 'COMPLETED',
        completedAt: new Date(),
        data: reportData
      }
    });
    
    // Send email notification if requested
    if (emailOnComplete) {
      const user = await prisma.user.findUnique({
        where: { id: userId },
        select: { email: true, fullName: true }
      });
      
      if (user) {
        await sendEmail('reportReady', user.email, {
          report: { id: reportId, title: reportData.title },
          userName: user.fullName
        });
      }
    }
    
    logger.info(`Report ${reportId} generated successfully`);
    
    return { reportId, fileUrl, format };
    
  } catch (error) {
    logger.error(`Report generation failed for ${reportId}:`, error);
    
    // Update report status to failed
    await prisma.report.update({
      where: { id: reportId },
      data: {
        status: 'FAILED',
        failedAt: new Date(),
        errorMessage: error.message
      }
    });
    
    throw error;
  }
});

// Report generation functions
async function generateWasteSummary(parameters) {
  const { farmId, startDate, endDate } = parameters;
  
  const wasteRecords = await prisma.wasteRecord.findMany({
    where: {
      farmId,
      date: { gte: startDate, lte: endDate }
    },
    include: { farm: true, supplier: true }
  });
  
  const summary = {
    totalWaste: wasteRecords.reduce((sum, w) => sum + w.quantity, 0),
    totalRecords: wasteRecords.length,
    bySourceType: {},
    byStatus: {},
    dailyAverage: wasteRecords.length / getDaysDifference(startDate, endDate)
  };
  
  wasteRecords.forEach(record => {
    summary.bySourceType[record.sourceType] = (summary.bySourceType[record.sourceType] || 0) + record.quantity;
    summary.byStatus[record.status] = (summary.byStatus[record.status] || 0) + 1;
  });
  
  return {
    title: 'Waste Collection Summary',
    period: { startDate, endDate },
    records: wasteRecords,
    summary,
    generatedAt: new Date()
  };
}

async function generateProcessingEfficiency(parameters) {
  const { farmId, startDate, endDate } = parameters;
  
  const batches = await prisma.processingBatch.findMany({
    where: {
      farmId,
      startDate: { gte: startDate, lte: endDate }
    },
    include: { qualityChecks: true }
  });
  
  const completedBatches = batches.filter(b => b.status === 'COMPLETED');
  
  const efficiency = {
    totalBatches: batches.length,
    completedBatches: completedBatches.length,
    averageConversionRate: completedBatches.reduce((sum, b) => sum + (b.conversionRate || 0), 0) / (completedBatches.length || 1),
    totalInput: completedBatches.reduce((sum, b) => sum + b.quantity, 0),
    totalOutput: completedBatches.reduce((sum, b) => sum + (b.fertilizerOutput || 0) + (b.liquidOutput || 0), 0),
    averageProcessingTime: calculateAverageProcessingTime(completedBatches)
  };
  
  return {
    title: 'Processing Efficiency Report',
    period: { startDate, endDate },
    batches,
    efficiency,
    generatedAt: new Date()
  };
}

async function generateFinancialReport(parameters) {
  const { farmId, startDate, endDate } = parameters;
  
  const orders = await prisma.order.findMany({
    where: {
      farmId,
      status: 'COMPLETED',
      createdAt: { gte: startDate, lte: endDate }
    },
    include: { items: { include: { variant: { include: { product: true } } } } }
  });
  
  const revenue = orders.reduce((sum, o) => sum + o.total, 0);
  const productSales = {};
  
  orders.forEach(order => {
    order.items.forEach(item => {
      const productName = item.variant.product.name;
      if (!productSales[productName]) {
        productSales[productName] = { quantity: 0, revenue: 0 };
      }
      productSales[productName].quantity += item.quantity;
      productSales[productName].revenue += item.subtotal;
    });
  });
  
  return {
    title: 'Financial Performance Report',
    period: { startDate, endDate },
    summary: {
      totalRevenue: revenue,
      totalOrders: orders.length,
      averageOrderValue: revenue / (orders.length || 1),
      topProducts: Object.entries(productSales)
        .sort((a, b) => b[1].revenue - a[1].revenue)
        .slice(0, 5)
        .map(([name, data]) => ({ name, ...data }))
    },
    orders: orders.slice(0, 100),
    generatedAt: new Date()
  };
}

async function generateCarbonSavingsReport(parameters) {
  const { farmId, startDate, endDate } = parameters;
  
  const wasteRecords = await prisma.wasteRecord.findMany({
    where: {
      farmId,
      date: { gte: startDate, lte: endDate },
      carbonSaved: { not: null }
    }
  });
  
  const totalCarbonSaved = wasteRecords.reduce((sum, w) => sum + (w.carbonSaved || 0), 0);
  
  return {
    title: 'Carbon Savings Report',
    period: { startDate, endDate },
    summary: {
      totalCarbonSaved,
      averagePerRecord: totalCarbonSaved / (wasteRecords.length || 1),
      equivalentTrees: Math.floor(totalCarbonSaved / 22),
      equivalentCarMiles: Math.floor(totalCarbonSaved / 0.4)
    },
    records: wasteRecords,
    generatedAt: new Date()
  };
}

async function generateProductSalesReport(parameters) {
  const { farmId, startDate, endDate } = parameters;
  
  const orderItems = await prisma.orderItem.findMany({
    where: {
      order: {
        farmId,
        status: 'COMPLETED',
        createdAt: { gte: startDate, lte: endDate }
      }
    },
    include: {
      variant: { include: { product: true } },
      order: true
    }
  });
  
  const productStats = {};
  orderItems.forEach(item => {
    const productName = item.variant.product.name;
    if (!productStats[productName]) {
      productStats[productName] = { quantity: 0, revenue: 0, orders: new Set() };
    }
    productStats[productName].quantity += item.quantity;
    productStats[productName].revenue += item.subtotal;
    productStats[productName].orders.add(item.orderId);
  });
  
  return {
    title: 'Product Sales Report',
    period: { startDate, endDate },
    products: Object.entries(productStats).map(([name, data]) => ({
      name,
      quantity: data.quantity,
      revenue: data.revenue,
      orders: data.orders.size,
      averagePrice: data.revenue / data.quantity
    })),
    totalRevenue: orderItems.reduce((sum, i) => sum + i.subtotal, 0),
    totalItems: orderItems.length,
    generatedAt: new Date()
  };
}

async function generateFarmPerformanceReport(parameters) {
  const { farmId, startDate, endDate } = parameters;
  
  const farm = await prisma.farm.findUnique({
    where: { id: farmId },
    include: {
      wasteRecords: {
        where: { date: { gte: startDate, lte: endDate } }
      },
      processingBatches: {
        where: { startDate: { gte: startDate, lte: endDate } }
      },
      orders: {
        where: { createdAt: { gte: startDate, lte: endDate }, status: 'COMPLETED' }
      }
    }
  });
  
  const wasteTotal = farm.wasteRecords.reduce((sum, w) => sum + w.quantity, 0);
  const revenueTotal = farm.orders.reduce((sum, o) => sum + o.total, 0);
  const processedTotal = farm.processingBatches
    .filter(b => b.status === 'COMPLETED')
    .reduce((sum, b) => sum + b.quantity, 0);
  
  return {
    title: `Farm Performance Report - ${farm.name}`,
    period: { startDate, endDate },
    farm: {
      name: farm.name,
      type: farm.type,
      location: { country: farm.country, region: farm.region }
    },
    metrics: {
      totalWasteCollected: wasteTotal,
      totalWasteProcessed: processedTotal,
      processingRate: wasteTotal > 0 ? (processedTotal / wasteTotal) * 100 : 0,
      totalRevenue: revenueTotal,
      totalOrders: farm.orders.length,
      activeBatches: farm.processingBatches.filter(b => b.status === 'ACTIVE').length
    },
    generatedAt: new Date()
  };
}

async function generateDriverPerformanceReport(parameters) {
  const { farmId, startDate, endDate, driverId } = parameters;
  
  const where = {
    driverId,
    status: 'DELIVERED',
    deliveredAt: { gte: startDate, lte: endDate }
  };
  
  const deliveries = await prisma.order.findMany({
    where,
    include: { customer: true }
  });
  
  const totalDeliveries = deliveries.length;
  const totalRevenue = deliveries.reduce((sum, d) => sum + d.total, 0);
  const averageRating = await getDriverRating(driverId);
  
  return {
    title: 'Driver Performance Report',
    period: { startDate, endDate },
    driver: await getDriverDetails(driverId),
    metrics: {
      totalDeliveries,
      totalRevenue,
      averageOrderValue: totalRevenue / (totalDeliveries || 1),
      averageRating,
      onTimeRate: calculateOnTimeRate(deliveries)
    },
    deliveries: deliveries.slice(0, 50),
    generatedAt: new Date()
  };
}

async function generateCustomerAnalytics(parameters) {
  const { farmId, startDate, endDate } = parameters;
  
  const orders = await prisma.order.findMany({
    where: {
      farmId,
      status: 'COMPLETED',
      createdAt: { gte: startDate, lte: endDate }
    },
    include: { customer: true }
  });
  
  const customerStats = {};
  orders.forEach(order => {
    if (!customerStats[order.customerId]) {
      customerStats[order.customerId] = {
        name: order.customer.fullName,
        email: order.customer.email,
        orders: 0,
        totalSpent: 0,
        firstOrder: order.createdAt,
        lastOrder: order.createdAt
      };
    }
    const stats = customerStats[order.customerId];
    stats.orders++;
    stats.totalSpent += order.total;
    if (order.createdAt < stats.firstOrder) stats.firstOrder = order.createdAt;
    if (order.createdAt > stats.lastOrder) stats.lastOrder = order.createdAt;
  });
  
  const customers = Object.values(customerStats);
  const repeatCustomers = customers.filter(c => c.orders > 1);
  
  return {
    title: 'Customer Analytics Report',
    period: { startDate, endDate },
    summary: {
      totalCustomers: customers.length,
      repeatCustomers: repeatCustomers.length,
      newCustomers: customers.filter(c => c.orders === 1).length,
      averageOrderValue: orders.reduce((sum, o) => sum + o.total, 0) / (orders.length || 1),
      customerLifetimeValue: customers.reduce((sum, c) => sum + c.totalSpent, 0) / (customers.length || 1)
    },
    topCustomers: customers.sort((a, b) => b.totalSpent - a.totalSpent).slice(0, 10),
    generatedAt: new Date()
  };
}

async function generateInventoryReport(parameters) {
  const { farmId } = parameters;
  
  const products = await prisma.product.findMany({
    where: { farmId },
    include: { variants: true }
  });
  
  const lowStock = [];
  const outOfStock = [];
  let totalValue = 0;
  
  products.forEach(product => {
    product.variants.forEach(variant => {
      const value = variant.quantity * variant.price;
      totalValue += value;
      
      if (variant.quantity === 0) {
        outOfStock.push({ product: product.name, variant: variant.name });
      } else if (variant.quantity < variant.minOrderQuantity * 2) {
        lowStock.push({ 
          product: product.name, 
          variant: variant.name, 
          quantity: variant.quantity,
          reorderLevel: variant.minOrderQuantity
        });
      }
    });
  });
  
  return {
    title: 'Inventory Report',
    generatedAt: new Date(),
    summary: {
      totalProducts: products.length,
      totalVariants: products.reduce((sum, p) => sum + p.variants.length, 0),
      totalInventoryValue: totalValue,
      lowStockCount: lowStock.length,
      outOfStockCount: outOfStock.length
    },
    lowStock,
    outOfStock,
    products: products.map(p => ({
      name: p.name,
      variants: p.variants.map(v => ({
        name: v.name,
        quantity: v.quantity,
        price: v.price,
        value: v.quantity * v.price
      }))
    }))
  };
}

async function generateQualityReport(parameters) {
  const { farmId, startDate, endDate } = parameters;
  
  const qualityChecks = await prisma.qualityCheck.findMany({
    where: {
      batch: { farmId },
      checkedAt: { gte: startDate, lte: endDate }
    },
    include: { batch: true, checkedBy: true }
  });
  
  const passed = qualityChecks.filter(q => q.passed);
  const failed = qualityChecks.filter(q => !q.passed);
  
  const byType = {};
  qualityChecks.forEach(check => {
    if (!byType[check.checkType]) {
      byType[check.checkType] = { total: 0, passed: 0, failed: 0 };
    }
    byType[check.checkType].total++;
    if (check.passed) {
      byType[check.checkType].passed++;
    } else {
      byType[check.checkType].failed++;
    }
  });
  
  return {
    title: 'Quality Control Report',
    period: { startDate, endDate },
    summary: {
      totalChecks: qualityChecks.length,
      passedChecks: passed.length,
      failedChecks: failed.length,
      passRate: qualityChecks.length > 0 ? (passed.length / qualityChecks.length) * 100 : 0
    },
    byType,
    recentFailures: failed.slice(0, 20),
    generatedAt: new Date()
  };
}

// Helper functions
function getDaysDifference(startDate, endDate) {
  const diff = new Date(endDate) - new Date(startDate);
  return Math.max(1, Math.ceil(diff / (1000 * 60 * 60 * 24)));
}

function calculateAverageProcessingTime(batches) {
  if (batches.length === 0) return 0;
  const totalDays = batches.reduce((sum, batch) => {
    const days = (new Date(batch.endDate) - new Date(batch.startDate)) / (1000 * 60 * 60 * 24);
    return sum + days;
  }, 0);
  return totalDays / batches.length;
}

async function getDriverRating(driverId) {
  const profile = await prisma.driverProfile.findUnique({
    where: { userId: driverId },
    select: { rating: true }
  });
  return profile?.rating || 0;
}

async function getDriverDetails(driverId) {
  const user = await prisma.user.findUnique({
    where: { id: driverId },
    select: { fullName: true, email: true, phoneNumber: true }
  });
  return user;
}

function calculateOnTimeRate(deliveries) {
  // Implementation depends on delivery time windows
  return 95; // Placeholder
}

// Queue event handlers
reportQueue.on('completed', (job, result) => {
  logger.info(`Report job ${job.id} completed: ${result.reportId}`);
});

reportQueue.on('failed', (job, error) => {
  logger.error(`Report job ${job.id} failed:`, error);
});

// Add report job to queue
const generateReport = async (reportId, type, format, parameters, userId, emailOnComplete = false) => {
  const job = await reportQueue.add({
    reportId,
    type,
    format,
    parameters,
    userId,
    emailOnComplete
  }, {
    priority: format === 'PDF' ? 1 : 2,
    jobId: `report-${reportId}`
  });
  
  return job;
};

// Get queue stats
const getReportQueueStats = async () => {
  const [waiting, active, completed, failed] = await Promise.all([
    reportQueue.getWaitingCount(),
    reportQueue.getActiveCount(),
    reportQueue.getCompletedCount(),
    reportQueue.getFailedCount()
  ]);
  
  return { waiting, active, completed, failed };
};

module.exports = {
  reportQueue,
  generateReport,
  getReportQueueStats
};