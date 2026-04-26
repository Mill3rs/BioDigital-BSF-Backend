const { body, query, param } = require('express-validator');

// Create batch validation
const createBatchValidation = [
  body('name')
    .optional()
    .isLength({ min: 2, max: 100 })
    .withMessage('Batch name must be between 2 and 100 characters'),
  
  body('batchNumber')
    .optional()
    .isString()
    .withMessage('Batch number must be a string')
    .isLength({ max: 50 })
    .withMessage('Batch number cannot exceed 50 characters'),
  
  body('startDate')
    .isISO8601()
    .withMessage('Valid start date is required'),
  
  body('processType')
    .isIn(['COMPOSTING', 'ANAEROBIC_DIGESTION', 'VERMICOMPOSTING', 'BSF_LARVAE_PROCESSING', 'BLACK_SOLDIER_FLY', 'FERMENTATION', 'DRYING', 'PELLETIZING', 'OTHER'])
    .withMessage('Invalid process type'),
  
  body('quantity')
    .isFloat({ gt: 0 })
    .withMessage('Quantity must be greater than 0'),
  
  body('farmId')
    .optional()
    .isUUID()
    .withMessage('Invalid farm ID format'),
  
  body('temperature')
    .optional()
    .isFloat({ min: -10, max: 100 })
    .withMessage('Temperature must be between -10 and 100 degrees Celsius'),
  
  body('materialLevel')
    .optional()
    .isFloat({ min: 0, max: 100 })
    .withMessage('Material level must be between 0 and 100 percent'),
  
  body('moistureContent')
    .optional()
    .isFloat({ min: 0, max: 100 })
    .withMessage('Moisture content must be between 0 and 100 percent')
];

// Update batch validation
const updateBatchValidation = [
  param('id')
    .notEmpty()
    .withMessage('Batch ID is required')
    .isUUID()
    .withMessage('Invalid batch ID format'),
  
  body('name')
    .optional()
    .isLength({ min: 2, max: 100 })
    .withMessage('Batch name must be between 2 and 100 characters'),
  
  body('status')
    .optional()
    .isIn(['PLANNED', 'PENDING', 'ACTIVE', 'PAUSED', 'COMPLETED', 'FAILED', 'CANCELLED'])
    .withMessage('Invalid batch status'),
  
  body('temperature')
    .optional()
    .isFloat({ min: -10, max: 100 })
    .withMessage('Temperature must be between -10 and 100 degrees Celsius'),
  
  body('materialLevel')
    .optional()
    .isFloat({ min: 0, max: 100 })
    .withMessage('Material level must be between 0 and 100 percent'),
  
  body('moistureContent')
    .optional()
    .isFloat({ min: 0, max: 100 })
    .withMessage('Moisture content must be between 0 and 100 percent'),
  
  body('phLevel')
    .optional()
    .isFloat({ min: 0, max: 14 })
    .withMessage('pH level must be between 0 and 14'),
  
  body('notes')
    .optional()
    .isLength({ max: 500 })
    .withMessage('Notes cannot exceed 500 characters')
];

// Get batches validation
const getBatchesValidation = [
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
    .isIn(['PLANNED', 'PENDING', 'ACTIVE', 'PAUSED', 'COMPLETED', 'FAILED', 'CANCELLED'])
    .withMessage('Invalid batch status')
];

// Get batch by ID validation
const getBatchByIdValidation = [
  param('id')
    .notEmpty()
    .withMessage('Batch ID is required')
    .isUUID()
    .withMessage('Invalid batch ID format')
];

// Add waste to batch validation
const addWasteToBatchValidation = [
  param('id')
    .notEmpty()
    .withMessage('Batch ID is required')
    .isUUID()
    .withMessage('Invalid batch ID format'),
  
  body('wasteRecordIds')
    .isArray({ min: 1 })
    .withMessage('At least one waste record ID is required'),
  
  body('wasteRecordIds.*')
    .isUUID()
    .withMessage('Invalid waste record ID format')
];

// Record output validation
const recordOutputValidation = [
  param('id')
    .notEmpty()
    .withMessage('Batch ID is required')
    .isUUID()
    .withMessage('Invalid batch ID format'),
  
  body('liquidOutput')
    .optional()
    .isFloat({ min: 0 })
    .withMessage('Liquid output must be a positive number'),
  
  body('fertilizerOutput')
    .optional()
    .isFloat({ min: 0 })
    .withMessage('Fertilizer output must be a positive number'),
  
  body('gasOutput')
    .optional()
    .isFloat({ min: 0 })
    .withMessage('Gas output must be a positive number'),
  
  body('conversionRate')
    .optional()
    .isFloat({ min: 0, max: 100 })
    .withMessage('Conversion rate must be between 0 and 100 percent'),
  
  body('processingEfficiency')
    .optional()
    .isFloat({ min: 0, max: 100 })
    .withMessage('Processing efficiency must be between 0 and 100 percent')
];

// Add quality check validation
const addQualityCheckValidation = [
  param('id')
    .notEmpty()
    .withMessage('Batch ID is required')
    .isUUID()
    .withMessage('Invalid batch ID format'),
  
  body('checkType')
    .isIn(['TEMPERATURE', 'PH', 'MOISTURE', 'NUTRIENT_CONTENT', 'PATHOGEN_TEST', 'HEAVY_METAL', 'ODOR', 'APPEARANCE', 'OTHER'])
    .withMessage('Invalid check type'),
  
  body('parameter')
    .notEmpty()
    .withMessage('Parameter name is required')
    .isLength({ max: 100 })
    .withMessage('Parameter name cannot exceed 100 characters'),
  
  body('value')
    .isFloat()
    .withMessage('Value must be a number'),
  
  body('unit')
    .optional()
    .isString()
    .withMessage('Unit must be a string'),
  
  body('minThreshold')
    .optional()
    .isFloat()
    .withMessage('Minimum threshold must be a number'),
  
  body('maxThreshold')
    .optional()
    .isFloat()
    .withMessage('Maximum threshold must be a number'),
  
  body('notes')
    .optional()
    .isLength({ max: 500 })
    .withMessage('Notes cannot exceed 500 characters')
];

// Delete batch validation
const deleteBatchValidation = [
  param('id')
    .notEmpty()
    .withMessage('Batch ID is required')
    .isUUID()
    .withMessage('Invalid batch ID format')
];

module.exports = {
  createBatchValidation,
  updateBatchValidation,
  getBatchesValidation,
  getBatchByIdValidation,
  addWasteToBatchValidation,
  recordOutputValidation,
  addQualityCheckValidation,
  deleteBatchValidation
};