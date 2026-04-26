const express = require('express');
const { prisma } = require('../config/database');
const { authenticate } = require('../middleware/auth');
const { v4: uuidv4 } = require('uuid');

const router = express.Router();

// Sync offline data to server
router.post('/sync', authenticate, async (req, res, next) => {
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
});

// Get data for offline use
router.get('/offline-data', authenticate, async (req, res, next) => {
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
});

// Get sync status
router.get('/status', authenticate, async (req, res, next) => {
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
});

// ─────────────────────────────────────────────────────────────────────────────
// WatermelonDB Sync Protocol
//   Pull:  GET  /api/sync?lastPulledAt=<unix_ms>
//   Push:  POST /api/sync        body: { lastPulledAt, changes }
//
// All tables are keyed by WatermelonDB local id. The `server_id` column stores
// the Postgres CUID so the app can reference server records after sync.
// ─────────────────────────────────────────────────────────────────────────────

// ── Helpers ───────────────────────────────────────────────────────────────────

function mapWaste(r) {
  return {
    id: r.id,
    server_id: r.id,
    source_name: r.sourceName,
    source_type: r.sourceType,
    quantity: r.quantity,
    unit: r.unit,
    date: new Date(r.date).getTime(),
    status: r.status,
    description: r.description ?? null,
    notes: r.notes ?? null,
    location_lat: r.location?.lat ?? null,
    location_lng: r.location?.lng ?? null,
    location_address: r.location?.address ?? null,
    farm_id: r.farmId ?? null,
    supplier_id: r.supplierId ?? null,
    driver_id: r.driverId ?? null,
    carbon_saved: r.carbonSaved ?? null,
    points_awarded: r.pointsAwarded ?? null,
    is_synced: true,
    created_at: new Date(r.createdAt).getTime(),
    updated_at: new Date(r.updatedAt).getTime(),
  };
}

function mapNotification(n) {
  return {
    id: n.id,
    server_id: n.id,
    title: n.title,
    message: n.message,
    type: n.type,
    read: n.read,
    metadata: n.metadata ? JSON.stringify(n.metadata) : null,
    created_at: new Date(n.createdAt).getTime(),
  };
}

function buildWasteWhere(user, since) {
  const where = { updatedAt: { gte: since } };
  if (user.role === 'SUPPLIER') { where.supplierId = user.id; }
  else if (user.role === 'DRIVER') { where.driverId = user.id; }
  else if (user.role === 'MANAGER' && user.farmId) { where.farmId = user.farmId; }
  else if (user.role === 'ADMIN' && user.adminManaged?.id) {
    where.farm = { adminId: user.adminManaged.id };
  }
  return where;
}

// ── PULL ──────────────────────────────────────────────────────────────────────

router.get('/', authenticate, async (req, res, next) => {
  try {
    const lastPulledAt = req.query.lastPulledAt
      ? new Date(parseInt(req.query.lastPulledAt, 10))
      : new Date(0);

    const since = lastPulledAt;
    const now = Date.now();

    const wasteWhere = buildWasteWhere(req.user, since);

    const [allWaste, allNotifs] = await Promise.all([
      prisma.wasteRecord.findMany({ where: wasteWhere }),
      prisma.notification.findMany({
        where: { userId: req.user.id, createdAt: { gte: since } },
        orderBy: { createdAt: 'desc' },
        take: 100,
      }),
    ]);

    // Separate created vs updated (WatermelonDB expects this split)
    const wasteCreated = allWaste.filter(r => new Date(r.createdAt) >= since).map(mapWaste);
    const wasteUpdated = allWaste.filter(r => new Date(r.createdAt) < since).map(mapWaste);
    const notifCreated = allNotifs.map(mapNotification);

    res.json({
      success: true,
      changes: {
        waste_records: {
          created: wasteCreated,
          updated: wasteUpdated,
          deleted: [],
        },
        notifications: {
          created: notifCreated,
          updated: [],
          deleted: [],
        },
      },
      timestamp: now,
    });
  } catch (error) {
    next(error);
  }
});

// ── PUSH ──────────────────────────────────────────────────────────────────────

router.post('/', authenticate, async (req, res, next) => {
  try {
    const { changes } = req.body;
    const wasteChanges = changes?.waste_records ?? { created: [], updated: [], deleted: [] };

    // Process created waste records from client
    for (const raw of wasteChanges.created ?? []) {
      // Check if already on server (client may have a local-only record with no server_id)
      if (raw.server_id) { continue; } // already exists on server

      const duplicate = await prisma.wasteRecord.findFirst({
        where: {
          sourceName: raw.source_name,
          date: new Date(raw.date),
          supplierId: req.user.role === 'SUPPLIER' ? req.user.id : undefined,
        },
      });
      if (duplicate) { continue; }

      await prisma.wasteRecord.create({
        data: {
          id: raw.server_id || uuidv4(),
          sourceName: raw.source_name,
          sourceType: raw.source_type,
          quantity: raw.quantity,
          unit: raw.unit || 'kg',
          date: new Date(raw.date),
          status: 'PENDING',
          description: raw.description ?? null,
          notes: raw.notes ?? null,
          location: (raw.location_lat != null || raw.location_address)
            ? { lat: raw.location_lat, lng: raw.location_lng, address: raw.location_address }
            : undefined,
          farmId: raw.farm_id ?? null,
          supplierId: req.user.role === 'SUPPLIER' ? req.user.id : (raw.supplier_id ?? null),
          recordedById: req.user.id,
        },
      }).catch((err) => {
        // Non-fatal: log and continue
        console.warn('[Sync push] Failed to create waste record:', err.message);
      });
    }

    // Process status updates from client (driver/supplier marking collected etc.)
    for (const raw of wasteChanges.updated ?? []) {
      const serverId = raw.server_id || raw.id;
      if (!serverId) { continue; }
      const allowed = ['PENDING', 'CANCELLED', 'NO_SHOW'];
      if (!allowed.includes(raw.status)) { continue; } // only allow client-side status changes
      await prisma.wasteRecord.updateMany({
        where: { id: serverId, recordedById: req.user.id },
        data: { notes: raw.notes ?? undefined },
      }).catch(() => {});
    }

    res.json({ success: true });
  } catch (error) {
    next(error);
  }
});

// ─────────────────────────────────────────────────────────────────────────────

// Clear pending operations
router.delete('/pending', authenticate, async (req, res, next) => {
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
});

module.exports = router;