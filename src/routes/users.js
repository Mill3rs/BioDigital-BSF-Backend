const express = require('express');
const { body, validationResult } = require('express-validator');
const { prisma } = require('../config/database');
const { authenticate, authorize } = require('../middleware/auth');
const { AppError } = require('../middleware/errorHandler');
const bcrypt = require('bcryptjs');

const router = express.Router();

// Get current user profile
router.get('/profile', authenticate, async (req, res, next) => {
  try {
    const user = await prisma.user.findUnique({
      where: { id: req.user.id },
      include: {
        farm: true,
        driverProfile: true,
        buyerProfile: true,
        supplierProfile: true,
        adminManaged: true
      }
    });
    
    const { password, ...userData } = user;
    res.json({ success: true, data: userData });
  } catch (error) {
    next(error);
  }
});

// Update user profile
router.put('/profile', authenticate, async (req, res, next) => {
  try {
    const { fullName, phoneNumber, profileImage } = req.body;
    
    const user = await prisma.user.update({
      where: { id: req.user.id },
      data: { fullName, phoneNumber, profileImage },
      select: {
        id: true,
        email: true,
        fullName: true,
        phoneNumber: true,
        profileImage: true,
        role: true
      }
    });
    
    res.json({ success: true, data: user });
  } catch (error) {
    next(error);
  }
});

// Change password
router.put('/change-password', authenticate, [
  body('currentPassword').notEmpty().withMessage('Current password is required'),
  body('newPassword').isLength({ min: 6 }).withMessage('New password must be at least 6 characters')
], async (req, res, next) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({ success: false, errors: errors.array() });
  }

  try {
    const { currentPassword, newPassword } = req.body;
    
    const user = await prisma.user.findUnique({
      where: { id: req.user.id }
    });
    
    const isValid = await bcrypt.compare(currentPassword, user.password);
    if (!isValid) {
      throw new AppError('Current password is incorrect', 401);
    }
    
    const hashedPassword = await bcrypt.hash(newPassword, 10);
    await prisma.user.update({
      where: { id: req.user.id },
      data: { password: hashedPassword }
    });
    
    res.json({ success: true, message: 'Password changed successfully' });
  } catch (error) {
    next(error);
  }
});

// Get all users (Admin only)
router.get('/', authenticate, authorize('SUPER_ADMIN', 'ADMIN'), async (req, res, next) => {
  try {
    const { role, status, search, page = 1, limit = 20 } = req.query;
    const where = {};
    
    if (role) where.role = role;
    if (status) where.status = status;
    
    if (req.user.role === 'ADMIN') {
      where.managedById = req.user.id;
    }
    
    if (search) {
      where.OR = [
        { fullName: { contains: search, mode: 'insensitive' } },
        { email: { contains: search, mode: 'insensitive' } },
        { phoneNumber: { contains: search, mode: 'insensitive' } }
      ];
    }
    
    const skip = (page - 1) * limit;
    
    const [users, total] = await Promise.all([
      prisma.user.findMany({
        where,
        skip,
        take: parseInt(limit),
        select: {
          id: true,
          email: true,
          fullName: true,
          phoneNumber: true,
          role: true,
          status: true,
          profileImage: true,
          createdAt: true,
          lastLogin: true,
          farm: {
            select: { id: true, name: true }
          }
        },
        orderBy: { createdAt: 'desc' }
      }),
      prisma.user.count({ where })
    ]);
    
    res.json({
      success: true,
      data: users,
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

// Get user by ID
router.get('/:id', authenticate, async (req, res, next) => {
  try {
    const { id } = req.params;
    
    const user = await prisma.user.findUnique({
      where: { id },
      include: {
        farm: true,
        driverProfile: true,
        buyerProfile: true,
        supplierProfile: true
      }
    });
    
    if (!user) {
      throw new AppError('User not found', 404);
    }
    
    const { password, ...userData } = user;
    res.json({ success: true, data: userData });
  } catch (error) {
    next(error);
  }
});

// Update user (Admin only)
router.put('/:id', authenticate, authorize('SUPER_ADMIN', 'ADMIN'), async (req, res, next) => {
  try {
    const { id } = req.params;
    const { status, role, fullName, phoneNumber } = req.body;
    
    const user = await prisma.user.update({
      where: { id },
      data: { status, role, fullName, phoneNumber },
      select: {
        id: true,
        email: true,
        fullName: true,
        phoneNumber: true,
        role: true,
        status: true
      }
    });
    
    res.json({ success: true, data: user });
  } catch (error) {
    next(error);
  }
});

// Delete user (Super Admin only)
router.delete('/:id', authenticate, authorize('SUPER_ADMIN'), async (req, res, next) => {
  try {
    const { id } = req.params;
    
    await prisma.user.delete({ where: { id } });
    res.json({ success: true, message: 'User deleted successfully' });
  } catch (error) {
    next(error);
  }
});

module.exports = router;