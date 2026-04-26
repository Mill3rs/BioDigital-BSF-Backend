const { prisma } = require('../config/database');
const { v4: uuidv4 } = require('uuid');

class SyncController {
  // Sync offline data to server
  async syncData(req, res, next) {
    try {
      const { pendingOperations, lastSync } = req.body;
      const results = [];
      const conflicts = [];

      for (const operation of pendingOperations || []) {
        try {
          let result;
          
          switch (operation.action) {
            case 'CREATE_WASTE':
              const existingWaste = await prisma.wasteRecord.findFirst({
                where: {
                  OR: [
                    { id: operation.data.id },
                    { 
                      sourceName: operation.data.sourceName,
                      date: operation.data.date,
                      farmId: operation.data.farmId
                    }
                  ]
                }
              });
              
              if (existingWaste && !operation.data.force) {
                conflicts.push({
                  operationId: operation.id,
                  entityType: 'waste',
                  serverData: existingWaste,
                  clientData: operation.data
                });
              } else {
                result = await prisma.wasteRecord.create({
                  data: {
                    ...operation.data,
                    id: operation.data.id || uuidv4(),
                    recordedById: req.user.id
                  }
                });
                results.push({ success: true, operationId: operation.id, data: result });
              }
              break;
              
            case 'UPDATE_WASTE':
              result = await prisma.wasteRecord.update({
                where: { id: operation.data.id },
                data: operation.data
              });
              results.push({ success: true, operationId: operation.id, data: result });
              break;
              
            case 'CREATE_BATCH':
              result = await prisma.processingBatch.create({
                data: {
                  ...operation.data,
                  id: operation.data.id || uuidv4(),
                  createdById: req.user.id
                }
              });
              results.push({ success: true, operationId: operation.id, data: result });
              break;
              
            case 'UPDATE_BATCH':
              result = await prisma.processingBatch.update({
                where: { id: operation.data.id },
                data: operation.data
              });
              results.push({ success: true, operationId: operation.id, data: result });
              break;
              
            case 'CREATE_ORDER':
              result = await prisma.order.create({
                data: {
                  ...operation.data,
                  id: operation.data.id || uuidv4(),
                  customerId: req.user.id,
                  orderNumber: `ORD-${Date.now()}-${Math.random().toString(36).substr(2, 6)}`
                }
              });
              results.push({ success: true, operationId: operation.id, data: result });
              break;
              
            case 'UPDATE_ORDER':
              result = await prisma.order.update({
                where: { id: operation.data.id },
                data: operation.data
              });
              results.push({ success: true, operationId: operation.id, data: result });
              break;
              
            default:
              results.push({
                success: false,
                operationId: operation.id,
                error: `Unknown action: ${operation.action}`
              });
          }
          
          await prisma.offlineSync.create({
            data: {
              userId: req.user.id,
              action: operation.action,
              entityType: operation.entityType,
              entityId: result?.id,
              data: operation.data,
              status: 'SYNCED',
              syncedAt: new Date()
            }
          });
          
        } catch (error) {
          results.push({
            success: false,
            operationId: operation.id,
            error: error.message
          });
          
          await prisma.offlineSync.create({
            data: {
              userId: req.user.id,
              action: operation.action,
              entityType: operation.entityType,
              data: operation.data,
              status: 'FAILED',
              errorMessage: error.message,
              retryCount: (operation.retryCount || 0) + 1
            }
          });
        }
      }
      
      res.json({
        success: true,
        results,
        conflicts
      });
    } catch (error) {
      next(error);
    }
  }

  // Get data for offline use
  async getOfflineData(req, res, next) {
    try {
      const user = await prisma.user.findUnique({
        where: { id: req.user.id },
        include: {
          farm: true,
          driverProfile: true,
          buyerProfile: true,
          supplierProfile: true
        }
      });
      
      const offlineData = {
        user: {
          id: user.id,
          email: user.email,
          fullName: user.fullName,
          phoneNumber: user.phoneNumber,
          role: user.role,
          status: user.status,
          farm: user.farm
        },
        timestamp: new Date().toISOString(),
        version: '1.0.0'
      };
      
      // Get role-specific data
      if (user.role === 'MANAGER' && user.farm) {
        const [wasteRecords, processingBatches, products, orders] = await Promise.all([
          prisma.wasteRecord.findMany({
            where: { farmId: user.farm.id },
            orderBy: { date: 'desc' },
            take: 100
          }),
          prisma.processingBatch.findMany({
            where: { farmId: user.farm.id },
            include: {
              wasteRecords: true,
              activityLogs: { orderBy: { timestamp: 'desc' }, take: 50 }
            },
            orderBy: { startDate: 'desc' }
          }),
          prisma.product.findMany({
            where: { farmId: user.farm.id, status: 'ACTIVE' },
            include: { variants: true }
          }),
          prisma.order.findMany({
            where: { farmId: user.farm.id },
            include: { items: { include: { variant: { include: { product: true } } } } },
            orderBy: { createdAt: 'desc' },
            take: 50
          })
        ]);
        
        offlineData.wasteRecords = wasteRecords;
        offlineData.processingBatches = processingBatches;
        offlineData.products = products;
        offlineData.orders = orders;
      }
      
      if (user.role === 'DRIVER' && user.driverProfile) {
        const orders = await prisma.order.findMany({
          where: {
            driverId: user.id,
            status: { in: ['PROCESSING', 'SHIPPED', 'OUT_FOR_DELIVERY'] }
          },
          include: {
            items: { include: { variant: { include: { product: true } } } },
            customer: { select: { id: true, fullName: true, phoneNumber: true, email: true } }
          },
          orderBy: { createdAt: 'desc' }
        });
        
        offlineData.orders = orders;
        offlineData.driverProfile = user.driverProfile;
      }
      
      if (user.role === 'BUYER' && user.buyerProfile) {
        const [orders, cart] = await Promise.all([
          prisma.order.findMany({
            where: { customerId: user.id },
            include: { items: { include: { variant: { include: { product: true } } } } },
            orderBy: { createdAt: 'desc' },
            take: 50
          }),
          prisma.cart.findUnique({
            where: { userId: user.id },
            include: { items: { include: { variant: { include: { product: true } } } } }
          })
        ]);
        
        offlineData.orders = orders;
        offlineData.cart = cart;
        offlineData.buyerProfile = user.buyerProfile;
      }
      
      if (user.role === 'SUPPLIER' && user.supplierProfile) {
        const wasteRecords = await prisma.wasteRecord.findMany({
          where: { supplierId: user.id },
          orderBy: { date: 'desc' },
          take: 100
        });
        
        offlineData.wasteRecords = wasteRecords;
        offlineData.supplierProfile = user.supplierProfile;
      }
      
      // Get pending offline operations
      const pendingOps = await prisma.offlineSync.findMany({
        where: {
          userId: req.user.id,
          status: 'FAILED',
          retryCount: { lt: 5 }
        },
        orderBy: { createdAt: 'asc' }
      });
      
      offlineData.pendingOperations = pendingOps;
      
      res.json({ success: true, data: offlineData });
    } catch (error) {
      next(error);
    }
  }

  // Get sync status
  async getSyncStatus(req, res, next) {
    try {
      const [pendingSync, failedSync, lastSuccessfulSync] = await Promise.all([
        prisma.offlineSync.count({
          where: { userId: req.user.id, status: 'PENDING' }
        }),
        prisma.offlineSync.count({
          where: { userId: req.user.id, status: 'FAILED' }
        }),
        prisma.offlineSync.findFirst({
          where: { userId: req.user.id, status: 'SYNCED' },
          orderBy: { syncedAt: 'desc' }
        })
      ]);
      
      res.json({
        success: true,
        data: {
          pendingCount: pendingSync,
          failedCount: failedSync,
          lastSync: lastSuccessfulSync?.syncedAt,
          needsSync: pendingSync > 0 || failedSync > 0
        }
      });
    } catch (error) {
      next(error);
    }
  }

  // Clear pending operations
  async clearPending(req, res, next) {
    try {
      await prisma.offlineSync.deleteMany({
        where: { userId: req.user.id, status: 'PENDING' }
      });
      
      res.json({
        success: true,
        message: 'Pending operations cleared'
      });
    } catch (error) {
      next(error);
    }
  }
}

module.exports = new SyncController();