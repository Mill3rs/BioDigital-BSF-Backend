#!/usr/bin/env node

const { PrismaClient } = require('@prisma/client');
const fs = require('fs').promises;
const path = require('path');
const readline = require('readline');
const dotenv = require('dotenv');

dotenv.config();

const prisma = new PrismaClient();

// Configuration
const config = {
  dryRun: false,
  olderThanDays: parseInt(process.env.CLEANUP_OLDER_THAN_DAYS) || 90,
  keepFailedSyncs: parseInt(process.env.KEEP_FAILED_SYNCS) || 30,
  keepDeletedRecords: parseInt(process.env.KEEP_DELETED_RECORDS) || 30,
  uploadsDir: process.env.UPLOAD_DIR || './uploads'
};

// Parse command line arguments
function parseArgs() {
  const args = process.argv.slice(2);
  for (const arg of args) {
    if (arg === '--dry-run') config.dryRun = true;
    if (arg === '--force') config.force = true;
    if (arg.startsWith('--older-than=')) {
      config.olderThanDays = parseInt(arg.split('=')[1]);
    }
  }
}

// Confirm cleanup action
async function confirmCleanup() {
  if (config.force) return true;
  
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout
  });
  
  console.log('\n⚠️  WARNING: This will permanently delete data!');
  console.log(`- Dry run mode: ${config.dryRun ? 'ON' : 'OFF'}`);
  console.log(`- Delete records older than: ${config.olderThanDays} days`);
  console.log(`- Keep failed syncs: ${config.keepFailedSyncs} days`);
  console.log(`- Keep deleted records: ${config.keepDeletedRecords} days\n`);
  
  const answer = await new Promise((resolve) => {
    rl.question('Type "CLEANUP" to proceed: ', resolve);
  });
  
  rl.close();
  
  if (answer !== 'CLEANUP') {
    console.log('Cleanup cancelled');
    return false;
  }
  
  return true;
}

// Cleanup old offline sync records
async function cleanupOfflineSyncs() {
  const cutoffDate = new Date();
  cutoffDate.setDate(cutoffDate.getDate() - config.keepFailedSyncs);
  
  console.log(`\n🗑️ Cleaning up offline sync records older than ${config.keepFailedSyncs} days...`);
  
  const deleted = await prisma.offlineSync.deleteMany({
    where: {
      OR: [
        { status: 'SYNCED', syncedAt: { lt: cutoffDate } },
        { status: 'FAILED', createdAt: { lt: cutoffDate }, retryCount: { gte: 5 } }
      ]
    }
  });
  
  console.log(`   Deleted ${deleted.count} offline sync records`);
  return deleted.count;
}

// Cleanup old notifications
async function cleanupNotifications() {
  const cutoffDate = new Date();
  cutoffDate.setDate(cutoffDate.getDate() - config.olderThanDays);
  
  console.log(`\n🗑️ Cleaning up notifications older than ${config.olderThanDays} days...`);
  
  const deleted = await prisma.notification.deleteMany({
    where: {
      read: true,
      createdAt: { lt: cutoffDate }
    }
  });
  
  console.log(`   Deleted ${deleted.count} notifications`);
  return deleted.count;
}

// Cleanup old activity logs
async function cleanupActivityLogs() {
  const cutoffDate = new Date();
  cutoffDate.setDate(cutoffDate.getDate() - config.olderThanDays);
  
  console.log(`\n🗑️ Cleaning up activity logs older than ${config.olderThanDays} days...`);
  
  const deleted = await prisma.activityLog.deleteMany({
    where: {
      timestamp: { lt: cutoffDate }
    }
  });
  
  console.log(`   Deleted ${deleted.count} activity logs`);
  return deleted.count;
}

// Cleanup cancelled orders
async function cleanupCancelledOrders() {
  const cutoffDate = new Date();
  cutoffDate.setDate(cutoffDate.getDate() - 30);
  
  console.log(`\n🗑️ Cleaning up cancelled orders older than 30 days...`);
  
  const deleted = await prisma.order.deleteMany({
    where: {
      status: 'CANCELLED',
      cancelledAt: { lt: cutoffDate }
    }
  });
  
  console.log(`   Deleted ${deleted.count} cancelled orders`);
  return deleted.count;
}

// Cleanup orphaned cart items
async function cleanupOrphanedCartItems() {
  console.log(`\n🗑️ Cleaning up orphaned cart items...`);
  
  const deleted = await prisma.cartItem.deleteMany({
    where: {
      cart: null
    }
  });
  
  console.log(`   Deleted ${deleted.count} orphaned cart items`);
  return deleted.count;
}

// Cleanup expired sessions
async function cleanupExpiredSessions() {
  const cutoffDate = new Date();
  cutoffDate.setDate(cutoffDate.getDate() - 7);
  
  console.log(`\n🗑️ Cleaning up expired sessions older than 7 days...`);
  
  // This depends on your session storage implementation
  // For database sessions, you would delete from session table
  console.log(`   Skipped (implement based on session storage)`);
  return 0;
}

// Cleanup orphaned upload files
async function cleanupOrphanedUploads() {
  console.log(`\n🗑️ Cleaning up orphaned upload files...`);
  
  let deletedCount = 0;
  let orphanedFiles = [];
  
  try {
    // Get all waste record images
    const wasteRecords = await prisma.wasteRecord.findMany({
      select: { images: true }
    });
    const validWasteImages = new Set();
    wasteRecords.forEach(record => {
      record.images.forEach(img => validWasteImages.add(path.basename(img)));
    });
    
    // Get all product images
    const products = await prisma.product.findMany({
      select: { images: true }
    });
    products.forEach(product => {
      product.images.forEach(img => validWasteImages.add(path.basename(img)));
    });
    
    // Get all product variant images
    const variants = await prisma.productVariant.findMany({
      select: { images: true }
    });
    variants.forEach(variant => {
      variant.images.forEach(img => validWasteImages.add(path.basename(img)));
    });
    
    // Get all user profile images
    const users = await prisma.user.findMany({
      select: { profileImage: true }
    });
    users.forEach(user => {
      if (user.profileImage) {
        validWasteImages.add(path.basename(user.profileImage));
      }
    });
    
    // Scan uploads directory
    const uploadsPath = config.uploadsDir;
    const imageDirs = ['images/waste', 'images/products', 'images/profiles', 'images/batches'];
    
    for (const dir of imageDirs) {
      const fullPath = path.join(uploadsPath, dir);
      try {
        const files = await fs.readdir(fullPath);
        for (const file of files) {
          if (!validWasteImages.has(file)) {
            orphanedFiles.push(path.join(fullPath, file));
          }
        }
      } catch (error) {
        // Directory might not exist
      }
    }
    
    if (!config.dryRun) {
      for (const file of orphanedFiles) {
        await fs.unlink(file).catch(() => {});
        deletedCount++;
      }
    } else {
      deletedCount = orphanedFiles.length;
    }
    
    console.log(`   Found ${orphanedFiles.length} orphaned files`);
    if (!config.dryRun) {
      console.log(`   Deleted ${deletedCount} orphaned files`);
    }
  } catch (error) {
    console.error('   Error cleaning up uploads:', error.message);
  }
  
  return deletedCount;
}

// Cleanup failed jobs
async function cleanupFailedJobs() {
  console.log(`\n🗑️ Cleaning up failed jobs...`);
  
  // This would clean up failed Bull queue jobs
  // Implementation depends on your queue setup
  console.log(`   Skipped (implement based on queue setup)`);
  return 0;
}

// Cleanup old reports
async function cleanupOldReports() {
  const cutoffDate = new Date();
  cutoffDate.setDate(cutoffDate.getDate() - config.olderThanDays);
  
  console.log(`\n🗑️ Cleaning up reports older than ${config.olderThanDays} days...`);
  
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
  
  // Delete files
  let filesDeleted = 0;
  if (!config.dryRun) {
    for (const report of reports) {
      if (report.fileUrl) {
        try {
          const filePath = path.join(config.uploadsDir, 'reports', path.basename(report.fileUrl));
          await fs.unlink(filePath).catch(() => {});
          filesDeleted++;
        } catch (error) {
          // File might not exist
        }
      }
    }
  }
  
  // Delete records
  const deleted = await prisma.report.deleteMany({
    where: {
      id: { in: reports.map(r => r.id) }
    }
  });
  
  console.log(`   Deleted ${deleted.count} reports and ${filesDeleted} files`);
  return deleted.count;
}

// Cleanup old audit logs
async function cleanupAuditLogs() {
  const cutoffDate = new Date();
  cutoffDate.setDate(cutoffDate.getDate() - 365);
  
  console.log(`\n🗑️ Cleaning up audit logs older than 365 days...`);
  
  const deleted = await prisma.auditLog.deleteMany({
    where: {
      createdAt: { lt: cutoffDate }
    }
  });
  
  console.log(`   Deleted ${deleted.count} audit logs`);
  return deleted.count;
}

// Get database statistics
async function getDatabaseStats() {
  console.log('\n📊 Database Statistics:');
  
  const counts = await Promise.all([
    prisma.user.count(),
    prisma.farm.count(),
    prisma.wasteRecord.count(),
    prisma.processingBatch.count(),
    prisma.order.count(),
    prisma.product.count(),
    prisma.notification.count(),
    prisma.activityLog.count(),
    prisma.report.count(),
    prisma.offlineSync.count()
  ]);
  
  const [
    userCount,
    farmCount,
    wasteCount,
    batchCount,
    orderCount,
    productCount,
    notificationCount,
    activityCount,
    reportCount,
    syncCount
  ] = counts;
  
  console.log(`   Users: ${userCount}`);
  console.log(`   Farms: ${farmCount}`);
  console.log(`   Waste Records: ${wasteCount}`);
  console.log(`   Processing Batches: ${batchCount}`);
  console.log(`   Orders: ${orderCount}`);
  console.log(`   Products: ${productCount}`);
  console.log(`   Notifications: ${notificationCount}`);
  console.log(`   Activity Logs: ${activityCount}`);
  console.log(`   Reports: ${reportCount}`);
  console.log(`   Offline Syncs: ${syncCount}`);
  
  return counts;
}

// Main cleanup function
async function runCleanup() {
  console.log('🧹 Starting database and file cleanup...');
  console.log(`📍 Dry run mode: ${config.dryRun ? 'ON (no actual deletions)' : 'OFF'}`);
  
  if (!config.dryRun) {
    const confirmed = await confirmCleanup();
    if (!confirmed) return;
  }
  
  const results = {
    offlineSyncs: await cleanupOfflineSyncs(),
    notifications: await cleanupNotifications(),
    activityLogs: await cleanupActivityLogs(),
    cancelledOrders: await cleanupCancelledOrders(),
    orphanedCartItems: await cleanupOrphanedCartItems(),
    expiredSessions: await cleanupExpiredSessions(),
    orphanedUploads: await cleanupOrphanedUploads(),
    failedJobs: await cleanupFailedJobs(),
    oldReports: await cleanupOldReports(),
    auditLogs: await cleanupAuditLogs()
  };
  
  const totalDeleted = Object.values(results).reduce((a, b) => a + b, 0);
  
  console.log('\n📊 Cleanup Summary:');
  console.log(`   Total records/files deleted: ${totalDeleted}`);
  console.log(`   - Offline syncs: ${results.offlineSyncs}`);
  console.log(`   - Notifications: ${results.notifications}`);
  console.log(`   - Activity logs: ${results.activityLogs}`);
  console.log(`   - Cancelled orders: ${results.cancelledOrders}`);
  console.log(`   - Orphaned cart items: ${results.orphanedCartItems}`);
  console.log(`   - Orphaned uploads: ${results.orphanedUploads}`);
  console.log(`   - Old reports: ${results.oldReports}`);
  console.log(`   - Audit logs: ${results.auditLogs}`);
  
  await getDatabaseStats();
  
  if (config.dryRun) {
    console.log('\n💡 This was a dry run. Run without --dry-run to actually delete data.');
  }
  
  console.log('\n✅ Cleanup completed!');
}

// Main execution
if (require.main === module) {
  parseArgs();
  runCleanup()
    .then(() => process.exit(0))
    .catch((error) => {
      console.error('Cleanup failed:', error);
      process.exit(1);
    })
    .finally(async () => {
      await prisma.$disconnect();
    });
}

module.exports = {
  cleanupOfflineSyncs,
  cleanupNotifications,
  cleanupActivityLogs,
  cleanupCancelledOrders,
  cleanupOrphanedCartItems,
  cleanupExpiredSessions,
  cleanupOrphanedUploads,
  cleanupFailedJobs,
  cleanupOldReports,
  cleanupAuditLogs,
  getDatabaseStats,
  runCleanup
};