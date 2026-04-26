const logger = require('../utils/logger');
const { prisma } = require('../config/database');
const { broadcastToFarm, sendToUser, broadcastToRole } = require('./helpers');

module.exports = (io, socket) => {
  const userId = socket.user.id;
  const userRole = socket.user.role;
  
  // Join order room for real-time updates
  socket.on('order:join', async (orderId) => {
    try {
      const order = await prisma.order.findUnique({
        where: { id: orderId },
        select: { customerId: true, farmId: true, driverId: true }
      });
      
      if (!order) {
        return socket.emit('error', { message: 'Order not found' });
      }
      
      // Check if user is authorized to track this order
      const isAuthorized = 
        userId === order.customerId ||
        userId === order.driverId ||
        userRole === 'ADMIN' ||
        (userRole === 'MANAGER' && order.farmId === socket.user.farmId);
      
      if (isAuthorized) {
        socket.join(`order:${orderId}`);
        socket.emit('order:joined', { orderId, success: true });
        logger.debug(`User ${userId} joined order room: ${orderId}`);
      } else {
        socket.emit('error', { message: 'Not authorized to track this order' });
      }
      
    } catch (error) {
      logger.error('Order join error:', error);
      socket.emit('error', { message: 'Failed to join order room' });
    }
  });
  
  // Leave order room
  socket.on('order:leave', (orderId) => {
    socket.leave(`order:${orderId}`);
    logger.debug(`User ${userId} left order room: ${orderId}`);
  });
  
  // Order status update (from farm/admin)
  socket.on('order:update-status', async (data) => {
    try {
      const { orderId, status, notes } = data;
      const validStatuses = ['CONFIRMED', 'PROCESSING', 'READY_FOR_PICKUP', 'SHIPPED', 'COMPLETED', 'CANCELLED'];
      
      if (!validStatuses.includes(status)) {
        return socket.emit('error', { message: 'Invalid order status' });
      }
      
      // Check authorization
      const isAuthorized = 
        userRole === 'ADMIN' ||
        (userRole === 'MANAGER' && socket.user.farmId);
      
      if (!isAuthorized) {
        return socket.emit('error', { message: 'Not authorized to update order status' });
      }
      
      const order = await prisma.order.findUnique({
        where: { id: orderId },
        include: { customer: true, driver: true }
      });
      
      if (!order) {
        return socket.emit('error', { message: 'Order not found' });
      }
      
      // Update order status
      await prisma.order.update({
        where: { id: orderId },
        data: { 
          status,
          ...(status === 'COMPLETED' && { completedAt: new Date() }),
          ...(status === 'CANCELLED' && { cancelledAt: new Date(), cancellationReason: notes })
        }
      });
      
      // Broadcast status update to all parties
      const statusData = {
        orderId,
        status,
        notes,
        updatedBy: socket.user.fullName,
        timestamp: new Date()
      };
      
      io.to(`order:${orderId}`).emit('order:status', statusData);
      
      // Notify customer
      if (order.customerId) {
        sendToUser(order.customerId, 'order:status', statusData);
      }
      
      // Notify driver if assigned
      if (order.driverId) {
        sendToUser(order.driverId, 'order:status', statusData);
      }
      
      // Notify farm
      if (order.farmId) {
        broadcastToFarm(order.farmId, 'order:status', statusData);
      }
      
      logger.info(`Order ${orderId} status updated to ${status} by ${userId}`);
      
    } catch (error) {
      logger.error('Order status update error:', error);
      socket.emit('error', { message: 'Failed to update order status' });
    }
  });
  
  // Order cancellation request (from customer)
  socket.on('order:cancel-request', async (data) => {
    try {
      const { orderId, reason } = data;
      
      const order = await prisma.order.findUnique({
        where: { id: orderId },
        select: { customerId: true, status: true, farmId: true }
      });
      
      if (!order) {
        return socket.emit('error', { message: 'Order not found' });
      }
      
      if (order.customerId !== userId) {
        return socket.emit('error', { message: 'Not authorized to cancel this order' });
      }
      
      if (order.status !== 'PENDING' && order.status !== 'CONFIRMED') {
        return socket.emit('error', { message: 'Order cannot be cancelled at this stage' });
      }
      
      // Notify farm admin for approval
      if (order.farmId) {
        broadcastToFarm(order.farmId, 'order:cancel-request', {
          orderId,
          reason,
          customerId: userId,
          timestamp: new Date()
        });
      }
      
      socket.emit('order:cancel-requested', {
        orderId,
        success: true,
        message: 'Cancellation request sent to farm'
      });
      
      logger.info(`Cancellation request for order ${orderId} from user ${userId}`);
      
    } catch (error) {
      logger.error('Order cancel request error:', error);
      socket.emit('error', { message: 'Failed to request cancellation' });
    }
  });
  
  // Approve cancellation (from farm/admin)
  socket.on('order:cancel-approve', async (data) => {
    try {
      const { orderId } = data;
      
      const isAuthorized = 
        userRole === 'ADMIN' ||
        (userRole === 'MANAGER' && socket.user.farmId);
      
      if (!isAuthorized) {
        return socket.emit('error', { message: 'Not authorized to approve cancellation' });
      }
      
      const order = await prisma.order.findUnique({
        where: { id: orderId },
        include: { items: true }
      });
      
      if (!order) {
        return socket.emit('error', { message: 'Order not found' });
      }
      
      // Restore stock
      for (const item of order.items) {
        await prisma.productVariant.update({
          where: { id: item.variantId },
          data: { quantity: { increment: item.quantity } }
        });
      }
      
      // Cancel order
      await prisma.order.update({
        where: { id: orderId },
        data: {
          status: 'CANCELLED',
          cancelledAt: new Date(),
          cancellationReason: 'Approved by farm'
        }
      });
      
      // Notify customer
      if (order.customerId) {
        sendToUser(order.customerId, 'order:cancelled', {
          orderId,
          timestamp: new Date()
        });
      }
      
      io.to(`order:${orderId}`).emit('order:cancelled', {
        orderId,
        timestamp: new Date()
      });
      
      logger.info(`Order ${orderId} cancelled by ${userId}`);
      
    } catch (error) {
      logger.error('Order cancel approve error:', error);
      socket.emit('error', { message: 'Failed to cancel order' });
    }
  });
  
  // New order notification (broadcast to drivers)
  socket.on('order:new', async (data) => {
    try {
      const { orderId } = data;
      
      const isAuthorized = 
        userRole === 'ADMIN' ||
        (userRole === 'MANAGER' && socket.user.farmId);
      
      if (!isAuthorized) {
        return socket.emit('error', { message: 'Not authorized to broadcast orders' });
      }
      
      const order = await prisma.order.findUnique({
        where: { id: orderId },
        include: {
          items: {
            include: {
              variant: {
                include: { product: true }
              }
            }
          },
          customer: {
            select: { fullName: true, phoneNumber: true, deliveryAddress: true }
          }
        }
      });
      
      if (!order) {
        return socket.emit('error', { message: 'Order not found' });
      }
      
      // Notify all online drivers
      broadcastToRole('DRIVER', 'order:available', {
        orderId,
        orderNumber: order.orderNumber,
        total: order.total,
        customerName: order.customer.fullName,
        deliveryAddress: order.customer.deliveryAddress,
        items: order.items.map(item => ({
          name: item.variant.product.name,
          quantity: item.quantity
        })),
        timestamp: new Date()
      });
      
      logger.info(`New order ${orderId} broadcasted to drivers`);
      
    } catch (error) {
      logger.error('New order broadcast error:', error);
      socket.emit('error', { message: 'Failed to broadcast order' });
    }
  });
  
  // Track driver location for specific order
  socket.on('order:track-driver', async (orderId) => {
    try {
      const order = await prisma.order.findUnique({
        where: { id: orderId },
        include: { driver: { include: { driverProfile: true } } }
      });
      
      if (!order) {
        return socket.emit('error', { message: 'Order not found' });
      }
      
      if (order.customerId !== userId && userRole !== 'ADMIN') {
        return socket.emit('error', { message: 'Not authorized to track this order' });
      }
      
      if (order.driver?.driverProfile?.currentLocation) {
        socket.emit('order:driver-location', {
          orderId,
          driverId: order.driverId,
          driverName: order.driver.fullName,
          location: order.driver.driverProfile.currentLocation,
          timestamp: new Date()
        });
      }
      
    } catch (error) {
      logger.error('Track driver error:', error);
      socket.emit('error', { message: 'Failed to track driver' });
    }
  });
};