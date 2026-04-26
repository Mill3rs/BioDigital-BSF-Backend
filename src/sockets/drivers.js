const logger = require('../utils/logger');
const { prisma } = require('../config/database');
const { broadcastToFarm, sendToUser } = require('./helpers');

module.exports = (io, socket) => {
  const userId = socket.user.id;
  const userRole = socket.user.role;
  
  // Driver location update
  socket.on('driver:location', async (data) => {
    try {
      const { lat, lng, heading, speed, accuracy, orderId } = data;
      
      if (userRole !== 'DRIVER') {
        return socket.emit('error', { message: 'Only drivers can update location' });
      }
      
      // Update driver location in database
      await prisma.driverProfile.update({
        where: { userId },
        data: {
          currentLocation: {
            lat,
            lng,
            heading,
            speed,
            accuracy,
            updatedAt: new Date()
          }
        }
      });
      
      // Broadcast to customers tracking this driver
      if (orderId) {
        io.to(`order:${orderId}`).emit('driver:location', {
          driverId: userId,
          driverName: socket.user.fullName,
          location: { lat, lng, heading, speed },
          timestamp: new Date()
        });
      }
      
      // Broadcast to farm admins
      if (socket.user.farmId) {
        broadcastToFarm(socket.user.farmId, 'driver:location', {
          driverId: userId,
          driverName: socket.user.fullName,
          location: { lat, lng, heading, speed },
          timestamp: new Date()
        });
      }
      
      logger.debug(`Driver ${userId} location updated: ${lat}, ${lng}`);
      
    } catch (error) {
      logger.error('Driver location update error:', error);
      socket.emit('error', { message: 'Failed to update location' });
    }
  });
  
  // Driver status update (online/offline/busy)
  socket.on('driver:status', async (data) => {
    try {
      const { status, orderId } = data;
      const validStatuses = ['ONLINE', 'OFFLINE', 'BUSY', 'DELIVERING', 'BREAK'];
      
      if (!validStatuses.includes(status)) {
        return socket.emit('error', { message: 'Invalid driver status' });
      }
      
      if (userRole !== 'DRIVER') {
        return socket.emit('error', { message: 'Only drivers can update status' });
      }
      
      // Update driver status in database
      await prisma.driverProfile.update({
        where: { userId },
        data: { status: status === 'ONLINE' ? 'ACTIVE' : 'OFFLINE' }
      });
      
      // Handle room joining/leaving based on status
      if (status === 'ONLINE') {
        socket.join('drivers:online');
      } else {
        socket.leave('drivers:online');
      }
      
      // Broadcast status change
      io.to('drivers:online').emit('driver:status', {
        driverId: userId,
        driverName: socket.user.fullName,
        status,
        timestamp: new Date()
      });
      
      if (orderId) {
        io.to(`order:${orderId}`).emit('driver:status', {
          driverId: userId,
          status,
          timestamp: new Date()
        });
      }
      
      logger.info(`Driver ${userId} status changed to ${status}`);
      
    } catch (error) {
      logger.error('Driver status update error:', error);
      socket.emit('error', { message: 'Failed to update status' });
    }
  });
  
  // Driver accepting an order
  socket.on('driver:accept', async (data) => {
    try {
      const { orderId } = data;
      
      if (userRole !== 'DRIVER') {
        return socket.emit('error', { message: 'Only drivers can accept orders' });
      }
      
      // Check if order is still available
      const order = await prisma.order.findUnique({
        where: { id: orderId },
        include: { customer: true }
      });
      
      if (!order) {
        return socket.emit('error', { message: 'Order not found' });
      }
      
      if (order.status !== 'PENDING') {
        return socket.emit('error', { message: 'Order is no longer available' });
      }
      
      // Assign driver to order
      await prisma.order.update({
        where: { id: orderId },
        data: {
          driverId: userId,
          status: 'PROCESSING'
        }
      });
      
      // Join order room for real-time updates
      socket.join(`order:${orderId}`);
      
      // Notify customer
      sendToUser(order.customerId, 'order:accepted', {
        orderId,
        driverId: userId,
        driverName: socket.user.fullName,
        timestamp: new Date()
      });
      
      // Notify farm
      if (order.farmId) {
        broadcastToFarm(order.farmId, 'order:accepted', {
          orderId,
          driverId: userId,
          driverName: socket.user.fullName,
          timestamp: new Date()
        });
      }
      
      logger.info(`Driver ${userId} accepted order ${orderId}`);
      
      socket.emit('driver:accepted', {
        orderId,
        success: true,
        timestamp: new Date()
      });
      
    } catch (error) {
      logger.error('Driver accept order error:', error);
      socket.emit('error', { message: 'Failed to accept order' });
    }
  });
  
  // Driver arrived at pickup location
  socket.on('driver:arrived', async (data) => {
    try {
      const { orderId, location } = data;
      
      if (userRole !== 'DRIVER') {
        return socket.emit('error', { message: 'Only drivers can report arrival' });
      }
      
      const order = await prisma.order.findUnique({
        where: { id: orderId },
        select: { customerId: true, farmId: true }
      });
      
      if (!order) {
        return socket.emit('error', { message: 'Order not found' });
      }
      
      // Notify customer
      sendToUser(order.customerId, 'driver:arrived', {
        orderId,
        driverId: userId,
        driverName: socket.user.fullName,
        location,
        timestamp: new Date()
      });
      
      // Notify farm
      if (order.farmId) {
        broadcastToFarm(order.farmId, 'driver:arrived', {
          orderId,
          driverId: userId,
          driverName: socket.user.fullName,
          location,
          timestamp: new Date()
        });
      }
      
      logger.info(`Driver ${userId} arrived for order ${orderId}`);
      
    } catch (error) {
      logger.error('Driver arrived error:', error);
      socket.emit('error', { message: 'Failed to report arrival' });
    }
  });
  
  // Driver started delivery
  socket.on('driver:started', async (data) => {
    try {
      const { orderId } = data;
      
      if (userRole !== 'DRIVER') {
        return socket.emit('error', { message: 'Only drivers can start delivery' });
      }
      
      await prisma.order.update({
        where: { id: orderId },
        data: { status: 'OUT_FOR_DELIVERY' }
      });
      
      const order = await prisma.order.findUnique({
        where: { id: orderId },
        select: { customerId: true, farmId: true }
      });
      
      if (order) {
        sendToUser(order.customerId, 'order:status', {
          orderId,
          status: 'OUT_FOR_DELIVERY',
          driverId: userId,
          driverName: socket.user.fullName,
          timestamp: new Date()
        });
        
        if (order.farmId) {
          broadcastToFarm(order.farmId, 'order:status', {
            orderId,
            status: 'OUT_FOR_DELIVERY',
            driverId: userId,
            timestamp: new Date()
          });
        }
      }
      
      logger.info(`Driver ${userId} started delivery for order ${orderId}`);
      
    } catch (error) {
      logger.error('Driver started delivery error:', error);
      socket.emit('error', { message: 'Failed to start delivery' });
    }
  });
  
  // Driver completed delivery
  socket.on('driver:completed', async (data) => {
    try {
      const { orderId, signature, deliveryImage } = data;
      
      if (userRole !== 'DRIVER') {
        return socket.emit('error', { message: 'Only drivers can complete delivery' });
      }
      
      await prisma.order.update({
        where: { id: orderId },
        data: {
          status: 'DELIVERED',
          deliveredAt: new Date(),
          deliverySignature: signature,
          deliveryImage
        }
      });
      
      const order = await prisma.order.findUnique({
        where: { id: orderId },
        select: { customerId: true, farmId: true }
      });
      
      if (order) {
        sendToUser(order.customerId, 'order:delivered', {
          orderId,
          driverId: userId,
          driverName: socket.user.fullName,
          timestamp: new Date(),
          signature,
          deliveryImage
        });
        
        if (order.farmId) {
          broadcastToFarm(order.farmId, 'order:delivered', {
            orderId,
            driverId: userId,
            timestamp: new Date()
          });
        }
      }
      
      // Leave order room
      socket.leave(`order:${orderId}`);
      
      logger.info(`Driver ${userId} completed delivery for order ${orderId}`);
      
      socket.emit('driver:completed', {
        orderId,
        success: true,
        timestamp: new Date()
      });
      
    } catch (error) {
      logger.error('Driver complete delivery error:', error);
      socket.emit('error', { message: 'Failed to complete delivery' });
    }
  });
  
  // Get nearby orders for driver
  socket.on('driver:nearby', async (data) => {
    try {
      const { lat, lng, radius = 10 } = data;
      
      if (userRole !== 'DRIVER') {
        return socket.emit('error', { message: 'Only drivers can get nearby orders' });
      }
      
      // Query nearby orders (implementation depends on database)
      const nearbyOrders = await prisma.order.findMany({
        where: {
          status: 'PENDING',
          deliveryAddress: {
            // Geo-spatial query would go here
          }
        },
        include: {
          items: {
            include: {
              variant: {
                include: { product: true }
              }
            }
          },
          customer: {
            select: { fullName: true, phoneNumber: true }
          }
        },
        take: 20
      });
      
      socket.emit('driver:nearby-orders', {
        orders: nearbyOrders,
        location: { lat, lng },
        radius,
        timestamp: new Date()
      });
      
    } catch (error) {
      logger.error('Get nearby orders error:', error);
      socket.emit('error', { message: 'Failed to get nearby orders' });
    }
  });
};