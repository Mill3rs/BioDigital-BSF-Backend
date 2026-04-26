const { body, query, param } = require('express-validator');

// Create waste record validation
const createWasteValidation = [
  body('sourceName')
    .notEmpty()
    .withMessage('Source name is required')
    .isLength({ min: 2, max: 100 })
    .withMessage('Source name must be between 2 and 100 characters'),
  
  body('sourceType')
    .isIn(['AGRICULTURAL', 'FOOD_WASTE', 'MARKET_WASTE', 'HOUSEHOLD', 'INDUSTRIAL', 'MUNICIPAL', 'COMMERCIAL', 'OTHER'])
    .withMessage('Invalid source type'),
  
  body('quantity')
    .isFloat({ gt: 0 })
    .withMessage('Quantity must be greater than 0')
    .custom((value) => {
      if (value > 1000000) {
        throw new Error('Quantity cannot exceed 1,000,000');
      }
      return true;
    }),
  
  body('unit')
    .optional()
    .isIn(['kg', 'g', 'tons', 'liters'])
    .withMessage('Invalid unit'),
  
  body('date')
    .isISO8601()
    .withMessage('Valid date is required')
    .custom((value) => {
      const date = new Date(value);
      if (date > new Date()) {
        throw new Error('Date cannot be in the future');
      }
      return true;
    }),
  
  body('description')
    .optional()
    .isLength({ max: 500 })
    .withMessage('Description cannot exceed 500 characters'),
  
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
  
  body('farmId')
    .optional()
    .isUUID()
    .withMessage('Invalid farm ID format'),
  
  body('supplierId')
    .optional()
    .isUUID()
    .withMessage('Invalid supplier ID format'),
  
  body('images')
    .optional()
    .isArray()
    .withMessage('Images must be an array'),
  
  body('images.*')
    .optional()
    .isURL()
    .withMessage('Each image must be a valid URL')
];

// Update waste record validation
const updateWasteValidation = [
  param('id')
    .notEmpty()
    .withMessage('Waste record ID is required')
    .isUUID()
    .withMessage('Invalid waste record ID format'),
  
  body('sourceName')
    .optional()
    .isLength({ min: 2, max: 100 })
    .withMessage('Source name must be between 2 and 100 characters'),
  
  body('sourceType')
    .optional()
    .isIn(['AGRICULTURAL', 'FOOD_WASTE', 'MARKET_WASTE', 'HOUSEHOLD', 'INDUSTRIAL', 'MUNICIPAL', 'COMMERCIAL', 'OTHER'])
    .withMessage('Invalid source type'),
  
  body('quantity')
    .optional()
    .isFloat({ gt: 0 })
    .withMessage('Quantity must be greater than 0'),
  
  body('status')
    .optional()
    .isIn(['PENDING', 'SCHEDULED', 'COLLECTED', 'PROCESSING', 'PROCESSED', 'CANCELLED', 'REJECTED'])
    .withMessage('Invalid status'),
  
  body('description')
    .optional()
    .isLength({ max: 500 })
    .withMessage('Description cannot exceed 500 characters')
];

// Get waste records validation
const getWasteRecordsValidation = [
  query('page')
    .optional()
    .isInt({ min: 1 })
    .withMessage('Page must be a positive integer'),
  
  query('limit')
    .optional()
    .isInt({ min: 1, max: 100 })
    .withMessage('Limit must be between 1 and 100'),
  
  query('farmId')
    .optional()
    .isUUID()
    .withMessage('Invalid farm ID format'),
  
  query('status')
    .optional()
    .isIn(['PENDING', 'SCHEDULED', 'COLLECTED', 'PROCESSING', 'PROCESSED', 'CANCELLED', 'REJECTED'])
    .withMessage('Invalid status'),
  
  query('sourceType')
    .optional()
    .isIn(['AGRICULTURAL', 'FOOD_WASTE', 'MARKET_WASTE', 'HOUSEHOLD', 'INDUSTRIAL', 'MUNICIPAL', 'COMMERCIAL', 'OTHER'])
    .withMessage('Invalid source type'),
  
  query('startDate')
    .optional()
    .isISO8601()
    .withMessage('Invalid start date format'),
  
  query('endDate')
    .optional()
    .isISO8601()
    .withMessage('Invalid end date format')
];

// Get waste record by ID validation
const getWasteRecordByIdValidation = [
  param('id')
    .notEmpty()
    .withMessage('Waste record ID is required')
    .isUUID()
    .withMessage('Invalid waste record ID format')
];

// Delete waste record validation
const deleteWasteRecordValidation = [
  param('id')
    .notEmpty()
    .withMessage('Waste record ID is required')
    .isUUID()
    .withMessage('Invalid waste record ID format')
];

// Assign driver validation
const assignDriverValidation = [
  param('id')
    .notEmpty()
    .withMessage('Waste record ID is required')
    .isUUID()
    .withMessage('Invalid waste record ID format'),
  
  body('driverId')
    .notEmpty()
    .withMessage('Driver ID is required')
    .isUUID()
    .withMessage('Invalid driver ID format')
];

// Mark as collected validation
const markAsCollectedValidation = [
  param('id')
    .notEmpty()
    .withMessage('Waste record ID is required')
    .isUUID()
    .withMessage('Invalid waste record ID format'),
  
  body('notes')
    .optional()
    .isLength({ max: 500 })
    .withMessage('Notes cannot exceed 500 characters'),
  
  body('images')
    .optional()
    .isArray()
    .withMessage('Images must be an array'),
  
  body('quantity')
    .optional()
    .isFloat({ gt: 0 })
    .withMessage('Collected quantity must be greater than 0')
];

module.exports = {
  createWasteValidation,
  updateWasteValidation,
  getWasteRecordsValidation,
  getWasteRecordByIdValidation,
  deleteWasteRecordValidation,
  assignDriverValidation,
  markAsCollectedValidation
};