const { body, query, param } = require('express-validator');

// Create product validation
const createProductValidation = [
  body('name')
    .notEmpty()
    .withMessage('Product name is required')
    .isLength({ min: 2, max: 100 })
    .withMessage('Product name must be between 2 and 100 characters'),
  
  body('description')
    .optional()
    .isLength({ max: 2000 })
    .withMessage('Description cannot exceed 2000 characters'),
  
  body('shortDescription')
    .optional()
    .isLength({ max: 200 })
    .withMessage('Short description cannot exceed 200 characters'),
  
  body('category')
    .isIn(['ORGANIC_FERTILIZER', 'PROTEIN_FEED', 'INSECT_OIL', 'SOIL_CONDITIONER', 'DRIED_LARVAE', 'COMPOST', 'LIQUID_FERTILIZER', 'BIOCHAR', 'OTHER'])
    .withMessage('Invalid product category'),
  
  body('images')
    .optional()
    .isArray()
    .withMessage('Images must be an array'),
  
  body('images.*')
    .optional()
    .isURL()
    .withMessage('Each image must be a valid URL'),
  
  body('tags')
    .optional()
    .isArray()
    .withMessage('Tags must be an array'),
  
  body('tags.*')
    .optional()
    .isString()
    .withMessage('Each tag must be a string'),
  
  body('farmId')
    .optional()
    .isUUID()
    .withMessage('Invalid farm ID format'),
  
  body('variants')
    .isArray({ min: 1 })
    .withMessage('At least one product variant is required'),
  
  body('variants.*.name')
    .notEmpty()
    .withMessage('Variant name is required')
    .isLength({ max: 100 })
    .withMessage('Variant name cannot exceed 100 characters'),
  
  body('variants.*.sku')
    .optional()
    .isString()
    .withMessage('SKU must be a string')
    .isLength({ max: 50 })
    .withMessage('SKU cannot exceed 50 characters'),
  
  body('variants.*.quantity')
    .isInt({ min: 0 })
    .withMessage('Quantity must be a non-negative integer'),
  
  body('variants.*.price')
    .isFloat({ min: 0 })
    .withMessage('Price must be a non-negative number'),
  
  body('variants.*.comparePrice')
    .optional()
    .isFloat({ min: 0 })
    .withMessage('Compare price must be a non-negative number'),
  
  body('variants.*.cost')
    .optional()
    .isFloat({ min: 0 })
    .withMessage('Cost must be a non-negative number'),
  
  body('variants.*.unitType')
    .notEmpty()
    .withMessage('Unit type is required')
    .isIn(['kg', 'g', 'bag', 'box', 'liter', 'piece', 'pack'])
    .withMessage('Invalid unit type'),
  
  body('variants.*.unitValue')
    .optional()
    .isFloat({ min: 0 })
    .withMessage('Unit value must be a positive number'),
  
  body('variants.*.minOrderQuantity')
    .optional()
    .isInt({ min: 1 })
    .withMessage('Minimum order quantity must be at least 1'),
  
  body('variants.*.weight')
    .optional()
    .isFloat({ min: 0 })
    .withMessage('Weight must be a positive number')
];

// Update product validation
const updateProductValidation = [
  param('id')
    .notEmpty()
    .withMessage('Product ID is required')
    .isUUID()
    .withMessage('Invalid product ID format'),
  
  body('name')
    .optional()
    .isLength({ min: 2, max: 100 })
    .withMessage('Product name must be between 2 and 100 characters'),
  
  body('description')
    .optional()
    .isLength({ max: 2000 })
    .withMessage('Description cannot exceed 2000 characters'),
  
  body('category')
    .optional()
    .isIn(['ORGANIC_FERTILIZER', 'PROTEIN_FEED', 'INSECT_OIL', 'SOIL_CONDITIONER', 'DRIED_LARVAE', 'COMPOST', 'LIQUID_FERTILIZER', 'BIOCHAR', 'OTHER'])
    .withMessage('Invalid product category'),
  
  body('status')
    .optional()
    .isIn(['ACTIVE', 'INACTIVE', 'OUT_OF_STOCK', 'DISCONTINUED'])
    .withMessage('Invalid product status'),
  
  body('featured')
    .optional()
    .isBoolean()
    .withMessage('Featured must be a boolean')
];

// Get products validation
const getProductsValidation = [
  query('page')
    .optional()
    .isInt({ min: 1 })
    .withMessage('Page must be a positive integer'),
  
  query('limit')
    .optional()
    .isInt({ min: 1, max: 100 })
    .withMessage('Limit must be between 1 and 100'),
  
  query('category')
    .optional()
    .isIn(['ORGANIC_FERTILIZER', 'PROTEIN_FEED', 'INSECT_OIL', 'SOIL_CONDITIONER', 'DRIED_LARVAE', 'COMPOST', 'LIQUID_FERTILIZER', 'BIOCHAR', 'OTHER'])
    .withMessage('Invalid product category'),
  
  query('status')
    .optional()
    .isIn(['ACTIVE', 'INACTIVE', 'OUT_OF_STOCK', 'DISCONTINUED'])
    .withMessage('Invalid product status'),
  
  query('farmId')
    .optional()
    .isUUID()
    .withMessage('Invalid farm ID format'),
  
  query('minPrice')
    .optional()
    .isFloat({ min: 0 })
    .withMessage('Minimum price must be a positive number'),
  
  query('maxPrice')
    .optional()
    .isFloat({ min: 0 })
    .withMessage('Maximum price must be a positive number'),
  
  query('search')
    .optional()
    .isString()
    .withMessage('Search query must be a string')
];

// Get product by ID validation
const getProductByIdValidation = [
  param('id')
    .notEmpty()
    .withMessage('Product ID is required')
    .isUUID()
    .withMessage('Invalid product ID format')
];

// Delete product validation
const deleteProductValidation = [
  param('id')
    .notEmpty()
    .withMessage('Product ID is required')
    .isUUID()
    .withMessage('Invalid product ID format')
];

// Add variant validation
const addVariantValidation = [
  param('id')
    .notEmpty()
    .withMessage('Product ID is required')
    .isUUID()
    .withMessage('Invalid product ID format'),
  
  body('name')
    .notEmpty()
    .withMessage('Variant name is required')
    .isLength({ max: 100 })
    .withMessage('Variant name cannot exceed 100 characters'),
  
  body('sku')
    .optional()
    .isString()
    .withMessage('SKU must be a string')
    .isLength({ max: 50 })
    .withMessage('SKU cannot exceed 50 characters'),
  
  body('quantity')
    .isInt({ min: 0 })
    .withMessage('Quantity must be a non-negative integer'),
  
  body('price')
    .isFloat({ min: 0 })
    .withMessage('Price must be a non-negative number'),
  
  body('comparePrice')
    .optional()
    .isFloat({ min: 0 })
    .withMessage('Compare price must be a non-negative number'),
  
  body('unitType')
    .notEmpty()
    .withMessage('Unit type is required')
    .isIn(['kg', 'g', 'bag', 'box', 'liter', 'piece', 'pack'])
    .withMessage('Invalid unit type'),
  
  body('minOrderQuantity')
    .optional()
    .isInt({ min: 1 })
    .withMessage('Minimum order quantity must be at least 1')
];

// Update variant validation
const updateVariantValidation = [
  param('variantId')
    .notEmpty()
    .withMessage('Variant ID is required')
    .isUUID()
    .withMessage('Invalid variant ID format'),
  
  body('name')
    .optional()
    .isLength({ max: 100 })
    .withMessage('Variant name cannot exceed 100 characters'),
  
  body('quantity')
    .optional()
    .isInt({ min: 0 })
    .withMessage('Quantity must be a non-negative integer'),
  
  body('price')
    .optional()
    .isFloat({ min: 0 })
    .withMessage('Price must be a non-negative number'),
  
  body('isActive')
    .optional()
    .isBoolean()
    .withMessage('isActive must be a boolean')
];

// Delete variant validation
const deleteVariantValidation = [
  param('variantId')
    .notEmpty()
    .withMessage('Variant ID is required')
    .isUUID()
    .withMessage('Invalid variant ID format')
];

// Add review validation
const addReviewValidation = [
  param('id')
    .notEmpty()
    .withMessage('Product ID is required')
    .isUUID()
    .withMessage('Invalid product ID format'),
  
  body('rating')
    .isInt({ min: 1, max: 5 })
    .withMessage('Rating must be between 1 and 5'),
  
  body('title')
    .optional()
    .isLength({ max: 100 })
    .withMessage('Title cannot exceed 100 characters'),
  
  body('comment')
    .optional()
    .isLength({ max: 1000 })
    .withMessage('Comment cannot exceed 1000 characters'),
  
  body('images')
    .optional()
    .isArray()
    .withMessage('Images must be an array'),
  
  body('images.*')
    .optional()
    .isURL()
    .withMessage('Each image must be a valid URL')
];

module.exports = {
  createProductValidation,
  updateProductValidation,
  getProductsValidation,
  getProductByIdValidation,
  deleteProductValidation,
  addVariantValidation,
  updateVariantValidation,
  deleteVariantValidation,
  addReviewValidation
};