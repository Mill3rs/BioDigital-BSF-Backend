const Queue = require('bull');
const { prisma } = require('../config/database');
const logger = require('../utils/logger');
const { getRedisClient } = require('../config/redis');

// Create queue
const notificationQueue = new Queue('notification-processing', {
  redis: {
    host: process.env.REDIS_HOST || 'localhost',
    port: parseInt(process.env.REDIS_PORT, 10) || 6379,
    password: process.env.REDIS_PASSWORD
  },
  defaultJobOptions: {
    attempts: 3,
    backoff: {
      type: 'exponential',
      delay: 2000
    },
    removeOnComplete: 100,
    removeOnFail: 500
  }
});

// Process notification jobs
notificationQueue.process(async (job) => {
  const { type, recipients, data, priority = 'normal' } = job.data;
  
  logger.info(`Processing ${type} notification for ${recipients.length} recipients`);
  
  const results = [];
  
  for (const recipient of recipients) {
    try {
      let result;
      
      switch (type) {
        case 'PUSH':
          result = await sendPushNotification(recipient, data);
          break;
        case 'IN_APP':
          result = await sendInAppNotification(recipient, data);
          break;
        case 'EMAIL':
          result = await queueEmailNotification(recipient, data);
          break;
        case 'SMS':
          result = await queueSMSNotification(recipient, data);
          break;
        default:
          throw new Error(`Unknown notification type: ${type}`);
      }
      
      results.push({
        recipient,
        success: true,
        result
      });
      
    } catch (error) {
      logger.error(`Failed to send ${type} notification to ${recipient}:`, error);
      results.push({
        recipient,
        success: false,
        error: error.message
      });
    }
  }
  
  // Log notification batch
  await prisma.notificationLog.create({
    data: {
      type,
      recipientsCount: recipients.length,
      successfulCount: results.filter(r => r.success).length,
      failedCount: results.filter(r => !r.success).length,
      data,
      sentAt: new Date()
    }
  });
  
  return { results };
});

// Send push notification via FCM
async function sendPushNotification(userId, data) {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { fcmToken: true }
  });
  
  if (!user?.fcmToken) {
    throw new Error('User has no FCM token');
  }
  
  // This would integrate with Firebase Cloud Messaging
  // For now, we'll simulate the call
  logger.info(`Sending push notification to user ${userId}: ${data.title}`);
  
  // Mock FCM call
  return { success: true, messageId: `fcm-${Date.now()}` };
}

// Send in-app notification
async function sendInAppNotification(userId, data) {
  const notification = await prisma.notification.create({
    data: {
      userId,
      title: data.title,
      message: data.message,
      type: data.notificationType || 'INFO',
      metadata: data.metadata || {},
      read: false
    }
  });
  
  // Emit via WebSocket if available
  const io = global.io;
  if (io) {
    io.to(`user-${userId}`).emit('notification', notification);
  }
  
  return notification;
}

// Queue email notification (uses emailJob)
async function queueEmailNotification(email, data) {
  const { sendEmail } = require('./emailJob');
  const job = await sendEmail(data.template, email, data.templateData, data.priority);
  return { jobId: job.id };
}

// Queue SMS notification (uses twilio)
async function queueSMSNotification(phoneNumber, data) {
  // This would integrate with Twilio SMS service
  logger.info(`Queueing SMS to ${phoneNumber}: ${data.message}`);
  
  // Mock SMS queue
  return { success: true, messageId: `sms-${Date.now()}` };
}

// Queue event handlers
notificationQueue.on('completed', (job, result) => {
  logger.info(`Notification job ${job.id} completed: ${result.results.length} notifications sent`);
});

notificationQueue.on('failed', (job, error) => {
  logger.error(`Notification job ${job.id} failed:`, error);
});

// Add notification to queue
const sendNotification = async (type, recipients, data, priority = 'normal') => {
  const job = await notificationQueue.add({
    type,
    recipients: Array.isArray(recipients) ? recipients : [recipients],
    data,
    priority
  }, {
    priority: priority === 'high' ? 1 : 3
  });
  
  return job;
};

// Send order notification
const sendOrderNotification = async (orderId, event) => {
  const order = await prisma.order.findUnique({
    where: { id: orderId },
    include: { customer: true }
  });
  
  if (!order) return;
  
  const notifications = [];
  
  switch (event) {
    case 'CREATED':
      notifications.push({
        type: 'IN_APP',
        recipient: order.customerId,
        data: {
          title: 'Order Created',
          message: `Your order #${order.orderNumber} has been created.`,
          notificationType: 'ORDER_UPDATE',
          metadata: { orderId }
        }
      });
      break;
      
    case 'CONFIRMED':
      notifications.push({
        type: 'IN_APP',
        recipient: order.customerId,
        data: {
          title: 'Order Confirmed',
          message: `Your order #${order.orderNumber} has been confirmed.`,
          notificationType: 'ORDER_UPDATE',
          metadata: { orderId }
        }
      });
      break;
      
    case 'SHIPPED':
      notifications.push({
        type: 'IN_APP',
        recipient: order.customerId,
        data: {
          title: 'Order Shipped',
          message: `Your order #${order.orderNumber} is on the way!`,
          notificationType: 'ORDER_UPDATE',
          metadata: { orderId }
        }
      });
      if (order.customer.email) {
        notifications.push({
          type: 'EMAIL',
          recipient: order.customer.email,
          data: {
            template: 'orderShipped',
            templateData: { order },
            priority: 'high'
          }
        });
      }
      break;
      
    case 'DELIVERED':
      notifications.push({
        type: 'IN_APP',
        recipient: order.customerId,
        data: {
          title: 'Order Delivered',
          message: `Your order #${order.orderNumber} has been delivered.`,
          notificationType: 'ORDER_UPDATE',
          metadata: { orderId }
        }
      });
      break;
  }
  
  for (const notification of notifications) {
    await sendNotification(notification.type, notification.recipient, notification.data);
  }
};

// Send waste notification
const sendWasteNotification = async (wasteId, event) => {
  const waste = await prisma.wasteRecord.findUnique({
    where: { id: wasteId },
    include: { farm: { include: { manager: true } } }
  });
  
  if (!waste?.farm?.manager) return;
  
  let title, message;
  
  switch (event) {
    case 'CREATED':
      title = 'New Waste Recorded';
      message = `${waste.quantity}${waste.unit} of waste recorded from ${waste.sourceName}`;
      break;
    case 'SCHEDULED':
      title = 'Waste Collection Scheduled';
      message = `Collection scheduled for ${waste.quantity}${waste.unit} from ${waste.sourceName}`;
      break;
    case 'COLLECTED':
      title = 'Waste Collected';
      message = `${waste.quantity}${waste.unit} has been collected from ${waste.sourceName}`;
      break;
    case 'PROCESSED':
      title = 'Waste Processed';
      message = `${waste.quantity}${waste.unit} has been processed`;
      break;
    default:
      return;
  }
  
  await sendNotification('IN_APP', waste.farm.manager.id, {
    title,
    message,
    notificationType: 'WASTE_COLLECTION',
    metadata: { wasteId }
  });
};

// Send batch notification
const sendBatchNotification = async (batchId, event) => {
  const batch = await prisma.processingBatch.findUnique({
    where: { id: batchId },
    include: { farm: { include: { manager: true } } }
  });
  
  if (!batch?.farm?.manager) return;
  
  let title, message;
  
  switch (event) {
    case 'STARTED':
      title = 'Batch Started';
      message = `Processing batch ${batch.batchNumber} has started`;
      break;
    case 'COMPLETED':
      title = 'Batch Completed';
      message = `Batch ${batch.batchNumber} completed. Output: ${batch.fertilizerOutput || 0}kg fertilizer`;
      break;
    case 'FAILED':
      title = 'Batch Failed';
      message = `Batch ${batch.batchNumber} has failed. Please check the system.`;
      break;
    default:
      return;
  }
  
  await sendNotification('IN_APP', batch.farm.manager.id, {
    title,
    message,
    notificationType: 'BATCH_UPDATE',
    metadata: { batchId }
  });
};

// Get queue stats
const getNotificationQueueStats = async () => {
  const [waiting, active, completed, failed] = await Promise.all([
    notificationQueue.getWaitingCount(),
    notificationQueue.getActiveCount(),
    notificationQueue.getCompletedCount(),
    notificationQueue.getFailedCount()
  ]);
  
  return { waiting, active, completed, failed };
};

module.exports = {
  notificationQueue,
  sendNotification,
  sendOrderNotification,
  sendWasteNotification,
  sendBatchNotification,
  getNotificationQueueStats
};