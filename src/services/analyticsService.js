const { prisma } = require('../config/database');
const logger = require('../utils/logger');

class AnalyticsService {
  async getFarmAnalytics(farmId, startDate, endDate) {
    try {
      const where = {
        farmId,
        createdAt: {
          gte: startDate,
          lte: endDate
        }
      };
      
      const [
        wasteAnalytics,
        processingAnalytics,
        salesAnalytics,
        dailyTrends
      ] = await Promise.all([
        this.getWasteAnalytics(farmId, startDate, endDate),
        this.getProcessingAnalytics(farmId, startDate, endDate),
        this.getSalesAnalytics(farmId, startDate, endDate),
        this.getDailyTrends(farmId, startDate, endDate)
      ]);
      
      return {
        period: { startDate, endDate },
        waste: wasteAnalytics,
        processing: processingAnalytics,
        sales: salesAnalytics,
        trends: dailyTrends,
        summary: {
          totalWaste: wasteAnalytics.totalWaste,
          totalRevenue: salesAnalytics.totalRevenue,
          processingEfficiency: processingAnalytics.averageEfficiency,
          carbonSaved: wasteAnalytics.totalCarbonSaved
        }
      };
    } catch (error) {
      logger.error('Farm analytics error:', error);
      return null;
    }
  }

  async getWasteAnalytics(farmId, startDate, endDate) {
    const wasteRecords = await prisma.wasteRecord.findMany({
      where: {
        farmId,
        date: {
          gte: startDate,
          lte: endDate
        }
      }
    });
    
    const totalWaste = wasteRecords.reduce((sum, w) => sum + w.quantity, 0);
    const totalCarbonSaved = wasteRecords.reduce((sum, w) => sum + (w.carbonSaved || 0), 0);
    
    const bySourceType = wasteRecords.reduce((acc, w) => {
      acc[w.sourceType] = (acc[w.sourceType] || 0) + w.quantity;
      return acc;
    }, {});
    
    const byStatus = wasteRecords.reduce((acc, w) => {
      acc[w.status] = (acc[w.status] || 0) + 1;
      return acc;
    }, {});
    
    const dailyAverage = totalWaste / this.getDaysDifference(startDate, endDate);
    
    return {
      totalWaste,
      totalCarbonSaved,
      totalRecords: wasteRecords.length,
      bySourceType,
      byStatus,
      dailyAverage,
      averagePerRecord: totalWaste / (wasteRecords.length || 1)
    };
  }

  async getProcessingAnalytics(farmId, startDate, endDate) {
    const batches = await prisma.processingBatch.findMany({
      where: {
        farmId,
        startDate: {
          gte: startDate,
          lte: endDate
        }
      }
    });
    
    const completedBatches = batches.filter(b => b.status === 'COMPLETED');
    const activeBatches = batches.filter(b => b.status === 'ACTIVE');
    
    const totalInput = completedBatches.reduce((sum, b) => sum + b.quantity, 0);
    const totalLiquidOutput = completedBatches.reduce((sum, b) => sum + (b.liquidOutput || 0), 0);
    const totalFertilizerOutput = completedBatches.reduce((sum, b) => sum + (b.fertilizerOutput || 0), 0);
    
    const averageConversionRate = completedBatches.reduce((sum, b) => sum + (b.conversionRate || 0), 0) / (completedBatches.length || 1);
    const averageProcessingTime = completedBatches.reduce((sum, b) => {
      const duration = new Date(b.endDate) - new Date(b.startDate);
      return sum + duration;
    }, 0) / (completedBatches.length || 1);
    
    return {
      totalBatches: batches.length,
      completedBatches: completedBatches.length,
      activeBatches: activeBatches.length,
      failedBatches: batches.filter(b => b.status === 'FAILED').length,
      totalInput,
      totalLiquidOutput,
      totalFertilizerOutput,
      totalOutput: totalLiquidOutput + totalFertilizerOutput,
      averageConversionRate,
      averageProcessingDays: averageProcessingTime / (1000 * 60 * 60 * 24),
      efficiency: (totalOutput / totalInput) * 100 || 0
    };
  }

  async getSalesAnalytics(farmId, startDate, endDate) {
    const orders = await prisma.order.findMany({
      where: {
        farmId,
        createdAt: {
          gte: startDate,
          lte: endDate
        },
        status: 'COMPLETED'
      },
      include: {
        items: {
          include: {
            variant: {
              include: { product: true }
            }
          }
        }
      }
    });
    
    const totalRevenue = orders.reduce((sum, o) => sum + o.total, 0);
    const totalOrders = orders.length;
    
    const productSales = {};
    orders.forEach(order => {
      order.items.forEach(item => {
        const productName = item.variant.product.name;
        if (!productSales[productName]) {
          productSales[productName] = {
            quantity: 0,
            revenue: 0,
            orders: 0
          };
        }
        productSales[productName].quantity += item.quantity;
        productSales[productName].revenue += item.subtotal;
        productSales[productName].orders += 1;
      });
    });
    
    const averageOrderValue = totalRevenue / (totalOrders || 1);
    const topProducts = Object.entries(productSales)
      .map(([name, data]) => ({ name, ...data }))
      .sort((a, b) => b.revenue - a.revenue)
      .slice(0, 5);
    
    return {
      totalRevenue,
      totalOrders,
      averageOrderValue,
      topProducts,
      productCount: Object.keys(productSales).length,
      revenueGrowth: await this.calculateGrowth(farmId, startDate, endDate)
    };
  }

  async getDailyTrends(farmId, startDate, endDate) {
    const dailyWaste = await prisma.$queryRaw`
      SELECT 
        DATE(date) as date,
        SUM(quantity) as waste,
        COUNT(*) as records
      FROM waste_records
      WHERE farm_id = ${farmId}
        AND date BETWEEN ${startDate} AND ${endDate}
      GROUP BY DATE(date)
      ORDER BY date ASC
    `;
    
    const dailyOrders = await prisma.$queryRaw`
      SELECT 
        DATE(created_at) as date,
        COUNT(*) as orders,
        SUM(total) as revenue
      FROM orders
      WHERE farm_id = ${farmId}
        AND status = 'COMPLETED'
        AND created_at BETWEEN ${startDate} AND ${endDate}
      GROUP BY DATE(created_at)
      ORDER BY date ASC
    `;
    
    const dailyBatches = await prisma.$queryRaw`
      SELECT 
        DATE(start_date) as date,
        COUNT(*) as batches,
        AVG(conversion_rate) as avg_efficiency
      FROM processing_batches
      WHERE farm_id = ${farmId}
        AND start_date BETWEEN ${startDate} AND ${endDate}
      GROUP BY DATE(start_date)
      ORDER BY date ASC
    `;
    
    return {
      waste: dailyWaste,
      orders: dailyOrders,
      batches: dailyBatches
    };
  }

  async getSystemAnalytics() {
    try {
      const [
        totalUsers,
        totalFarms,
        totalWaste,
        totalOrders,
        totalRevenue,
        activeDrivers
      ] = await Promise.all([
        prisma.user.count(),
        prisma.farm.count(),
        prisma.wasteRecord.aggregate({ _sum: { quantity: true } }),
        prisma.order.count({ where: { status: 'COMPLETED' } }),
        prisma.order.aggregate({ where: { status: 'COMPLETED' }, _sum: { total: true } }),
        prisma.driverProfile.count({ where: { status: 'ACTIVE' } })
      ]);
      
      const monthlyGrowth = await this.getMonthlyGrowth();
      
      return {
        users: { total: totalUsers, growth: monthlyGrowth.users },
        farms: { total: totalFarms, growth: monthlyGrowth.farms },
        waste: { total: totalWaste._sum.quantity || 0, growth: monthlyGrowth.waste },
        orders: { total: totalOrders, growth: monthlyGrowth.orders },
        revenue: { total: totalRevenue._sum.total || 0, growth: monthlyGrowth.revenue },
        drivers: { active: activeDrivers },
        monthlyGrowth
      };
    } catch (error) {
      logger.error('System analytics error:', error);
      return null;
    }
  }

  async getMonthlyGrowth() {
    const now = new Date();
    const currentMonth = new Date(now.getFullYear(), now.getMonth(), 1);
    const lastMonth = new Date(now.getFullYear(), now.getMonth() - 1, 1);
    
    const [currentUsers, lastUsers] = await Promise.all([
      prisma.user.count({ where: { createdAt: { gte: currentMonth } } }),
      prisma.user.count({ where: { createdAt: { gte: lastMonth, lt: currentMonth } } })
    ]);
    
    const [currentFarms, lastFarms] = await Promise.all([
      prisma.farm.count({ where: { createdAt: { gte: currentMonth } } }),
      prisma.farm.count({ where: { createdAt: { gte: lastMonth, lt: currentMonth } } })
    ]);
    
    const [currentWaste, lastWaste] = await Promise.all([
      prisma.wasteRecord.aggregate({ where: { date: { gte: currentMonth } }, _sum: { quantity: true } }),
      prisma.wasteRecord.aggregate({ where: { date: { gte: lastMonth, lt: currentMonth } }, _sum: { quantity: true } })
    ]);
    
    const [currentOrders, lastOrders] = await Promise.all([
      prisma.order.count({ where: { createdAt: { gte: currentMonth }, status: 'COMPLETED' } }),
      prisma.order.count({ where: { createdAt: { gte: lastMonth, lt: currentMonth }, status: 'COMPLETED' } })
    ]);
    
    const [currentRevenue, lastRevenue] = await Promise.all([
      prisma.order.aggregate({ where: { createdAt: { gte: currentMonth }, status: 'COMPLETED' }, _sum: { total: true } }),
      prisma.order.aggregate({ where: { createdAt: { gte: lastMonth, lt: currentMonth }, status: 'COMPLETED' }, _sum: { total: true } })
    ]);
    
    const calculateGrowth = (current, last) => {
      if (last === 0) return current > 0 ? 100 : 0;
      return ((current - last) / last) * 100;
    };
    
    return {
      users: calculateGrowth(currentUsers, lastUsers),
      farms: calculateGrowth(currentFarms, lastFarms),
      waste: calculateGrowth(currentWaste._sum.quantity || 0, lastWaste._sum.quantity || 0),
      orders: calculateGrowth(currentOrders, lastOrders),
      revenue: calculateGrowth(currentRevenue._sum.total || 0, lastRevenue._sum.total || 0)
    };
  }

  getDaysDifference(startDate, endDate) {
    const diff = new Date(endDate) - new Date(startDate);
    return Math.max(1, Math.ceil(diff / (1000 * 60 * 60 * 24)));
  }

  async calculateGrowth(farmId, startDate, endDate) {
    const periodLength = this.getDaysDifference(startDate, endDate);
    const previousStart = new Date(startDate);
    previousStart.setDate(previousStart.getDate() - periodLength);
    const previousEnd = startDate;
    
    const [currentRevenue, previousRevenue] = await Promise.all([
      prisma.order.aggregate({
        where: {
          farmId,
          createdAt: { gte: startDate, lte: endDate },
          status: 'COMPLETED'
        },
        _sum: { total: true }
      }),
      prisma.order.aggregate({
        where: {
          farmId,
          createdAt: { gte: previousStart, lte: previousEnd },
          status: 'COMPLETED'
        },
        _sum: { total: true }
      })
    ]);
    
    const current = currentRevenue._sum.total || 0;
    const previous = previousRevenue._sum.total || 0;
    
    if (previous === 0) return current > 0 ? 100 : 0;
    return ((current - previous) / previous) * 100;
  }
}

module.exports = new AnalyticsService();