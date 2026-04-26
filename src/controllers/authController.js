const bcrypt = require('bcryptjs');
const { prisma } = require('../config/database');
const { generateToken, generateRefreshToken, verifyRefreshToken } = require('../utils/jwt');
const { AppError } = require('../middleware/errorHandler');
const logger = require('../utils/logger');
const emailService = require('../services/emailService');
const notificationService = require('../services/notificationService');

class AuthController {
  // Register new user
  async register(req, res, next) {
    try {
      const { email, password, fullName, phoneNumber, role, supplierType, organizationName } = req.body;

      const existingUser = await prisma.user.findUnique({ where: { email } });
      if (existingUser) {
        throw new AppError('Email already registered', 400);
      }

      const hashedPassword = await bcrypt.hash(password, 10);
      
      const user = await prisma.user.create({
        data: {
          email,
          password: hashedPassword,
          fullName,
          phoneNumber,
          role,
          status: role === 'DRIVER' ? 'PENDING_VERIFICATION' : 'ACTIVE',
          onboardingStep: (role === 'SUPPLIER' || role === 'DRIVER') ? 'PENDING_CODE' : 'COMPLETE'
        },
        select: {
          id: true,
          email: true,
          fullName: true,
          phoneNumber: true,
          role: true,
          status: true,
          onboardingStep: true,
          createdAt: true
        }
      });

      // Create role-specific profile
      if (role === 'DRIVER') {
        await prisma.driverProfile.create({ data: { userId: user.id } });
      } else if (role === 'BUYER') {
        await prisma.buyerProfile.create({ data: { userId: user.id } });
      } else if (role === 'SUPPLIER') {
        await prisma.supplierProfile.create({ data: { userId: user.id, primaryProducts: [], wasteTypes: [], supplierType: supplierType || 'FARMER', organizationName: organizationName || null } });
      }

      const token = generateToken(user.id, user.role);
      const refreshToken = generateRefreshToken(user.id);

      // Send verification email
      emailService.sendVerificationEmail(user.email, token).catch(err =>
        logger.error('Failed to send verification email:', err)
      );

      // Notify all admins/managers when a new supplier or driver registers
      if (role === 'SUPPLIER' || role === 'DRIVER') {
        const roleLabel = role === 'SUPPLIER' ? 'Supplier' : 'Driver';
        const emoji = role === 'SUPPLIER' ? '🧑‍🌾' : '🚚';
        notificationService.notifyAdminsAndManagers(
          null,
          `New ${roleLabel} Registration ${emoji}`,
          `${user.fullName} has registered as a ${roleLabel} and is awaiting approval. Please review their profile.`,
          'SYSTEM',
          { userId: user.id, userRole: role },
          'user:registered',
          { userId: user.id, fullName: user.fullName, role }
        ).catch(err => logger.error('Failed to notify admins of new registration:', err));
      }

      res.status(201).json({
        success: true,
        message: 'Registration successful',
        data: { token, refreshToken, user }
      });
    } catch (error) {
      next(error);
    }
  }

  // Login user
  async login(req, res, next) {
    try {
      const { email, password } = req.body;

      const user = await prisma.user.findUnique({
        where: { email },
        include: {
          farm: true,
          driverProfile: true,
          buyerProfile: true,
          supplierProfile: true
        }
      });

      if (!user) {
        throw new AppError('Username/password is incorrect', 401);
      }

      const isValidPassword = await bcrypt.compare(password, user.password);
      if (!isValidPassword) {
        throw new AppError('Username/password is incorrect', 401);
      }

      if (user.status === 'SUSPENDED') {
        throw new AppError('Account suspended. Please contact support.', 401);
      }

      await prisma.user.update({
        where: { id: user.id },
        data: { lastLogin: new Date() }
      });

      const token = generateToken(user.id, user.role);
      const refreshToken = generateRefreshToken(user.id);
      
      const { password: _, ...userData } = user;

      res.json({
        success: true,
        message: 'Login successful',
        data: { token, refreshToken, user: userData }
      });
    } catch (error) {
      next(error);
    }
  }

  // Refresh token
  async refreshToken(req, res, next) {
    try {
      const { refreshToken } = req.body;
      
      if (!refreshToken) {
        throw new AppError('Refresh token required', 400);
      }

      const decoded = verifyRefreshToken(refreshToken);
      if (!decoded) {
        throw new AppError('Invalid refresh token', 401);
      }

      const user = await prisma.user.findUnique({
        where: { id: decoded.userId }
      });

      if (!user) {
        throw new AppError('User not found', 401);
      }

      const newToken = generateToken(user.id, user.role);
      const newRefreshToken = generateRefreshToken(user.id);

      res.json({
        success: true,
        data: { token: newToken, refreshToken: newRefreshToken }
      });
    } catch (error) {
      next(error);
    }
  }

  // Forgot password
  async forgotPassword(req, res, next) {
    try {
      const { email } = req.body;

      const user = await prisma.user.findUnique({ where: { email } });
      if (!user) {
        return res.json({ success: true, message: 'If email exists, reset link will be sent' });
      }

      const resetToken = generateToken(user.id, user.role);
      const resetUrl = `${process.env.API_URL}/api/auth/reset-password/${resetToken}`;
      
      logger.info(`Password reset link for ${email}: ${resetUrl}`);

      // Send password reset email
      emailService.sendPasswordResetEmail(email, resetToken).catch(err =>
        logger.error('Failed to send password reset email:', err)
      );

      res.json({
        success: true,
        message: 'Password reset instructions sent to your email'
      });
    } catch (error) {
      next(error);
    }
  }

  // Reset password
  async resetPassword(req, res, next) {
    try {
      const { token } = req.params;
      const { password } = req.body;

      const decoded = verifyRefreshToken(token);
      if (!decoded) {
        throw new AppError('Invalid or expired reset token', 400);
      }

      const hashedPassword = await bcrypt.hash(password, 10);
      await prisma.user.update({
        where: { id: decoded.userId },
        data: { password: hashedPassword }
      });

      res.json({
        success: true,
        message: 'Password reset successful'
      });
    } catch (error) {
      next(error);
    }
  }

  // Verify email
  async verifyEmail(req, res, next) {
    try {
      const { token } = req.params;
      const decoded = verifyRefreshToken(token);
      
      if (!decoded) {
        throw new AppError('Invalid or expired verification token', 400);
      }

      await prisma.user.update({
        where: { id: decoded.userId },
        data: { emailVerified: true, status: 'ACTIVE' }
      });

      res.json({
        success: true,
        message: 'Email verified successfully'
      });
    } catch (error) {
      next(error);
    }
  }

  // Logout
  async logout(req, res, next) {
    try {
      // In a real implementation, you might want to blacklist the token
      res.json({ success: true, message: 'Logged out successfully' });
    } catch (error) {
      next(error);
    }
  }

  // Complete admin company profile (onboarding step for ADMIN / SUPER_ADMIN)
  async completeAdminProfile(req, res, next) {
    try {
      const userId = req.user.id;
      const {
        companyName, email, phoneNumber,
        country, city, region, address, landmark, lat, lng,
        employeeCount, registrationNumber, description, tags,
      } = req.body;

      if (!companyName) throw new AppError('Company name is required', 400);
      if (!email) throw new AppError('Company email is required', 400);
      if (!country || !city || !address) throw new AppError('Country, city and address are required', 400);

      const logoPath = req.file ? `/uploads/images/profiles/${req.file.filename}` : undefined;

      let parsedTags = [];
      if (tags) {
        try { parsedTags = JSON.parse(tags); } catch { parsedTags = []; }
      }

      // Generate a unique invite code for the company
      const crypto = require('crypto');
      const inviteCode = crypto.randomBytes(4).toString('hex').toUpperCase();

      // Upsert Admin record — if user already has a linked admin, update it; otherwise create
      const currentUser = await prisma.user.findUnique({
        where: { id: userId },
        select: { managedById: true },
      });

      let admin;
      if (currentUser?.managedById) {
        admin = await prisma.admin.update({
          where: { id: currentUser.managedById },
          data: {
            companyName: companyName.trim(),
            email: email.trim(),
            phoneNumber: phoneNumber || null,
            country: country.trim(),
            city: city.trim(),
            region: region?.trim() || null,
            address: address.trim(),
            landmark: landmark?.trim() || null,
            lat: lat ? parseFloat(lat) : null,
            lng: lng ? parseFloat(lng) : null,
            employeeCount: employeeCount ? parseInt(employeeCount) : null,
            description: description?.trim() || null,
            tags: parsedTags,
            ...(logoPath && { companyLogo: logoPath }),
            profileCompleted: true,
          },
        });
      } else {
        admin = await prisma.admin.create({
          data: {
            companyName: companyName.trim(),
            email: email.trim(),
            phoneNumber: phoneNumber || null,
            country: country.trim(),
            city: city.trim(),
            region: region?.trim() || null,
            address: address.trim(),
            landmark: landmark?.trim() || null,
            lat: lat ? parseFloat(lat) : null,
            lng: lng ? parseFloat(lng) : null,
            employeeCount: employeeCount ? parseInt(employeeCount) : null,
            description: description?.trim() || null,
            tags: parsedTags,
            companyLogo: logoPath || null,
            profileCompleted: true,
            inviteCode,
          },
        });
      }

      // Link user to admin company and mark onboarding complete
      const updatedUser = await prisma.user.update({
        where: { id: userId },
        data: { managedById: admin.id, onboardingStep: 'COMPLETE' },
        select: {
          id: true, email: true, fullName: true, phoneNumber: true,
          role: true, status: true, onboardingStep: true, managedById: true,
        },
      });

      res.json({
        success: true,
        message: 'Company profile completed successfully',
        data: { user: updatedUser, admin },
      });
    } catch (error) {
      next(error);
    }
  }
}

module.exports = new AuthController();