const { body, query, param } = require('express-validator');

// Create farm validation
const createFarmValidation = [
  body('name')
    .notEmpty()
    .withMessage('Farm name is required')
    .isLength({ min: 2, max: 100 })
    .withMessage('Farm name must be between 2 and 100 characters'),
  
  body('type')
    .isIn(['FAMILY_FARM', 'PROFESSIONAL_FARM', 'CORPORATE_FARM', 'COOPERATIVE_FARM', 'PERSONAL_FARM', 'COMMUNITY_FARM', 'OTHER'])
    .withMessage('Invalid farm type'),
  
  body('description')
    .optional()
    .isLength({ max: 500 })
    .withMessage('Description cannot exceed 500 characters'),
  
  body('area')
    .optional()
    .isFloat({ min: 0 })
    .withMessage('Area must be a positive number'),
  
  body('areaUnit')
    .optional()
    .isIn(['hectares', 'acres', 'square_meters'])
    .withMessage('Invalid area unit'),
  
  body('country')
    .optional()
    .isString()
    .withMessage('Country must be a string')
    .isLength({ max: 100 })
    .withMessage('Country name too long'),
  
  body('region')
    .optional()
    .isString()
    .withMessage('Region must be a string')
    .isLength({ max: 100 })
    .withMessage('Region name too long'),
  
  body('city')
    .optional()
    .isString()
    .withMessage('City must be a string')
    .isLength({ max: 100 })
    .withMessage('City name too long'),
  
  body('postalCode')
    .optional()
    .isPostalCode('any')
    .withMessage('Invalid postal code'),
  
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
    .withMessage('Invalid longitude')
];

// Update farm validation
const updateFarmValidation = [
  param('id')
    .notEmpty()
    .withMessage('Farm ID is required')
    .isUUID()
    .withMessage('Invalid farm ID format'),
  
  body('name')
    .optional()
    .isLength({ min: 2, max: 100 })
    .withMessage('Farm name must be between 2 and 100 characters'),
  
  body('type')
    .optional()
    .isIn(['FAMILY_FARM', 'PROFESSIONAL_FARM', 'CORPORATE_FARM', 'COOPERATIVE_FARM', 'PERSONAL_FARM', 'COMMUNITY_FARM', 'OTHER'])
    .withMessage('Invalid farm type'),
  
  body('status')
    .optional()
    .isIn(['ACTIVE', 'INACTIVE', 'SUSPENDED', 'PENDING_APPROVAL'])
    .withMessage('Invalid farm status'),
  
  body('area')
    .optional()
    .isFloat({ min: 0 })
    .withMessage('Area must be a positive number'),
  
  body('income')
    .optional()
    .isFloat({ min: 0 })
    .withMessage('Income must be a positive number'),
  
  body('expenses')
    .optional()
    .isFloat({ min: 0 })
    .withMessage('Expenses must be a positive number'),
  
  body('equipment')
    .optional()
    .isInt({ min: 0 })
    .withMessage('Equipment count must be a positive integer'),
  
  body('labor')
    .optional()
    .isInt({ min: 0 })
    .withMessage('Labor count must be a positive integer')
];

// Get farms validation
const getFarmsValidation = [
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
    .isIn(['ACTIVE', 'INACTIVE', 'SUSPENDED', 'PENDING_APPROVAL'])
    .withMessage('Invalid farm status'),
  
  query('type')
    .optional()
    .isIn(['FAMILY_FARM', 'PROFESSIONAL_FARM', 'CORPORATE_FARM', 'COOPERATIVE_FARM', 'PERSONAL_FARM', 'COMMUNITY_FARM', 'OTHER'])
    .withMessage('Invalid farm type'),
  
  query('region')
    .optional()
    .isString()
    .withMessage('Region must be a string'),
  
  query('search')
    .optional()
    .isString()
    .withMessage('Search query must be a string')
];

// Get farm by ID validation
const getFarmByIdValidation = [
  param('id')
    .notEmpty()
    .withMessage('Farm ID is required')
    .isUUID()
    .withMessage('Invalid farm ID format')
];

// Delete farm validation
const deleteFarmValidation = [
  param('id')
    .notEmpty()
    .withMessage('Farm ID is required')
    .isUUID()
    .withMessage('Invalid farm ID format')
];

// Assign manager validation
const assignManagerValidation = [
  param('id')
    .notEmpty()
    .withMessage('Farm ID is required')
    .isUUID()
    .withMessage('Invalid farm ID format'),
  
  body('managerId')
    .notEmpty()
    .withMessage('Manager ID is required')
    .isUUID()
    .withMessage('Invalid manager ID format')
];

// Get farm stats validation
const getFarmStatsValidation = [
  param('id')
    .notEmpty()
    .withMessage('Farm ID is required')
    .isUUID()
    .withMessage('Invalid farm ID format')
];

module.exports = {
  createFarmValidation,
  updateFarmValidation,
  getFarmsValidation,
  getFarmByIdValidation,
  deleteFarmValidation,
  assignManagerValidation,
  getFarmStatsValidation
};