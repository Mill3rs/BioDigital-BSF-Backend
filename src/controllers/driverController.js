const { prisma } = require('../config/database');
const { AppError } = require('../middleware/errorHandler');
const { calculatePagination } = require('../utils/helpers');

class DriverController {
  // Get driver profile
  async getProfile(req, res, next) {
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
  }

  // Update driver profile
  async updateProfile(req, res, next) {
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
  }

  // Get driver's assigned deliveries
  async getDeliveries(req, res, next) {
    try {
      const { status, page = 1, limit = 20 } = req.query;
      const where = { driverId: req.user.id };
      
      if (status) where.status = status;
      
      const { skip, pagination } = calculatePagination(page, limit, 0);
      
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
          take: pagination.limit
        }),
        prisma.order.count({ where })
      ]);
      
      pagination.total = total;
      pagination.pages = Math.ceil(total / pagination.limit);
      
      res.json({ success: true, data: deliveries, pagination });
    } catch (error) {
      next(error);
    }
  }

  // Get specific delivery
  async getDeliveryById(req, res, next) {
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
  }

  // Update delivery status
  async updateDeliveryStatus(req, res, next) {
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
            events: { push: { status, location, notes, timestamp: new Date() } }
          },
          create: {
            orderId,
            carrier: 'Driver Delivery',
            trackingNumber: `DRV-${Date.now()}`,
            currentLocation: location,
            events: [{ status, location, notes, timestamp: new Date() }]
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
  }

  // Update current location (real-time)
  async updateLocation(req, res, next) {
    try {
      const { lat, lng, orderId } = req.body;
      
      await prisma.driverProfile.update({
        where: { userId: req.user.id },
        data: { currentLocation: { lat, lng, updatedAt: new Date() } }
      });
      
      // Emit socket event for real-time tracking (handled in socket handler)
      if (orderId) {
        const io = req.app.get('io');
        io.to(`order-${orderId}`).emit('driver:location', {
          driverId: req.user.id,
          location: { lat, lng },
          timestamp: new Date()
        });
      }
      
      res.json({
        success: true,
        message: 'Location updated successfully'
      });
    } catch (error) {
      next(error);
    }
  }

  // Get driver statistics
  async getStats(req, res, next) {
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
  }

  // Mark driver as available/unavailable
  async setAvailability(req, res, next) {
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
  }

  // Upload document
  async uploadDocument(req, res, next) {
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
  }
}

module.exports = new DriverController();