const express = require('express');
const { prisma } = require('../config/database');
const { authenticate } = require('../middleware/auth');
const { AppError } = require('../middleware/errorHandler');

const router = express.Router();

// Get my notifications
router.get('/', authenticate, async (req, res, next) => {
  try {
    const { read, page = 1, limit = 20 } = req.query;
    const where = { userId: req.user.id };
    
    if (read !== undefined) {
      where.read = read === 'true';
    }
    
    const skip = (page - 1) * limit;
    
    const [notifications, total] = await Promise.all([
      prisma.notification.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip,
        take: parseInt(limit)
      }),
      prisma.notification.count({ where })
    ]);
    
    res.json({
      success: true,
      data: notifications,
      pagination: {
        page: parseInt(page),
        limit: parseInt(limit),
        total,
        pages: Math.ceil(total / limit)
      }
    });
  } catch (error) {
    next(error);
  }
});

// Mark notification as read
router.patch('/:id/read', authenticate, async (req, res, next) => {
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
    
    res.json({
      success: true,
      data: updated
    });
  } catch (error) {
    next(error);
  }
});

// Mark all as read
router.post('/mark-all-read', authenticate, async (req, res, next) => {
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
});

// Delete notification
router.delete('/:id', authenticate, async (req, res, next) => {
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
});

// Get unread count
router.get('/unread/count', authenticate, async (req, res, next) => {
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
});

// Clear all notifications
router.delete('/', authenticate, async (req, res, next) => {
  try {
    await prisma.notification.deleteMany({
      where: { userId: req.user.id }
    });
    
    res.json({
      success: true,
      message: 'All notifications cleared'
    });
  } catch (error) {
    next(error);
  }
});

module.exports = router;