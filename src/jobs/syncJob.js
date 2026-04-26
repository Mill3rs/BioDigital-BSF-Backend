const Queue = require('bull');
const { prisma } = require('../config/database');
const { getRedisClient } = require('../config/redis');
const logger = require('../utils/logger');
const { retry } = require('../utils/helpers');

// Create queue
const syncQueue = new Queue('offline-sync', {
  redis: {
    host: process.env.REDIS_HOST || 'localhost',
    port: parseInt(process.env.REDIS_PORT, 10) || 6379,
    password: process.env.REDIS_PASSWORD
  },
  defaultJobOptions: {
    attempts: 3,
    backoff: {
      type: 'exponential',
      delay: 5000
    },
    removeOnComplete: 100,
    removeOnFail: 500
  }
});

// Process sync jobs
syncQueue.process(async (job) => {
  const { userId, pendingOperations, deviceId } = job.data;
  
  logger.info(`Processing sync for user ${userId}, ${pendingOperations.length} operations`);
  
  const results = [];
  const conflicts = [];
  
  for (const operation of pendingOperations) {
    try {
      let result;
      
      switch (operation.action) {
        case 'CREATE_WASTE':
          result = await processCreateWaste(operation.data, userId);
          break;
          
        case 'UPDATE_WASTE':
          result = await processUpdateWaste(operation.data, userId);
          break;
          
        case 'DELETE_WASTE':
          result = await processDeleteWaste(operation.data, userId);
          break;
          
        case 'CREATE_BATCH':
          result = await processCreateBatch(operation.data, userId);
          break;
          
        case 'UPDATE_BATCH':
          result = await processUpdateBatch(operation.data, userId);
          break;
          
        case 'CREATE_ORDER':
          result = await processCreateOrder(operation.data, userId);
          break;
          
        case 'UPDATE_ORDER':
          result = await processUpdateOrder(operation.data, userId);
          break;
          
        case 'CREATE_PRODUCT':
          result = await processCreateProduct(operation.data, userId);
          break;
          
        case 'UPDATE_PRODUCT':
          result = await processUpdateProduct(operation.data, userId);
          break;
          
        default:
          results.push({
            operationId: operation.id,
            success: false,
            error: `Unknown action: ${operation.action}`
          });
          continue;
      }
      
      if (result.conflict) {
        conflicts.push({
          operationId: operation.id,
          entityType: operation.entityType,
          serverData: result.serverData,
          clientData: operation.data
        });
      } else {
        results.push({
          operationId: operation.id,
          success: true,
          data: result.data
        });
        
        // Record successful sync
        await prisma.offlineSync.create({
          data: {
            userId,
            action: operation.action,
            entityType: operation.entityType,
            entityId: result.data?.id,
            data: operation.data,
            status: 'SYNCED',
            syncedAt: new Date()
          }
        });
      }
      
    } catch (error) {
      logger.error(`Sync operation failed for user ${userId}:`, error);
      results.push({
        operationId: operation.id,
        success: false,
        error: error.message
      });
      
      // Record failed sync
      await prisma.offlineSync.create({
        data: {
          userId,
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
  
  // Update last sync timestamp for user
  await prisma.user.update({
    where: { id: userId },
    data: { lastSyncAt: new Date() }
  });
  
  // Notify client via WebSocket if connected
  const io = global.io;
  if (io) {
    io.to(`user-${userId}`).emit('sync:completed', {
      deviceId,
      results,
      conflicts,
      timestamp: new Date()
    });
  }
  
  return { results, conflicts };
});

// Process create waste
async function processCreateWaste(data, userId) {
  const existingWaste = await prisma.wasteRecord.findFirst({
    where: {
      OR: [
        { id: data.id },
        {
          sourceName: data.sourceName,
          date: data.date,
          farmId: data.farmId
        }
      ]
    }
  });
  
  if (existingWaste && !data.force) {
    return { conflict: true, serverData: existingWaste };
  }
  
  const wasteRecord = await prisma.wasteRecord.create({
    data: {
      ...data,
      recordedById: userId,
      syncedAt: new Date()
    }
  });
  
  return { data: wasteRecord };
}

// Process update waste
async function processUpdateWaste(data, userId) {
  const wasteRecord = await prisma.wasteRecord.update({
    where: { id: data.id },
    data: {
      ...data,
      updatedBy: userId,
      updatedAt: new Date()
    }
  });
  
  return { data: wasteRecord };
}

// Process delete waste
async function processDeleteWaste(data, userId) {
  await prisma.wasteRecord.update({
    where: { id: data.id },
    data: { deletedAt: new Date(), deletedBy: userId }
  });
  
  return { data: { id: data.id, deleted: true } };
}

// Process create batch
async function processCreateBatch(data, userId) {
  const existingBatch = await prisma.processingBatch.findFirst({
    where: {
      OR: [
        { id: data.id },
        { batchNumber: data.batchNumber }
      ]
    }
  });
  
  if (existingBatch && !data.force) {
    return { conflict: true, serverData: existingBatch };
  }
  
  const batch = await prisma.processingBatch.create({
    data: {
      ...data,
      createdById: userId,
      syncedAt: new Date()
    }
  });
  
  return { data: batch };
}

// Process update batch
async function processUpdateBatch(data, userId) {
  const batch = await prisma.processingBatch.update({
    where: { id: data.id },
    data: {
      ...data,
      updatedBy: userId,
      updatedAt: new Date()
    }
  });
  
  return { data: batch };
}

// Process create order
async function processCreateOrder(data, userId) {
  const existingOrder = await prisma.order.findFirst({
    where: {
      OR: [
        { id: data.id },
        { orderNumber: data.orderNumber }
      ]
    }
  });
  
  if (existingOrder && !data.force) {
    return { conflict: true, serverData: existingOrder };
  }
  
  const order = await prisma.order.create({
    data: {
      ...data,
      customerId: userId,
      syncedAt: new Date()
    }
  });
  
  return { data: order };
}

// Process update order
async function processUpdateOrder(data, userId) {
  const order = await prisma.order.update({
    where: { id: data.id },
    data: {
      ...data,
      updatedBy: userId,
      updatedAt: new Date()
    }
  });
  
  return { data: order };
}

// Process create product
async function processCreateProduct(data, userId) {
  const existingProduct = await prisma.product.findFirst({
    where: {
      OR: [
        { id: data.id },
        { slug: data.slug }
      ]
    }
  });
  
  if (existingProduct && !data.force) {
    return { conflict: true, serverData: existingProduct };
  }
  
  const product = await prisma.product.create({
    data: {
      ...data,
      createdBy: userId,
      syncedAt: new Date()
    }
  });
  
  return { data: product };
}

// Process update product
async function processUpdateProduct(data, userId) {
  const product = await prisma.product.update({
    where: { id: data.id },
    data: {
      ...data,
      updatedBy: userId,
      updatedAt: new Date()
    }
  });
  
  return { data: product };
}

// Queue event handlers
syncQueue.on('completed', (job, result) => {
  logger.info(`Sync job ${job.id} completed for user ${job.data.userId}`);
});

syncQueue.on('failed', (job, error) => {
  logger.error(`Sync job ${job.id} failed:`, error);
});

syncQueue.on('stalled', (job) => {
  logger.warn(`Sync job ${job.id} stalled`);
});

// Add sync job to queue
const addSyncJob = async (userId, pendingOperations, deviceId) => {
  const job = await syncQueue.add({
    userId,
    pendingOperations,
    deviceId
  }, {
    jobId: `sync-${userId}-${Date.now()}`,
    priority: 1
  });
  
  return job;
};

// Get sync status
const getSyncStatus = async (userId) => {
  const jobs = await syncQueue.getJobs(['active', 'waiting', 'completed', 'failed']);
  const userJobs = jobs.filter(job => job.data.userId === userId);
  
  const lastSuccessfulSync = await prisma.offlineSync.findFirst({
    where: { userId, status: 'SYNCED' },
    orderBy: { syncedAt: 'desc' }
  });
  
  const pendingSync = await prisma.offlineSync.count({
    where: { userId, status: 'PENDING' }
  });
  
  return {
    hasActiveSync: userJobs.some(job => job.active),
    pendingOperations: pendingSync,
    lastSyncAt: lastSuccessfulSync?.syncedAt,
    queueLength: userJobs.length
  };
};

module.exports = {
  syncQueue,
  addSyncJob,
  getSyncStatus
};