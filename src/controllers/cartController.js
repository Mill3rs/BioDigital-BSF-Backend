const { prisma } = require('../config/database');
const { AppError } = require('../middleware/errorHandler');

class CartController {
  // Get cart
  async getCart(req, res, next) {
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
      const tax = subtotal * 0.15;
      const total = subtotal + tax;
      
      res.json({
        success: true,
        data: {
          ...cart,
          subtotal,
          tax,
          total
        }
      });
    } catch (error) {
      next(error);
    }
  }

  // Add to cart
  async addToCart(req, res, next) {
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
        const newQuantity = existingItem.quantity + quantity;
        if (variant.quantity < newQuantity) {
          throw new AppError(`Cannot add more. Only ${variant.quantity} items available`, 400);
        }
        
        cartItem = await prisma.cartItem.update({
          where: { id: existingItem.id },
          data: { quantity: newQuantity }
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
      
      res.status(201).json({
        success: true,
        message: 'Item added to cart',
        data: cartItem
      });
    } catch (error) {
      next(error);
    }
  }

  // Update cart item
  async updateCartItem(req, res, next) {
    try {
      const { itemId } = req.params;
      const { quantity } = req.body;
      
      const cartItem = await prisma.cartItem.findUnique({
        where: { id: itemId },
        include: { 
          cart: true,
          variant: true
        }
      });
      
      if (!cartItem) {
        throw new AppError('Cart item not found', 404);
      }
      
      if (cartItem.cart.userId !== req.user.id) {
        throw new AppError('Unauthorized', 403);
      }
      
      if (cartItem.variant.quantity < quantity) {
        throw new AppError(`Only ${cartItem.variant.quantity} items available`, 400);
      }
      
      const updatedItem = await prisma.cartItem.update({
        where: { id: itemId },
        data: { quantity }
      });
      
      res.json({
        success: true,
        message: 'Cart item updated',
        data: updatedItem
      });
    } catch (error) {
      next(error);
    }
  }

  // Remove from cart
  async removeFromCart(req, res, next) {
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
      
      res.json({
        success: true,
        message: 'Item removed from cart'
      });
    } catch (error) {
      next(error);
    }
  }

  // Clear cart
  async clearCart(req, res, next) {
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
  }

  // Get cart count
  async getCartCount(req, res, next) {
    try {
      const cart = await prisma.cart.findUnique({
        where: { userId: req.user.id },
        include: {
          items: {
            select: { quantity: true }
          }
        }
      });
      
      const count = cart?.items.reduce((sum, item) => sum + item.quantity, 0) || 0;
      
      res.json({
        success: true,
        data: { count }
      });
    } catch (error) {
      next(error);
    }
  }
}

module.exports = new CartController();