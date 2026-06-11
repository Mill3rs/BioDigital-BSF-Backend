const express = require('express');
const { body, validationResult } = require('express-validator');
const { prisma } = require('../config/database');
const { authenticate } = require('../middleware/auth');
const { AppError } = require('../middleware/errorHandler');

const router = express.Router();

// Helper: fetch full cart for a user (with subtotal/total computed)
const getFullCart = async (userId) => {
  let cart = await prisma.cart.findUnique({
    where: { userId },
    include: {
      items: {
        include: {
          variant: {
            include: {
              product: { select: { id: true, name: true, images: true, slug: true } }
            }
          }
        }
      }
    }
  });
  if (!cart) {
    cart = await prisma.cart.create({
      data: { userId },
      include: { items: true }
    });
  }
  const subtotal = cart.items.reduce((sum, item) => sum + (item.variant?.price ?? 0) * item.quantity, 0);
  return { ...cart, subtotal, total: subtotal };
};

// Get cart
router.get('/', authenticate, async (req, res, next) => {
  try {
    let cart = await prisma.cart.findUnique({
      where: { userId: req.user.id },
      include: {
        items: {
          include: {
            variant: {
              include: {
                product: {
                  select: { id: true, name: true, images: true, slug: true }
                }
              }
            }
          }
        }
      }
    });
    
    if (!cart) {
      cart = await prisma.cart.create({
        data: { userId: req.user.id },
        include: { items: true }
      });
    }
    
    const subtotal = cart.items.reduce((sum, item) => sum + (item.variant.price * item.quantity), 0);
    
    res.json({
      success: true,
      data: {
        ...cart,
        subtotal,
        total: subtotal
      }
    });
  } catch (error) {
    next(error);
  }
});

// Add to cart
router.post('/add', authenticate, [
  body('variantId').notEmpty().withMessage('Variant ID is required'),
  body('quantity').isInt({ min: 1 }).withMessage('Quantity must be at least 1')
], async (req, res, next) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({ success: false, errors: errors.array() });
  }

  try {
    const { variantId, quantity } = req.body;
    
    const variant = await prisma.productVariant.findUnique({
      where: { id: variantId }
    });
    
    if (!variant) {
      throw new AppError('Product variant not found', 404);
    }
    
    if (variant.quantity < quantity) {
      throw new AppError(`Only ${variant.quantity} items available in stock`, 400);
    }
    
    let cart = await prisma.cart.findUnique({
      where: { userId: req.user.id }
    });
    
    if (!cart) {
      cart = await prisma.cart.create({
        data: { userId: req.user.id }
      });
    }
    
    const existingItem = await prisma.cartItem.findFirst({
      where: {
        cartId: cart.id,
        variantId
      }
    });
    
    let cartItem;
    if (existingItem) {
      cartItem = await prisma.cartItem.update({
        where: { id: existingItem.id },
        data: { quantity: existingItem.quantity + quantity }
      });
    } else {
      cartItem = await prisma.cartItem.create({
        data: {
          cartId: cart.id,
          variantId,
          quantity
        }
      });
    }
    
    const updatedCart = await getFullCart(req.user.id);
    res.status(201).json({
      success: true,
      message: 'Item added to cart',
      data: updatedCart
    });
  } catch (error) {
    next(error);
  }
});

// Update cart item
router.put('/update/:itemId', authenticate, [
  body('quantity').isInt({ min: 1 }).withMessage('Quantity must be at least 1')
], async (req, res, next) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({ success: false, errors: errors.array() });
  }

  try {
    const { itemId } = req.params;
    const { quantity } = req.body;
    
    const cartItem = await prisma.cartItem.findUnique({
      where: { id: itemId },
      include: { cart: true }
    });
    
    if (!cartItem) {
      throw new AppError('Cart item not found', 404);
    }
    
    if (cartItem.cart.userId !== req.user.id) {
      throw new AppError('Unauthorized', 403);
    }
    
    await prisma.cartItem.update({
      where: { id: itemId },
      data: { quantity }
    });

    const updatedCart = await getFullCart(req.user.id);
    res.json({
      success: true,
      message: 'Cart item updated',
      data: updatedCart
    });
  } catch (error) {
    next(error);
  }
});

// Remove from cart
router.delete('/remove/:itemId', authenticate, async (req, res, next) => {
  try {
    const { itemId } = req.params;
    
    const cartItem = await prisma.cartItem.findUnique({
      where: { id: itemId },
      include: { cart: true }
    });
    
    if (!cartItem) {
      throw new AppError('Cart item not found', 404);
    }
    
    if (cartItem.cart.userId !== req.user.id) {
      throw new AppError('Unauthorized', 403);
    }
    
    await prisma.cartItem.delete({ where: { id: itemId } });

    const updatedCart = await getFullCart(req.user.id);
    res.json({
      success: true,
      message: 'Item removed from cart',
      data: updatedCart
    });
  } catch (error) {
    next(error);
  }
});

// Clear cart
router.delete('/clear', authenticate, async (req, res, next) => {
  try {
    const cart = await prisma.cart.findUnique({
      where: { userId: req.user.id }
    });
    
    if (cart) {
      await prisma.cartItem.deleteMany({
        where: { cartId: cart.id }
      });
    }
    
    res.json({
      success: true,
      message: 'Cart cleared successfully'
    });
  } catch (error) {
    next(error);
  }
});

module.exports = router;