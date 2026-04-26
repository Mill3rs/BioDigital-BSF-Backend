const { body, query, param } = require('express-validator');

// Create order validation
const createOrderValidation = [
  body('items')
    .isArray({ min: 1 })
    .withMessage('At least one item is required'),
  
  body('items.*.variantId')
    .notEmpty()
    .withMessage('Variant ID is required for each item')
    .isUUID()
    .withMessage('Invalid variant ID format'),
  
  body('items.*.quantity')
    .isInt({ min: 1 })
    .withMessage('Quantity must be at least 1 for each item'),
  
  body('deliveryAddress')
    .isObject()
    .withMessage('Delivery address is required'),
  
  body('deliveryAddress.street')
    .notEmpty()
    .withMessage('Street address is required')
    .isLength({ max: 200 })
    .withMessage('Street address cannot exceed 200 characters'),
  
  body('deliveryAddress.city')
    .notEmpty()
    .withMessage('City is required')
    .isLength({ max: 100 })
    .withMessage('City cannot exceed 100 characters'),
  
  body('deliveryAddress.region')
    .optional()
    .isLength({ max: 100 })
    .withMessage('Region cannot exceed 100 characters'),
  
  body('deliveryAddress.country')
    .notEmpty()
    .withMessage('Country is required')
    .isLength({ max: 100 })
    .withMessage('Country cannot exceed 100 characters'),
  
  body('deliveryAddress.postalCode')
    .optional()
    .isPostalCode('any')
    .withMessage('Invalid postal code'),
  
  body('deliveryAddress.phone')
    .optional()
    .isMobilePhone()
    .withMessage('Valid phone number is required'),
  
  body('deliveryInstructions')
    .optional()
    .isLength({ max: 500 })
    .withMessage('Delivery instructions cannot exceed 500 characters'),
  
  body('paymentMethod')
    .isIn(['CASH_ON_DELIVERY', 'MOBILE_MONEY', 'BANK_TRANSFER', 'CREDIT_CARD', 'DEBIT_CARD', 'PAYPAL', 'STRIPE', 'OTHER'])
    .withMessage('Invalid payment method'),
  
  body('specialInstructions')
    .optional()
    .isLength({ max: 500 })
    .withMessage('Special instructions cannot exceed 500 characters')
];

// Update order validation
const updateOrderValidation = [
  param('id')
    .notEmpty()
    .withMessage('Order ID is required')
    .isUUID()
    .withMessage('Invalid order ID format'),
  
  body('deliveryAddress')
    .optional()
    .isObject()
    .withMessage('Delivery address must be an object'),
  
  body('deliveryInstructions')
    .optional()
    .isLength({ max: 500 })
    .withMessage('Delivery instructions cannot exceed 500 characters'),
  
  body('specialInstructions')
    .optional()
    .isLength({ max: 500 })
    .withMessage('Special instructions cannot exceed 500 characters')
];

// Get orders validation
const getOrdersValidation = [
  query('page')
    .optional()
    .isInt({ min: 1 })
    .withMessage('Page must be a positive integer'),
  
  query('limit')
    .optional()
    .isInt({ min: 1, max: 100 })
    .withMessage('Limit must be between 1 and 100'),
  
  query('status')
    .optional()
    .isIn(['PENDING', 'CONFIRMED', 'PROCESSING', 'READY_FOR_PICKUP', 'SHIPPED', 'OUT_FOR_DELIVERY', 'DELIVERED', 'COMPLETED', 'CANCELLED', 'REFUNDED', 'ON_HOLD'])
    .withMessage('Invalid order status'),
  
  query('startDate')
    .optional()
    .isISO8601()
    .withMessage('Invalid start date format'),
  
  query('endDate')
    .optional()
    .isISO8601()
    .withMessage('Invalid end date format')
];

// Get order by ID validation
const getOrderByIdValidation = [
  param('id')
    .notEmpty()
    .withMessage('Order ID is required')
    .isUUID()
    .withMessage('Invalid order ID format')
];

// Cancel order validation
const cancelOrderValidation = [
  param('id')
    .notEmpty()
    .withMessage('Order ID is required')
    .isUUID()
    .withMessage('Invalid order ID format'),
  
  body('cancellationReason')
    .optional()
    .isLength({ max: 500 })
    .withMessage('Cancellation reason cannot exceed 500 characters')
];

// Assign driver validation
const assignDriverValidation = [
  param('id')
    .notEmpty()
    .withMessage('Order ID is required')
    .isUUID()
    .withMessage('Invalid order ID format'),
  
  body('driverId')
    .notEmpty()
    .withMessage('Driver ID is required')
    .isUUID()
    .withMessage('Invalid driver ID format')
];

// Update order status validation
const updateOrderStatusValidation = [
  param('id')
    .notEmpty()
    .withMessage('Order ID is required')
    .isUUID()
    .withMessage('Invalid order ID format'),
  
  body('status')
    .isIn(['CONFIRMED', 'PROCESSING', 'READY_FOR_PICKUP', 'SHIPPED', 'OUT_FOR_DELIVERY', 'DELIVERED', 'COMPLETED'])
    .withMessage('Invalid order status'),
  
  body('location')
    .optional()
    .isObject()
    .withMessage('Location must be an object'),
  
  body('location.lat')
    .optional()
    .isFloat({ min: -90, max: 90 })
    .withMessage('Invalid latitude'),
  
  body('location.lng')
    .optional()
    .isFloat({ min: -180, max: 180 })
    .withMessage('Invalid longitude'),
  
  body('notes')
    .optional()
    .isLength({ max: 500 })
    .withMessage('Notes cannot exceed 500 characters')
];

// Add to cart validation
const addToCartValidation = [
  body('variantId')
    .notEmpty()
    .withMessage('Variant ID is required')
    .isUUID()
    .withMessage('Invalid variant ID format'),
  
  body('quantity')
    .isInt({ min: 1, max: 999 })
    .withMessage('Quantity must be between 1 and 999')
];

// Update cart item validation
const updateCartItemValidation = [
  param('itemId')
    .notEmpty()
    .withMessage('Cart item ID is required')
    .isUUID()
    .withMessage('Invalid cart item ID format'),
  
  body('quantity')
    .isInt({ min: 1, max: 999 })
    .withMessage('Quantity must be between 1 and 999')
];

// Remove from cart validation
const removeFromCartValidation = [
  param('itemId')
    .notEmpty()
    .withMessage('Cart item ID is required')
    .isUUID()
    .withMessage('Invalid cart item ID format')
];

// Apply coupon validation
const applyCouponValidation = [
  body('couponCode')
    .notEmpty()
    .withMessage('Coupon code is required')
    .isLength({ min: 3, max: 50 })
    .withMessage('Coupon code must be between 3 and 50 characters')
];

module.exports = {
  createOrderValidation,
  updateOrderValidation,
  getOrdersValidation,
  getOrderByIdValidation,
  cancelOrderValidation,
  assignDriverValidation,
  updateOrderStatusValidation,
  addToCartValidation,
  updateCartItemValidation,
  removeFromCartValidation,
  applyCouponValidation
};