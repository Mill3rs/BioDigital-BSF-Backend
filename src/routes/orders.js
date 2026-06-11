const express = require('express');
const { body, validationResult } = require('express-validator');
const { prisma } = require('../config/database');
const { authenticate, authorize } = require('../middleware/auth');
const { AppError } = require('../middleware/errorHandler');
const { generateOrderNumber } = require('../utils/helpers');
const emailService = require('../services/emailService');
const notificationService = require('../services/notificationService');

const router = express.Router();

// Get orders
router.get('/', authenticate, async (req, res, next) => {
  try {
    const { status, page = 1, limit = 20 } = req.query;
    const where = {};
    
    if (status) where.status = status;
    
    if (req.user.role === 'BUYER') {
      where.customerId = req.user.id;
    } else if (req.user.role === 'DRIVER') {
      where.driverId = req.user.id;
    } else if (req.user.role === 'MANAGER') {
      where.farmId = req.user.farmId;
    }
    
    const skip = (page - 1) * limit;
    
    const [orders, total] = await Promise.all([
      prisma.order.findMany({
        where,
        include: {
          customer: { select: { id: true, fullName: true, email: true, phoneNumber: true } },
          driver: { select: { id: true, fullName: true, phoneNumber: true } },
          farm: { select: { id: true, name: true } },
          items: {
            include: {
              variant: {
                include: { product: { select: { id: true, name: true, images: true } } }
              }
            }
          },
          shipment: true,
          invoice: true
        },
        orderBy: { createdAt: 'desc' },
        skip,
        take: parseInt(limit)
      }),
      prisma.order.count({ where })
    ]);
    
    res.json({
      success: true,
      data: orders,
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

// Create order
router.post('/', authenticate, [
  body('items').isArray().withMessage('Items must be an array'),
  body('items.*.variantId').notEmpty().withMessage('Variant ID is required'),
  body('items.*.quantity').isInt({ min: 1 }).withMessage('Quantity must be at least 1'),
  body('deliveryAddress').isObject().withMessage('Delivery address is required'),
  body('paymentMethod').isIn(['CASH_ON_DELIVERY', 'MOBILE_MONEY', 'BANK_TRANSFER', 'CREDIT_CARD', 'DEBIT_CARD', 'PAYPAL', 'STRIPE', 'OTHER'])
], async (req, res, next) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({ success: false, errors: errors.array() });
  }

  try {
    const { items, deliveryAddress, deliveryInstructions, paymentMethod, specialInstructions } = req.body;
    
    let subtotal = 0;
    const orderItems = [];
    
    for (const item of items) {
      const variant = await prisma.productVariant.findUnique({
        where: { id: item.variantId },
        include: { product: true }
      });
      
      if (!variant) {
        throw new AppError(`Product variant ${item.variantId} not found`, 404);
      }
      
      if (variant.quantity < item.quantity) {
        throw new AppError(`Insufficient stock for ${variant.name}. Available: ${variant.quantity}`, 400);
      }
      
      const itemSubtotal = variant.price * item.quantity;
      subtotal += itemSubtotal;
      
      orderItems.push({
        variantId: item.variantId,
        quantity: item.quantity,
        price: variant.price,
        subtotal: itemSubtotal
      });
    }
    
    const shippingCost = 0;
    const tax = subtotal * 0.15;
    const total = subtotal + shippingCost + tax;
    
    const order = await prisma.order.create({
      data: {
        orderNumber: generateOrderNumber(),
        customerId: req.user.id,
        subtotal,
        shippingCost,
        tax,
        total,
        paymentMethod,
        deliveryAddress,
        deliveryInstructions,
        specialInstructions,
        status: 'PENDING',
        items: { create: orderItems }
      },
      include: {
        items: {
          include: {
            variant: { include: { product: true } }
          }
        }
      }
    });
    
    for (const item of items) {
      await prisma.productVariant.update({
        where: { id: item.variantId },
        data: { quantity: { decrement: item.quantity } }
      });
    }
    
    // Clear cart
    const cart = await prisma.cart.findUnique({
      where: { userId: req.user.id }
    });
    if (cart) {
      await prisma.cartItem.deleteMany({
        where: { cartId: cart.id }
      });
    }
    
    res.status(201).json({
      success: true,
      message: 'Order created successfully',
      data: order
    });
  } catch (error) {
    next(error);
  }
});

// Get order by ID
router.get('/:id', authenticate, async (req, res, next) => {
  try {
    const order = await prisma.order.findUnique({
      where: { id: req.params.id },
      include: {
        customer: { select: { id: true, fullName: true, email: true, phoneNumber: true } },
        driver: { select: { id: true, fullName: true, phoneNumber: true, driverProfile: true } },
        farm: true,
        items: {
          include: {
            variant: { include: { product: true } }
          }
        },
        shipment: true,
        invoice: true
      }
    });
    
    if (!order) {
      throw new AppError('Order not found', 404);
    }
    
    if (req.user.role === 'BUYER' && order.customerId !== req.user.id) {
      throw new AppError('Access denied', 403);
    }

    // For COMPLETED orders, attach each item's product review by the buyer
    let responseOrder = order;
    if (order.status === 'COMPLETED') {
      const productIds = order.items.map(i => i.variant.product.id);
      const reviews = await prisma.productReview.findMany({
        where: { userId: order.customerId, productId: { in: productIds } },
        select: { productId: true, rating: true, title: true, comment: true },
      });
      const reviewMap = Object.fromEntries(reviews.map(r => [r.productId, r]));
      responseOrder = {
        ...order,
        items: order.items.map(item => ({
          ...item,
          review: reviewMap[item.variant.product.id] ?? null,
        })),
      };
    }
    
    res.json({ success: true, data: responseOrder });
  } catch (error) {
    next(error);
  }
});

// Update order
router.put('/:id', authenticate, async (req, res, next) => {
  try {
    const order = await prisma.order.findUnique({
      where: { id: req.params.id }
    });
    
    if (!order) {
      throw new AppError('Order not found', 404);
    }
    
    if (order.customerId !== req.user.id && req.user.role !== 'ADMIN') {
      throw new AppError('Access denied', 403);
    }
    
    if (order.status !== 'PENDING') {
      throw new AppError('Cannot update order after it has been processed', 400);
    }
    
    const updatedOrder = await prisma.order.update({
      where: { id: req.params.id },
      data: req.body
    });
    
    res.json({ success: true, data: updatedOrder });
  } catch (error) {
    next(error);
  }
});

// Cancel order
router.post('/:id/cancel', authenticate, async (req, res, next) => {
  try {
    const { id } = req.params;
    const { cancellationReason } = req.body;
    
    const order = await prisma.order.findUnique({
      where: { id },
      include: { items: true }
    });
    
    if (!order) {
      throw new AppError('Order not found', 404);
    }
    
    if (order.customerId !== req.user.id && req.user.role !== 'ADMIN') {
      throw new AppError('Access denied', 403);
    }
    
    if (order.status !== 'PENDING' && order.status !== 'CONFIRMED') {
      throw new AppError('Order cannot be cancelled at this stage', 400);
    }
    
    for (const item of order.items) {
      await prisma.productVariant.update({
        where: { id: item.variantId },
        data: { quantity: { increment: item.quantity } }
      });
    }
    
    const cancelledOrder = await prisma.order.update({
      where: { id },
      data: {
        status: 'CANCELLED',
        cancelledAt: new Date(),
        cancellationReason
      }
    });
    
    res.json({
      success: true,
      message: 'Order cancelled successfully',
      data: cancelledOrder
    });
  } catch (error) {
    next(error);
  }
});

// Assign driver to order (Admin/Manager)
router.post('/:id/assign-driver', authenticate, authorize('ADMIN', 'MANAGER'), [
  body('driverId').notEmpty().withMessage('Driver ID is required')
], async (req, res, next) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({ success: false, errors: errors.array() });
  }

  try {
    const { id } = req.params;
    const { driverId } = req.body;
    
    const driver = await prisma.user.findFirst({
      where: { id: driverId, role: 'DRIVER' }
    });
    
    if (!driver) {
      throw new AppError('Driver not found', 404);
    }
    
    const order = await prisma.order.update({
      where: { id },
      data: {
        driverId,
        status: 'PROCESSING'
      },
      include: {
        driver: { select: { id: true, fullName: true, phoneNumber: true } },
        customer: { select: { id: true, fullName: true, phoneNumber: true } }
      }
    });
    
    res.json({
      success: true,
      message: 'Driver assigned successfully',
      data: order
    });
  } catch (error) {
    next(error);
  }
});

// Update order status
router.post('/:id/update-status', authenticate, [
  body('status').isIn(['CONFIRMED', 'PROCESSING', 'READY_FOR_PICKUP', 'SHIPPED', 'OUT_FOR_DELIVERY', 'DELIVERED', 'COMPLETED'])
], async (req, res, next) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({ success: false, errors: errors.array() });
  }

  try {
    const { id } = req.params;
    const { status, location, notes } = req.body;
    
    const order = await prisma.order.findUnique({
      where: { id }
    });
    
    if (!order) {
      throw new AppError('Order not found', 404);
    }
    
    const updateData = { status };
    if (status === 'DELIVERED') {
      updateData.deliveredAt = new Date();
    }
    
    const updatedOrder = await prisma.order.update({
      where: { id },
      data: updateData
    });
    
    if (location && (status === 'SHIPPED' || status === 'OUT_FOR_DELIVERY')) {
      await prisma.shipment.upsert({
        where: { orderId: id },
        update: {
          currentLocation: location,
          events: { push: { status, location, notes, timestamp: new Date() } }
        },
        create: {
          orderId: id,
          carrier: 'Internal',
          trackingNumber: `TRK-${Date.now()}`,
          currentLocation: location,
          events: [{ status, location, notes, timestamp: new Date() }]
        }
      });
    }
    
    res.json({
      success: true,
      message: `Order status updated to ${status}`,
      data: updatedOrder
    });
  } catch (error) {
    next(error);
  }
});

// Buyer confirms delivery and (optionally) rates the driver
router.post('/:id/confirm-delivery', authenticate, authorize('BUYER'), [
  body('driverRating').optional().isInt({ min: 1, max: 5 }),
  body('driverComment').optional().isString().isLength({ max: 500 }),
], async (req, res, next) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({ success: false, errors: errors.array() });
  }

  try {
    const { id } = req.params;
    const { driverRating, driverComment } = req.body;

    const order = await prisma.order.findUnique({
      where: { id },
      select: { id: true, customerId: true, driverId: true, status: true }
    });

    if (!order) throw new AppError('Order not found', 404);
    if (order.customerId !== req.user.id) throw new AppError('Access denied', 403);
    if (order.status !== 'DELIVERED') {
      throw new AppError('Order must be in DELIVERED status before you can confirm it', 400);
    }

    // Mark order as COMPLETED
    const updatedOrder = await prisma.order.update({
      where: { id },
      data: { status: 'COMPLETED' },
    });

    // Update driver rating if provided
    if (order.driverId && driverRating) {
      const profile = await prisma.driverProfile.findUnique({
        where: { userId: order.driverId },
        select: { rating: true, totalDeliveries: true },
      });

      if (profile) {
        // Rolling average: new = (old * n + new) / (n + 1)
        const n = profile.totalDeliveries || 1;
        const newRating = (profile.rating * n + driverRating) / (n + 1);
        await prisma.driverProfile.update({
          where: { userId: order.driverId },
          data: {
            rating: Math.round(newRating * 10) / 10,
            totalDeliveries: { increment: 1 },
          },
        });
      }

      // Notify driver via in-app notification and email
      const driver = await prisma.user.findUnique({
        where: { id: order.driverId },
        select: { fullName: true, email: true },
      });
      const fullOrder = await prisma.order.findUnique({
        where: { id },
        select: { orderNumber: true },
      });
      if (driver) {
        const stars = '★'.repeat(driverRating) + '☆'.repeat(5 - driverRating);
        const notifMsg = `${stars}  ${driverRating}/5 for Order #${fullOrder?.orderNumber ?? id}${
          driverComment ? ` — "${driverComment}"` : ''
        }`;
        notificationService.createNotification(
          order.driverId,
          'New Delivery Review',
          notifMsg,
          'ORDER_UPDATE',
          { orderId: id, rating: driverRating }
        ).catch(() => {});
        if (driver.email) {
          emailService.sendDriverReviewEmail(driver.email, driver.fullName, {
            rating: driverRating,
            comment: driverComment,
            orderNumber: fullOrder?.orderNumber ?? id,
          }).catch(() => {});
        }
      }
    }

    res.json({
      success: true,
      message: 'Delivery confirmed. Thank you for your feedback!',
      data: updatedOrder,
    });
  } catch (error) {
    next(error);
  }
});

// Get order statistics
router.get('/stats/summary', authenticate, async (req, res, next) => {
  try {
    let where = {};
    
    if (req.user.role === 'BUYER') {
      where.customerId = req.user.id;
    } else if (req.user.role === 'MANAGER') {
      where.farmId = req.user.farmId;
    }
    
    const [totalOrders, completedOrders, totalRevenue, averageOrderValue, ordersByStatus] = await Promise.all([
      prisma.order.count({ where }),
      prisma.order.count({ where: { ...where, status: 'COMPLETED' } }),
      prisma.order.aggregate({ where: { ...where, status: 'COMPLETED' }, _sum: { total: true } }),
      prisma.order.aggregate({ where: { ...where, status: 'COMPLETED' }, _avg: { total: true } }),
      prisma.order.groupBy({ by: ['status'], where, _count: true })
    ]);
    
    const monthlyOrders = await prisma.$queryRaw`
      SELECT 
        DATE_TRUNC('month', created_at) as month,
        COUNT(*) as count,
        SUM(total) as revenue
      FROM orders
      ${where.customerId ? `WHERE customer_id = ${where.customerId}` : ''}
      GROUP BY DATE_TRUNC('month', created_at)
      ORDER BY month DESC
      LIMIT 12
    `;
    
    res.json({
      success: true,
      data: {
        totalOrders,
        completedOrders,
        pendingOrders: ordersByStatus.find(s => s.status === 'PENDING')?._count || 0,
        processingOrders: ordersByStatus.find(s => s.status === 'PROCESSING')?._count || 0,
        shippedOrders: ordersByStatus.find(s => s.status === 'SHIPPED')?._count || 0,
        cancelledOrders: ordersByStatus.find(s => s.status === 'CANCELLED')?._count || 0,
        totalRevenue: totalRevenue._sum.total || 0,
        averageOrderValue: averageOrderValue._avg.total || 0,
        monthlyTrend: monthlyOrders
      }
    });
  } catch (error) {
    next(error);
  }
});

module.exports = router;