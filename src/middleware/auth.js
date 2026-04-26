const jwt = require('jsonwebtoken');
const { prisma } = require('../config/database');
const logger = require('../utils/logger');

// JWT Authentication Middleware
const authenticate = async (req, res, next) => {
  try {
    const token = req.headers.authorization?.split(' ')[1];
    
    if (!token) {
      return res.status(401).json({ 
        success: false, 
        message: 'Authentication required. Please provide a valid token.' 
      });
    }
    
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    
    const user = await prisma.user.findUnique({
      where: { id: decoded.userId },
      include: {
        farm: true,
        adminManaged: true,
        driverProfile: true,
        buyerProfile: true,
        supplierProfile: true
      }
    });
    
    if (!user) {
      return res.status(401).json({ 
        success: false, 
        message: 'User not found. Invalid token.' 
      });
    }
    
    if (user.status === 'SUSPENDED') {
      return res.status(401).json({ 
        success: false, 
        message: 'Account has been suspended. Please contact support.' 
      });
    }
    
    if (user.status === 'INACTIVE') {
      return res.status(401).json({ 
        success: false, 
        message: 'Account is inactive. Please contact support.' 
      });
    }
    
    req.user = {
      id: user.id,
      email: user.email,
      fullName: user.fullName,
      role: user.role,
      status: user.status,
      farmId: user.farm?.id,
      farm: user.farm,
      adminManaged: user.adminManaged,
      driverProfile: user.driverProfile,
      buyerProfile: user.buyerProfile,
      supplierProfile: user.supplierProfile
    };
    
    next();
  } catch (error) {
    if (error.name === 'JsonWebTokenError') {
      return res.status(401).json({ 
        success: false, 
        message: 'Invalid token. Please login again.' 
      });
    }
    if (error.name === 'TokenExpiredError') {
      return res.status(401).json({ 
        success: false, 
        message: 'Token has expired. Please login again.' 
      });
    }
    
    logger.error('Authentication error:', error);
    res.status(500).json({ 
      success: false, 
      message: 'Authentication error. Please try again later.' 
    });
  }
};

// Role-based Authorization Middleware
const authorize = (...roles) => {
  return (req, res, next) => {
    if (!req.user) {
      return res.status(401).json({ 
        success: false, 
        message: 'Authentication required' 
      });
    }
    
    if (!roles.includes(req.user.role)) {
      return res.status(403).json({ 
        success: false, 
        message: `Access denied. ${req.user.role} role does not have permission to access this resource.`,
        requiredRoles: roles
      });
    }
    
    next();
  };
};

// Farm Access Authorization Middleware
const authorizeFarmAccess = async (req, res, next) => {
  try {
    const farmId = req.params.farmId || req.body.farmId || req.params.id;
    
    if (!farmId) {
      return next();
    }
    
    const farm = await prisma.farm.findUnique({
      where: { id: farmId },
      include: { admin: true, manager: true }
    });
    
    if (!farm) {
      return res.status(404).json({ 
        success: false, 
        message: 'Farm not found' 
      });
    }
    
    const hasAccess = 
      req.user.role === 'SUPER_ADMIN' ||
      (req.user.role === 'ADMIN' && farm.adminId === req.user.adminManaged?.id) ||
      (req.user.role === 'MANAGER' && farm.managerId === req.user.id);
    
    if (!hasAccess) {
      return res.status(403).json({ 
        success: false, 
        message: 'You do not have access to this farm' 
      });
    }
    
    req.farm = farm;
    next();
  } catch (error) {
    logger.error('Farm access authorization error:', error);
    res.status(500).json({ 
      success: false, 
      message: 'Error checking farm access' 
    });
  }
};

// Optional Authentication (doesn't require token but adds user if present)
const optionalAuth = async (req, res, next) => {
  try {
    const token = req.headers.authorization?.split(' ')[1];
    
    if (token) {
      const decoded = jwt.verify(token, process.env.JWT_SECRET);
      const user = await prisma.user.findUnique({
        where: { id: decoded.userId }
      });
      
      if (user && user.status === 'ACTIVE') {
        req.user = {
          id: user.id,
          email: user.email,
          fullName: user.fullName,
          role: user.role
        };
      }
    }
    
    next();
  } catch (error) {
    next();
  }
};

module.exports = { 
  authenticate, 
  authorize, 
  authorizeFarmAccess,
  optionalAuth 
};