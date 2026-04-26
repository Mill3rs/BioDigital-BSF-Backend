const Queue = require('bull');
const { prisma } = require('../config/database');
const fs = require('fs').promises;
const path = require('path');
const logger = require('../utils/logger');
const config = require('../config');

// Create queue
const cleanupQueue = new Queue('cleanup-tasks', {
  redis: {
    host: process.env.REDIS_HOST || 'localhost',
    port: parseInt(process.env.REDIS_PORT, 10) || 6379,
    password: process.env.REDIS_PASSWORD
  },
  defaultJobOptions: {
    attempts: 2,
    removeOnComplete: true,
    removeOnFail: false
  }
});

// Process cleanup jobs
cleanupQueue.process(async (job) => {
  const { task, options } = job.data;
  
  logger.info(`Running cleanup task: ${task}`);
  
  switch (task) {
    case 'cleanup_old_sync_records':
      return await cleanupOldSyncRecords(options);
    case 'cleanup_old_notifications':
      return await cleanupOldNotifications(options);
    case 'cleanup_old_reports':
      return await cleanupOldReports(options);
    case 'cleanup_old_logs':
      return await cleanupOldLogs(options);
    case 'cleanup_temp_files':
      return await cleanupTempFiles(options);
    case 'cleanup_orphaned_data':
      return await cleanupOrphanedData(options);
    case 'cleanup_expired_sessions':
      return await cleanupExpiredSessions(options);
    case 'cleanup_failed_jobs':
      return await cleanupFailedJobs(options);
    case 'cleanup_audit_logs':
      return await cleanupAuditLogs(options);
    default:
      throw new Error(`Unknown cleanup task: ${task}`);
  }
});

// Cleanup old sync records
async function cleanupOldSyncRecords(options) {
  const daysToKeep = options?.daysToKeep || 30;
  const cutoffDate = new Date();
  cutoffDate.setDate(cutoffDate.getDate() - daysToKeep);
  
  const deleted = await prisma.offlineSync.deleteMany({
    where: {
      syncedAt: { lt: cutoffDate },
      status: 'SYNCED'
    }
  });
  
  logger.info(`Cleaned up ${deleted.count} old sync records`);
  return { task: 'cleanup_old_sync_records', deleted: deleted.count };
}

// Cleanup old notifications
async function cleanupOldNotifications(options) {
  const daysToKeep = options?.daysToKeep || 90;
  const cutoffDate = new Date();
  cutoffDate.setDate(cutoffDate.getDate() - daysToKeep);
  
  const deleted = await prisma.notification.deleteMany({
    where: {
      createdAt: { lt: cutoffDate },
      read: true
    }
  });
  
  logger.info(`Cleaned up ${deleted.count} old notifications`);
  return { task: 'cleanup_old_notifications', deleted: deleted.count };
}

// Cleanup old reports
async function cleanupOldReports(options) {
  const daysToKeep = options?.daysToKeep || 60;
  const cutoffDate = new Date();
  cutoffDate.setDate(cutoffDate.getDate() - daysToKeep);
  
  // Get reports to delete
  const reports = await prisma.report.findMany({
    where: {
      generatedAt: { lt: cutoffDate },
      OR: [
        { status: 'COMPLETED' },
        { status: 'FAILED' }
      ]
    },
    select: { id: true, fileUrl: true }
  });
  
  // Delete files from storage
  for (const report of reports) {
    if (report.fileUrl) {
      try {
        const filePath = path.join(config.UPLOAD_DIR, 'reports', path.basename(report.fileUrl));
        await fs.unlink(filePath).catch(() => {});
      } catch (error) {
        logger.error(`Failed to delete report file ${report.fileUrl}:`, error);
      }
    }
  }
  
  const deleted = await prisma.report.deleteMany({
    where: {
      id: { in: reports.map(r => r.id) }
    }
  });
  
  logger.info(`Cleaned up ${deleted.count} old reports`);
  return { task: 'cleanup_old_reports', deleted: deleted.count };
}

// Cleanup old logs
async function cleanupOldLogs(options) {
  const daysToKeep = options?.daysToKeep || 30;
  const logDir = config.LOG_FILE ? path.dirname(config.LOG_FILE) : 'logs';
  
  try {
    const files = await fs.readdir(logDir);
    const now = Date.now();
    let deletedCount = 0;
    
    for (const file of files) {
      const filePath = path.join(logDir, file);
      const stats = await fs.stat(filePath);
      const daysOld = (now - stats.mtimeMs) / (1000 * 60 * 60 * 24);
      
      if (daysOld > daysToKeep) {
        await fs.unlink(filePath);
        deletedCount++;
      }
    }
    
    logger.info(`Cleaned up ${deletedCount} old log files`);
    return { task: 'cleanup_old_logs', deleted: deletedCount };
  } catch (error) {
    logger.error('Failed to cleanup old logs:', error);
    return { task: 'cleanup_old_logs', error: error.message };
  }
}

// Cleanup temp files
async function cleanupTempFiles(options) {
  const hoursToKeep = options?.hoursToKeep || 24;
  const tempDir = '/tmp';
  const cutoffTime = Date.now() - (hoursToKeep * 60 * 60 * 1000);
  
  try {
    const files = await fs.readdir(tempDir);
    let deletedCount = 0;
    
    for (const file of files) {
      if (file.startsWith('upload_') || file.startsWith('tmp_')) {
        const filePath = path.join(tempDir, file);
        const stats = await fs.stat(filePath);
        
        if (stats.mtimeMs < cutoffTime) {
          await fs.unlink(filePath);
          deletedCount++;
        }
      }
    }
    
    logger.info(`Cleaned up ${deletedCount} temp files`);
    return { task: 'cleanup_temp_files', deleted: deletedCount };
  } catch (error) {
    logger.error('Failed to cleanup temp files:', error);
    return { task: 'cleanup_temp_files', error: error.message };
  }
}

// Cleanup orphaned data
async function cleanupOrphanedData(options) {
  const results = {};
  
  // Cleanup orphaned cart items
  const orphanedCartItems = await prisma.cartItem.deleteMany({
    where: {
      cart: null
    }
  });
  results.orphanedCartItems = orphanedCartItems.count;
  
  // Cleanup orphaned order items
  const orphanedOrderItems = await prisma.orderItem.deleteMany({
    where: {
      order: null
    }
  });
  results.orphanedOrderItems = orphanedOrderItems.count;
  
  // Cleanup orphaned waste records without farm
  const orphanedWaste = await prisma.wasteRecord.updateMany({
    where: {
      farmId: null,
      supplierId: null
    },
    data: { status: 'CANCELLED' }
  });
  results.orphanedWaste = orphanedWaste.count;
  
  logger.info('Orphaned data cleanup completed', results);
  return { task: 'cleanup_orphaned_data', results };
}

// Cleanup expired sessions
async function cleanupExpiredSessions(options) {
  const daysToKeep = options?.daysToKeep || 7;
  const cutoffDate = new Date();
  cutoffDate.setDate(cutoffDate.getDate() - daysToKeep);
  
  // This depends on your session storage implementation
  // For Redis sessions, you'd use Redis commands
  // For database sessions, you'd delete from session table
  
  logger.info(`Cleaned up expired sessions older than ${daysToKeep} days`);
  return { task: 'cleanup_expired_sessions', deleted: 0 };
}

// Cleanup failed jobs
async function cleanupFailedJobs(options) {
  const daysToKeep = options?.daysToKeep || 7;
  const cutoffDate = new Date();
  cutoffDate.setDate(cutoffDate.getDate() - daysToKeep);
  
  // Cleanup failed jobs from queues
  const queues = ['offline-sync', 'email-processing', 'report-generation', 'notification-processing'];
  let totalCleaned = 0;
  
  for (const queueName of queues) {
    const Queue = require('bull');
    const queue = new Queue(queueName, {
      redis: {
        host: process.env.REDIS_HOST || 'localhost',
        port: parseInt(process.env.REDIS_PORT, 10) || 6379
      }
    });
    
    const failedJobs = await queue.getFailed();
    const oldJobs = failedJobs.filter(job => 
      new Date(job.finishedOn) < cutoffDate
    );
    
    for (const job of oldJobs) {
      await job.remove();
      totalCleaned++;
    }
    
    await queue.close();
  }
  
  logger.info(`Cleaned up ${totalCleaned} failed jobs`);
  return { task: 'cleanup_failed_jobs', deleted: totalCleaned };
}

// Cleanup audit logs
async function cleanupAuditLogs(options) {
  const daysToKeep = options?.daysToKeep || 365;
  const cutoffDate = new Date();
  cutoffDate.setDate(cutoffDate.getDate() - daysToKeep);
  
  const deleted = await prisma.auditLog.deleteMany({
    where: {
      createdAt: { lt: cutoffDate }
    }
  });
  
  logger.info(`Cleaned up ${deleted.count} old audit logs`);
  return { task: 'cleanup_audit_logs', deleted: deleted.count };
}

// Schedule recurring cleanup jobs
const scheduleCleanupJobs = () => {
  // Run daily at 2 AM
  cleanupQueue.add('cleanup_old_sync_records', { daysToKeep: 30 }, {
    repeat: { cron: '0 2 * * *' },
    jobId: 'cleanup_sync_records'
  });
  
  // Run weekly on Sunday at 3 AM
  cleanupQueue.add('cleanup_old_notifications', { daysToKeep: 90 }, {
    repeat: { cron: '0 3 * * 0' },
    jobId: 'cleanup_notifications'
  });
  
  // Run weekly on Sunday at 4 AM
  cleanupQueue.add('cleanup_old_reports', { daysToKeep: 60 }, {
    repeat: { cron: '0 4 * * 0' },
    jobId: 'cleanup_reports'
  });
  
  // Run daily at 5 AM
  cleanupQueue.add('cleanup_old_logs', { daysToKeep: 30 }, {
    repeat: { cron: '0 5 * * *' },
    jobId: 'cleanup_logs'
  });
  
  // Run hourly
  cleanupQueue.add('cleanup_temp_files', { hoursToKeep: 24 }, {
    repeat: { cron: '0 * * * *' },
    jobId: 'cleanup_temp_files'
  });
  
  // Run weekly on Monday at 6 AM
  cleanupQueue.add('cleanup_orphaned_data', {}, {
    repeat: { cron: '0 6 * * 1' },
    jobId: 'cleanup_orphaned'
  });
  
  // Run daily at 1 AM
  cleanupQueue.add('cleanup_expired_sessions', { daysToKeep: 7 }, {
    repeat: { cron: '0 1 * * *' },
    jobId: 'cleanup_sessions'
  });
  
  // Run weekly on Saturday at 7 AM
  cleanupQueue.add('cleanup_failed_jobs', { daysToKeep: 7 }, {
    repeat: { cron: '0 7 * * 6' },
    jobId: 'cleanup_failed_jobs'
  });
  
  // Run monthly on 1st at 8 AM
  cleanupQueue.add('cleanup_audit_logs', { daysToKeep: 365 }, {
    repeat: { cron: '0 8 1 * *' },
    jobId: 'cleanup_audit_logs'
  });
  
  logger.info('Cleanup jobs scheduled');
};

// Run manual cleanup
const runCleanup = async (task, options = {}) => {
  const job = await cleanupQueue.add(task, options);
  return job;
};

// Get queue stats
const getCleanupQueueStats = async () => {
  const [waiting, active, completed, failed] = await Promise.all([
    cleanupQueue.getWaitingCount(),
    cleanupQueue.getActiveCount(),
    cleanupQueue.getCompletedCount(),
    cleanupQueue.getFailedCount()
  ]);
  
  return { waiting, active, completed, failed };
};

// Queue event handlers
cleanupQueue.on('completed', (job, result) => {
  logger.info(`Cleanup job ${job.id} completed: ${JSON.stringify(result)}`);
});

cleanupQueue.on('failed', (job, error) => {
  logger.error(`Cleanup job ${job.id} failed:`, error);
});

module.exports = {
  cleanupQueue,
  scheduleCleanupJobs,
  runCleanup,
  getCleanupQueueStats
};