const bcrypt = require('bcryptjs');
const { prisma } = require('../config/database');
const { AppError } = require('../middleware/errorHandler');
const { calculatePagination } = require('../utils/helpers');

class UserController {
  // Get current user profile
  async getProfile(req, res, next) {
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
  }

  // Update user profile
  async updateProfile(req, res, next) {
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
  }

  // Change password
  async changePassword(req, res, next) {
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
  }

  // Get all users (Admin only)
  async getAllUsers(req, res, next) {
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
      
      const { skip, pagination } = calculatePagination(page, limit, 0);
      
      const [users, total] = await Promise.all([
        prisma.user.findMany({
          where,
          skip,
          take: pagination.limit,
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
            farm: { select: { id: true, name: true } }
          },
          orderBy: { createdAt: 'desc' }
        }),
        prisma.user.count({ where })
      ]);
      
      pagination.total = total;
      pagination.pages = Math.ceil(total / pagination.limit);
      
      res.json({ success: true, data: users, pagination });
    } catch (error) {
      next(error);
    }
  }

  // Get user by ID
  async getUserById(req, res, next) {
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
  }

  // Update user (Admin only)
  async updateUser(req, res, next) {
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
  }

  // Delete user (Super Admin only)
  async deleteUser(req, res, next) {
    try {
      const { id } = req.params;
      
      await prisma.user.delete({ where: { id } });
      res.json({ success: true, message: 'User deleted successfully' });
    } catch (error) {
      next(error);
    }
  }
}

module.exports = new UserController();