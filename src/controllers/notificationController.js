const { prisma } = require('../config/database');
const { AppError } = require('../middleware/errorHandler');
const { calculatePagination } = require('../utils/helpers');

class NotificationController {
  // Get my notifications
  async getNotifications(req, res, next) {
    try {
      const { read, page = 1, limit = 20 } = req.query;
      const where = { userId: req.user.id };
      
      if (read !== undefined) {
        where.read = read === 'true';
      }
      
      const { skip, pagination } = calculatePagination(page, limit, 0);
      
      const [notifications, total] = await Promise.all([
        prisma.notification.findMany({
          where,
          orderBy: { createdAt: 'desc' },
          skip,
          take: pagination.limit
        }),
        prisma.notification.count({ where })
      ]);
      
      pagination.total = total;
      pagination.pages = Math.ceil(total / pagination.limit);
      
      res.json({ success: true, data: notifications, pagination });
    } catch (error) {
      next(error);
    }
  }

  // Mark notification as read
  async markAsRead(req, res, next) {
    try {
      const { id } = req.params;
      
      const notification = await prisma.notification.findFirst({
        where: { id, userId: req.user.id }
      });
      
      if (!notification) {
        throw new AppError('Notification not found', 404);
      }
      
      const updated = await prisma.notification.update({
        where: { id },
        data: { read: true }
      });
      
      res.json({ success: true, data: updated });
    } catch (error) {
      next(error);
    }
  }

  // Mark all as read
  async markAllAsRead(req, res, next) {
    try {
      await prisma.notification.updateMany({
        where: { userId: req.user.id, read: false },
        data: { read: true }
      });
      
      res.json({
        success: true,
        message: 'All notifications marked as read'
      });
    } catch (error) {
      next(error);
    }
  }

  // Delete notification
  async deleteNotification(req, res, next) {
    try {
      const { id } = req.params;
      
      const notification = await prisma.notification.findFirst({
        where: { id, userId: req.user.id }
      });
      
      if (!notification) {
        throw new AppError('Notification not found', 404);
      }
      
      await prisma.notification.delete({ where: { id } });
      
      res.json({
        success: true,
        message: 'Notification deleted'
      });
    } catch (error) {
      next(error);
    }
  }

  // Get unread count
  async getUnreadCount(req, res, next) {
    try {
      const count = await prisma.notification.count({
        where: { userId: req.user.id, read: false }
      });
      
      res.json({
        success: true,
        data: { unreadCount: count }
      });
    } catch (error) {
      next(error);
    }
  }
}

module.exports = new NotificationController();