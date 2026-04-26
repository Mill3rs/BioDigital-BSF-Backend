const logger = require('../utils/logger');
const { prisma } = require('../config/database');
const { sendToUser, broadcastToFarm, broadcastToRole } = require('./helpers');

module.exports = (io, socket) => {
  const userId = socket.user.id;
  const userRole = socket.user.role;
  
  // Mark notification as read
  socket.on('notification:read', async (notificationId) => {
    try {
      const notification = await prisma.notification.findFirst({
        where: {
          id: notificationId,
          userId
        }
      });
      
      if (!notification) {
        return socket.emit('error', { message: 'Notification not found' });
      }
      
      await prisma.notification.update({
        where: { id: notificationId },
        data: { read: true }
      });
      
      socket.emit('notification:read-confirmed', {
        notificationId,
        success: true
      });
      
      // Update unread count
      const unreadCount = await prisma.notification.count({
        where: { userId, read: false }
      });
      
      socket.emit('notification:unread-count', { count: unreadCount });
      
    } catch (error) {
      logger.error('Mark notification read error:', error);
      socket.emit('error', { message: 'Failed to mark notification as read' });
    }
  });
  
  // Mark all notifications as read
  socket.on('notification:read-all', async () => {
    try {
      await prisma.notification.updateMany({
        where: { userId, read: false },
        data: { read: true }
      });
      
      socket.emit('notification:all-read', { success: true });
      socket.emit('notification:unread-count', { count: 0 });
      
    } catch (error) {
      logger.error('Mark all notifications read error:', error);
      socket.emit('error', { message: 'Failed to mark notifications as read' });
    }
  });
  
  // Get unread count
  socket.on('notification:get-unread-count', async () => {
    try {
      const unreadCount = await prisma.notification.count({
        where: { userId, read: false }
      });
      
      socket.emit('notification:unread-count', { count: unreadCount });
      
    } catch (error) {
      logger.error('Get unread count error:', error);
      socket.emit('error', { message: 'Failed to get unread count' });
    }
  });
  
  // Get recent notifications
  socket.on('notification:get-recent', async (data) => {
    try {
      const { limit = 20, offset = 0 } = data || {};
      
      const notifications = await prisma.notification.findMany({
        where: { userId },
        orderBy: { createdAt: 'desc' },
        take: limit,
        skip: offset
      });
      
      socket.emit('notification:recent', {
        notifications,
        hasMore: notifications.length === limit,
        timestamp: new Date()
      });
      
    } catch (error) {
      logger.error('Get recent notifications error:', error);
      socket.emit('error', { message: 'Failed to get recent notifications' });
    }
  });
  
  // Subscribe to notification types
  socket.on('notification:subscribe', (types) => {
    const subscribedTypes = Array.isArray(types) ? types : [types];
    
    for (const type of subscribedTypes) {
      socket.join(`notifications:${type}`);
    }
    
    socket.emit('notification:subscribed', { types: subscribedTypes });
    logger.debug(`User ${userId} subscribed to notifications: ${subscribedTypes.join(', ')}`);
  });
  
  // Unsubscribe from notification types
  socket.on('notification:unsubscribe', (types) => {
    const unsubscribedTypes = Array.isArray(types) ? types : [types];
    
    for (const type of unsubscribedTypes) {
      socket.leave(`notifications:${type}`);
    }
    
    socket.emit('notification:unsubscribed', { types: unsubscribedTypes });
  });
  
  // Send notification to specific user (admin only)
  socket.on('notification:send', async (data) => {
    try {
      const { recipientId, title, message, type, metadata } = data;
      
      const isAuthorized = userRole === 'ADMIN' || userRole === 'SUPER_ADMIN';
      
      if (!isAuthorized) {
        return socket.emit('error', { message: 'Not authorized to send notifications' });
      }
      
      const notification = await prisma.notification.create({
        data: {
          userId: recipientId,
          title,
          message,
          type: type || 'INFO',
          metadata: metadata || {},
          read: false
        }
      });
      
      // Send real-time notification
      sendToUser(recipientId, 'notification:new', notification);
      
      socket.emit('notification:sent', {
        notificationId: notification.id,
        recipientId,
        success: true
      });
      
      logger.info(`Notification sent from ${userId} to ${recipientId}: ${title}`);
      
    } catch (error) {
      logger.error('Send notification error:', error);
      socket.emit('error', { message: 'Failed to send notification' });
    }
  });
  
  // Broadcast notification to farm (manager only)
  socket.on('notification:broadcast-farm', async (data) => {
    try {
      const { farmId, title, message, type, metadata } = data;
      
      const isAuthorized = 
        userRole === 'ADMIN' ||
        (userRole === 'MANAGER' && socket.user.farmId === farmId);
      
      if (!isAuthorized) {
        return socket.emit('error', { message: 'Not authorized to broadcast to farm' });
      }
      
      // Get all users in farm
      const farmUsers = await prisma.user.findMany({
        where: { farmId },
        select: { id: true }
      });
      
      // Create notifications for all farm users
      const notifications = await prisma.notification.createMany({
        data: farmUsers.map(user => ({
          userId: user.id,
          title,
          message,
          type: type || 'INFO',
          metadata: metadata || {},
          read: false
        }))
      });
      
      // Broadcast real-time
      broadcastToFarm(farmId, 'notification:new', {
        title,
        message,
        type,
        metadata,
        timestamp: new Date()
      });
      
      socket.emit('notification:broadcasted', {
        farmId,
        recipientCount: farmUsers.length,
        success: true
      });
      
      logger.info(`Farm broadcast from ${userId} to farm ${farmId}: ${title}`);
      
    } catch (error) {
      logger.error('Broadcast to farm error:', error);
      socket.emit('error', { message: 'Failed to broadcast notification' });
    }
  });
  
  // Delete notification
  socket.on('notification:delete', async (notificationId) => {
    try {
      const notification = await prisma.notification.findFirst({
        where: {
          id: notificationId,
          userId
        }
      });
      
      if (!notification) {
        return socket.emit('error', { message: 'Notification not found' });
      }
      
      await prisma.notification.delete({
        where: { id: notificationId }
      });
      
      socket.emit('notification:deleted', {
        notificationId,
        success: true
      });
      
    } catch (error) {
      logger.error('Delete notification error:', error);
      socket.emit('error', { message: 'Failed to delete notification' });
    }
  });
  
  // System alert (admin only)
  socket.on('notification:system-alert', async (data) => {
    try {
      const { message, severity, targetRole } = data;
      
      const isAuthorized = userRole === 'ADMIN' || userRole === 'SUPER_ADMIN';
      
      if (!isAuthorized) {
        return socket.emit('error', { message: 'Not authorized to send system alerts' });
      }
      
      const alertData = {
        title: 'System Alert',
        message,
        type: 'ALERT',
        metadata: { severity, timestamp: new Date() }
      };
      
      if (targetRole) {
        broadcastToRole(targetRole, 'notification:system-alert', alertData);
      } else {
        io.emit('notification:system-alert', alertData);
      }
      
      socket.emit('notification:alert-sent', {
        success: true,
        targetRole: targetRole || 'all'
      });
      
      logger.info(`System alert from ${userId}: ${message}`);
      
    } catch (error) {
      logger.error('System alert error:', error);
      socket.emit('error', { message: 'Failed to send system alert' });
    }
  });
};