const express = require('express');
const { body, validationResult } = require('express-validator');
const { prisma } = require('../config/database');
const { authenticate, authorize } = require('../middleware/auth');
const { AppError } = require('../middleware/errorHandler');

const router = express.Router();

// Get driver profile
router.get('/profile', authenticate, authorize('DRIVER'), async (req, res, next) => {
  try {
    const profile = await prisma.driverProfile.findUnique({
      where: { userId: req.user.id },
      include: {
        user: {
          select: { id: true, fullName: true, email: true, phoneNumber: true, profileImage: true }
        }
      }
    });
    
    if (!profile) {
      throw new AppError('Driver profile not found', 404);
    }
    
    res.json({ success: true, data: profile });
  } catch (error) {
    next(error);
  }
});

// Get company / processing center location for the logged-in driver
router.get('/company', authenticate, authorize('DRIVER'), async (req, res, next) => {
  try {
    const profile = await prisma.driverProfile.findUnique({
      where: { userId: req.user.id },
      include: {
        admin: {
          select: {
            companyName: true,
            lat: true,
            lng: true,
            address: true,
            city: true,
            region: true,
            country: true,
          }
        }
      }
    });

    if (!profile?.admin) {
      return res.json({ success: true, data: null });
    }

    res.json({ success: true, data: profile.admin });
  } catch (error) {
    next(error);
  }
});

// Update driver profile
router.put('/profile', authenticate, authorize('DRIVER'), async (req, res, next) => {
  try {
    const {
      licenseNumber,
      licenseDocument,
      licenseExpiry,
      idCardNumber,
      idCardDocument,
      vehicleType,
      vehicleModel,
      vehiclePlateNumber,
      vehicleRegistration,
      vehicleDocument,
      baseLocation
    } = req.body;
    
    const profile = await prisma.driverProfile.update({
      where: { userId: req.user.id },
      data: {
        licenseNumber,
        licenseDocument,
        licenseExpiry: licenseExpiry ? new Date(licenseExpiry) : undefined,
        idCardNumber,
        idCardDocument,
        vehicleType,
        vehicleModel,
        vehiclePlateNumber,
        vehicleRegistration,
        vehicleDocument,
        baseLocation
      },
      include: { user: { select: { fullName: true, email: true } } }
    });
    
    res.json({ success: true, data: profile });
  } catch (error) {
    next(error);
  }
});

// Get driver's assigned deliveries
router.get('/deliveries', authenticate, authorize('DRIVER'), async (req, res, next) => {
  try {
    const { status, page = 1, limit = 20 } = req.query;
    const where = { driverId: req.user.id };
    
    if (status) where.status = status;
    
    const skip = (page - 1) * limit;
    
    const [deliveries, total] = await Promise.all([
      prisma.order.findMany({
        where,
        include: {
          customer: { select: { id: true, fullName: true, email: true, phoneNumber: true } },
          items: {
            include: {
              variant: {
                include: { product: { select: { id: true, name: true, images: true } } }
              }
            }
          },
          shipment: true
        },
        orderBy: { createdAt: 'asc' },
        skip,
        take: parseInt(limit)
      }),
      prisma.order.count({ where })
    ]);
    
    res.json({
      success: true,
      data: deliveries,
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

// Get specific delivery
router.get('/deliveries/:orderId', authenticate, authorize('DRIVER'), async (req, res, next) => {
  try {
    const { orderId } = req.params;
    
    const order = await prisma.order.findFirst({
      where: { id: orderId, driverId: req.user.id },
      include: {
        customer: { select: { id: true, fullName: true, email: true, phoneNumber: true, buyerProfile: true } },
        items: {
          include: {
            variant: {
              include: { product: { select: { id: true, name: true, images: true, description: true } } }
            }
          }
        },
        shipment: true,
        invoice: true
      }
    });
    
    if (!order) {
      throw new AppError('Delivery not found', 404);
    }
    
    res.json({ success: true, data: order });
  } catch (error) {
    next(error);
  }
});

// Update delivery status
router.patch('/deliveries/:orderId/status', authenticate, authorize('DRIVER'), [
  body('status').isIn(['PROCESSING', 'SHIPPED', 'OUT_FOR_DELIVERY', 'DELIVERED', 'FAILED'])
], async (req, res, next) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({ success: false, errors: errors.array() });
  }

  try {
    const { orderId } = req.params;
    const { status, location, notes } = req.body;
    
    const order = await prisma.order.findFirst({
      where: { id: orderId, driverId: req.user.id }
    });
    
    if (!order) {
      throw new AppError('Order not found or not assigned to you', 404);
    }
    
    const updateData = { status };
    if (status === 'DELIVERED') {
      updateData.deliveredAt = new Date();
    }
    
    const updatedOrder = await prisma.order.update({
      where: { id: orderId },
      data: updateData
    });
    
    if (location) {
      await prisma.shipment.upsert({
        where: { orderId },
        update: {
          currentLocation: location,
          events: { push: { status, location, timestamp: new Date() } }
        },
        create: {
          orderId,
          carrier: 'Driver Delivery',
          trackingNumber: `DRV-${Date.now()}`,
          currentLocation: location,
          events: [{ status, location, timestamp: new Date() }]
        }
      });
    }
    
    res.json({
      success: true,
      message: `Delivery status updated to ${status}`,
      data: updatedOrder
    });
  } catch (error) {
    next(error);
  }
});

// Update current location (real-time)
router.post('/location', authenticate, authorize('DRIVER'), [
  body('lat').isFloat({ min: -90, max: 90 }),
  body('lng').isFloat({ min: -180, max: 180 })
], async (req, res, next) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({ success: false, errors: errors.array() });
  }

  try {
    const { lat, lng, orderId, wasteId } = req.body;
    
    await prisma.driverProfile.update({
      where: { userId: req.user.id },
      data: { currentLocation: { lat, lng, updatedAt: new Date() } }
    });

    const io = req.app.get('io');
    const locationPayload = {
      driverId: req.user.id,
      driverName: req.user.fullName,
      location: { lat, lng },
      timestamp: new Date()
    };

    if (io && orderId) {
      io.to(`order-${orderId}`).emit('driver:location', locationPayload);
    }

    if (io && wasteId) {
      io.to(`waste:${wasteId}`).emit('driver:location', locationPayload);
    }
    
    res.json({
      success: true,
      message: 'Location updated successfully'
    });
  } catch (error) {
    next(error);
  }
});

// Get driver current location for a waste record (supplier polling)
router.get('/location/:wasteId', authenticate, async (req, res, next) => {
  try {
    const { wasteId } = req.params;

    // Verify the requester is the supplier who submitted this waste, the assigned driver, or farm staff
    const waste = await prisma.wasteRecord.findUnique({
      where: { id: wasteId },
      select: {
        supplierId: true,
        driver: {
          select: {
            id: true,
            driverProfile: { select: { currentLocation: true } },
            fullName: true
          }
        }
      }
    });

    if (!waste) {
      return res.status(404).json({ success: false, message: 'Waste record not found' });
    }

    const allowedRoles = ['ADMIN', 'SUPER_ADMIN', 'MANAGER', 'DRIVER'];
    const isSupplier = waste.supplierId === req.user.id;
    const isStaff = allowedRoles.includes(req.user.role);

    if (!isSupplier && !isStaff) {
      return res.status(403).json({ success: false, message: 'Access denied' });
    }

    if (!waste.driver) {
      return res.json({ success: true, data: null, message: 'No driver assigned' });
    }

    res.json({
      success: true,
      data: {
        driverName: waste.driver.fullName,
        location: waste.driver.driverProfile?.currentLocation ?? null
      }
    });
  } catch (error) {
    next(error);
  }
});

// Get driver statistics
router.get('/stats', authenticate, authorize('DRIVER'), async (req, res, next) => {
  try {
    const [totalDeliveries, completedDeliveries, totalRevenue, averageRating] = await Promise.all([
      prisma.order.count({ where: { driverId: req.user.id } }),
      prisma.order.count({ where: { driverId: req.user.id, status: 'DELIVERED' } }),
      prisma.order.aggregate({
        where: { driverId: req.user.id, status: 'DELIVERED' },
        _sum: { total: true }
      }),
      prisma.driverProfile.findUnique({
        where: { userId: req.user.id },
        select: { rating: true }
      })
    ]);
    
    const recentDeliveries = await prisma.order.findMany({
      where: { driverId: req.user.id },
      orderBy: { createdAt: 'desc' },
      take: 10,
      include: { customer: { select: { fullName: true } } }
    });
    
    res.json({
      success: true,
      data: {
        totalDeliveries,
        completedDeliveries,
        pendingDeliveries: totalDeliveries - completedDeliveries,
        totalRevenue: totalRevenue._sum.total || 0,
        averageRating: averageRating?.rating || 0,
        completionRate: totalDeliveries > 0 ? (completedDeliveries / totalDeliveries) * 100 : 0,
        recentDeliveries
      }
    });
  } catch (error) {
    next(error);
  }
});

// Mark driver as available/unavailable
router.patch('/availability', authenticate, authorize('DRIVER'), [
  body('isAvailable').isBoolean()
], async (req, res, next) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({ success: false, errors: errors.array() });
  }

  try {
    const { isAvailable } = req.body;
    
    await prisma.driverProfile.update({
      where: { userId: req.user.id },
      data: { status: isAvailable ? 'ACTIVE' : 'OFFLINE' }
    });
    
    res.json({
      success: true,
      message: `Driver is now ${isAvailable ? 'available' : 'offline'}`
    });
  } catch (error) {
    next(error);
  }
});

// Upload document
router.post('/documents', authenticate, authorize('DRIVER'), async (req, res, next) => {
  try {
    const { documentType, documentUrl } = req.body;
    
    const updateData = {};
    if (documentType === 'license') updateData.licenseDocument = documentUrl;
    if (documentType === 'id_card') updateData.idCardDocument = documentUrl;
    if (documentType === 'vehicle_registration') updateData.vehicleDocument = documentUrl;
    
    await prisma.driverProfile.update({
      where: { userId: req.user.id },
      data: updateData
    });
    
    res.json({
      success: true,
      message: 'Document uploaded successfully'
    });
  } catch (error) {
    next(error);
  }
});

module.exports = router;