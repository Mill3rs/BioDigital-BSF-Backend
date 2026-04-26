const { prisma } = require('../config/database');
const logger = require('../utils/logger');

class NotificationService {
  /**
   * Notify all ADMIN and MANAGER users about a system event.
   * Optionally scoped to a specific farm via farmId.
   */
  async notifyAdminsAndManagers(farmId, title, message, type, metadata = {}, socketEvent = null, socketPayload = {}) {
    try {
      const admins = await prisma.user.findMany({
        where: {
          role: { in: ['ADMIN', 'MANAGER'] },
          ...(farmId ? { farmId } : {}),
        },
        select: { id: true },
      });
      const ids = admins.map((u) => u.id);
      if (ids.length) {
        await this.sendBulkNotifications(ids, title, message, type, metadata);
      }
      if (socketEvent) {
        try {
          const { broadcastToRole } = require('../sockets');
          broadcastToRole('ADMIN', socketEvent, socketPayload);
          broadcastToRole('MANAGER', socketEvent, socketPayload);
        } catch (_) { /* socket may not be initialised yet */ }
      }
    } catch (error) {
      logger.error('notifyAdminsAndManagers error:', error);
    }
  }


  async createNotification(userId, title, message, type, metadata = {}) {
    try {
      const notification = await prisma.notification.create({
        data: {
          userId,
          title,
          message,
          type,
          metadata,
          read: false
        }
      });
      
      logger.info(`Notification created for user ${userId}: ${title}`);
      return notification;
    } catch (error) {
      logger.error('Failed to create notification:', error);
      return null;
    }
  }

  async sendBulkNotifications(userIds, title, message, type, metadata = {}) {
    const notifications = userIds.map(userId => ({
      userId,
      title,
      message,
      type,
      metadata,
      read: false
    }));
    
    try {
      const result = await prisma.notification.createMany({
        data: notifications
      });
      
      logger.info(`Bulk notifications sent to ${userIds.length} users`);
      return result;
    } catch (error) {
      logger.error('Failed to send bulk notifications:', error);
      return null;
    }
  }

  async sendOrderNotification(order) {
    const customerNotification = await this.createNotification(
      order.customerId,
      'Order Confirmed',
      `Your order #${order.orderNumber} has been confirmed. Total: $${order.total.toFixed(2)}`,
      'ORDER_UPDATE',
      { orderId: order.id, orderNumber: order.orderNumber }
    );
    
    if (order.farmId) {
      await this.createNotification(
        order.farm.managerId,
        'New Order Received',
        `New order #${order.orderNumber} received. Amount: $${order.total.toFixed(2)}`,
        'ORDER_UPDATE',
        { orderId: order.id, orderNumber: order.orderNumber }
      );
    }
    
    return customerNotification;
  }

  async sendWasteNotification(wasteRecord) {
    if (wasteRecord.farmId) {
      await this.createNotification(
        wasteRecord.farm.managerId,
        'Waste Recorded',
        `${wasteRecord.quantity}${wasteRecord.unit} of waste recorded from ${wasteRecord.sourceName}`,
        'WASTE_COLLECTION',
        { wasteRecordId: wasteRecord.id }
      );
    }
    
    if (wasteRecord.driverId) {
      await this.createNotification(
        wasteRecord.driverId,
        'Waste Collection Assigned',
        `You have been assigned to collect ${wasteRecord.quantity}${wasteRecord.unit} from ${wasteRecord.sourceName}`,
        'WASTE_COLLECTION',
        { wasteRecordId: wasteRecord.id }
      );
    }
  }

  async sendBatchNotification(batch, status) {
    const farm = await prisma.farm.findUnique({
      where: { id: batch.farmId },
      include: { manager: true }
    });
    
    if (farm?.manager) {
      let title, message;
      
      if (status === 'COMPLETED') {
        title = 'Batch Processing Completed';
        message = `Batch ${batch.batchNumber} has been completed. Output: ${batch.fertilizerOutput || 0}kg fertilizer`;
      } else if (status === 'ACTIVE') {
        title = 'Batch Processing Started';
        message = `Batch ${batch.batchNumber} has started processing.`;
      } else if (status === 'FAILED') {
        title = 'Batch Processing Failed';
        message = `Batch ${batch.batchNumber} has failed. Please check the system.`;
      }
      
      if (title) {
        await this.createNotification(
          farm.manager.id,
          title,
          message,
          'BATCH_UPDATE',
          { batchId: batch.id, batchNumber: batch.batchNumber }
        );
      }
    }
  }

  async sendDeliveryNotification(order, status) {
    let title, message;
    
    switch (status) {
      case 'SHIPPED':
        title = 'Order Shipped';
        message = `Your order #${order.orderNumber} has been shipped and is on its way.`;
        break;
      case 'OUT_FOR_DELIVERY':
        title = 'Out for Delivery';
        message = `Your order #${order.orderNumber} is out for delivery.`;
        break;
      case 'DELIVERED':
        title = 'Order Delivered';
        message = `Your order #${order.orderNumber} has been delivered. Thank you for shopping with us!`;
        break;
      default:
        return;
    }
    
    await this.createNotification(
      order.customerId,
      title,
      message,
      'DELIVERY_UPDATE',
      { orderId: order.id, orderNumber: order.orderNumber }
    );
  }

  async sendPaymentNotification(order, status) {
    let title, message;
    
    if (status === 'PAID') {
      title = 'Payment Received';
      message = `Payment of $${order.total.toFixed(2)} for order #${order.orderNumber} has been received.`;
    } else if (status === 'FAILED') {
      title = 'Payment Failed';
      message = `Payment for order #${order.orderNumber} failed. Please update your payment method.`;
    }
    
    if (title) {
      await this.createNotification(
        order.customerId,
        title,
        message,
        'PAYMENT_CONFIRMED',
        { orderId: order.id, orderNumber: order.orderNumber }
      );
    }
  }

  async sendAlertNotification(userId, title, message, severity = 'WARNING') {
    return this.createNotification(
      userId,
      title,
      message,
      'ALERT',
      { severity }
    );
  }

  async getUnreadCount(userId) {
    const count = await prisma.notification.count({
      where: { userId, read: false }
    });
    return count;
  }

  async markAsRead(notificationId, userId) {
    return prisma.notification.update({
      where: { id: notificationId, userId },
      data: { read: true }
    });
  }

  async markAllAsRead(userId) {
    return prisma.notification.updateMany({
      where: { userId, read: false },
      data: { read: true }
    });
  }
}

module.exports = new NotificationService();