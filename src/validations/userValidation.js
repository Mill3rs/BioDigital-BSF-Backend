const { body, query, param } = require('express-validator');

// Update profile validation
const updateProfileValidation = [
  body('fullName')
    .optional()
    .isLength({ min: 2, max: 100 })
    .withMessage('Full name must be between 2 and 100 characters')
    .matches(/^[a-zA-Z\s\-']+$/)
    .withMessage('Full name can only contain letters, spaces, hyphens, and apostrophes'),
  
  body('phoneNumber')
    .optional()
    .isMobilePhone()
    .withMessage('Valid phone number is required'),
  
  body('profileImage')
    .optional()
    .isURL()
    .withMessage('Profile image must be a valid URL'),
  
  body('address')
    .optional()
    .isObject()
    .withMessage('Address must be an object'),
  
  body('address.street')
    .optional()
    .isString()
    .withMessage('Street must be a string'),
  
  body('address.city')
    .optional()
    .isString()
    .withMessage('City must be a string'),
  
  body('address.country')
    .optional()
    .isString()
    .withMessage('Country must be a string'),
  
  body('address.postalCode')
    .optional()
    .isPostalCode('any')
    .withMessage('Invalid postal code')
];

// Get users validation (admin)
const getUsersValidation = [
  query('page')
    .optional()
    .isInt({ min: 1 })
    .withMessage('Page must be a positive integer'),
  
  query('limit')
    .optional()
    .isInt({ min: 1, max: 100 })
    .withMessage('Limit must be between 1 and 100'),
  
  query('role')
    .optional()
    .isIn(['SUPER_ADMIN', 'ADMIN', 'MANAGER', 'DRIVER', 'BUYER', 'SUPPLIER'])
    .withMessage('Invalid role'),
  
  query('status')
    .optional()
    .isIn(['ACTIVE', 'INACTIVE', 'SUSPENDED', 'PENDING_VERIFICATION'])
    .withMessage('Invalid status'),
  
  query('search')
    .optional()
    .isString()
    .withMessage('Search query must be a string')
];

// Get user by ID validation
const getUserByIdValidation = [
  param('id')
    .notEmpty()
    .withMessage('User ID is required')
    .isUUID()
    .withMessage('Invalid user ID format')
];

// Update user validation (admin)
const updateUserValidation = [
  param('id')
    .notEmpty()
    .withMessage('User ID is required')
    .isUUID()
    .withMessage('Invalid user ID format'),
  
  body('fullName')
    .optional()
    .isLength({ min: 2, max: 100 })
    .withMessage('Full name must be between 2 and 100 characters'),
  
  body('phoneNumber')
    .optional()
    .isMobilePhone()
    .withMessage('Valid phone number is required'),
  
  body('role')
    .optional()
    .isIn(['SUPER_ADMIN', 'ADMIN', 'MANAGER', 'DRIVER', 'BUYER', 'SUPPLIER'])
    .withMessage('Invalid role'),
  
  body('status')
    .optional()
    .isIn(['ACTIVE', 'INACTIVE', 'SUSPENDED'])
    .withMessage('Invalid status')
];

// Delete user validation (super admin)
const deleteUserValidation = [
  param('id')
    .notEmpty()
    .withMessage('User ID is required')
    .isUUID()
    .withMessage('Invalid user ID format')
    .custom(async (id, { req }) => {
      if (id === req.user.id) {
        throw new Error('Cannot delete your own account');
      }
      return true;
    })
];

// Create user validation (admin)
const createUserValidation = [
  body('email')
    .isEmail()
    .normalizeEmail()
    .withMessage('Valid email address is required'),
  
  body('password')
    .isLength({ min: 6 })
    .withMessage('Password must be at least 6 characters long'),
  
  body('fullName')
    .notEmpty()
    .withMessage('Full name is required')
    .isLength({ min: 2, max: 100 })
    .withMessage('Full name must be between 2 and 100 characters'),
  
  body('phoneNumber')
    .optional()
    .isMobilePhone()
    .withMessage('Valid phone number is required'),
  
  body('role')
    .isIn(['MANAGER', 'DRIVER', 'BUYER', 'SUPPLIER'])
    .withMessage('Role must be MANAGER, DRIVER, BUYER, or SUPPLIER'),
  
  body('farmId')
    .optional()
    .isUUID()
    .withMessage('Invalid farm ID format')
];

module.exports = {
  updateProfileValidation,
  getUsersValidation,
  getUserByIdValidation,
  updateUserValidation,
  deleteUserValidation,
  createUserValidation
};