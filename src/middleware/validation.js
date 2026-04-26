const { validationResult, body, param, query } = require('express-validator');

// Validation result checker
const validate = (req, res, next) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({
      success: false,
      message: 'Validation failed',
      errors: errors.array()
    });
  }
  next();
};

// Common validation rules
const commonValidations = {
  // ID validations
  idParam: param('id').isMongoId().withMessage('Invalid ID format'),
  
  // Pagination
  pagination: [
    query('page').optional().isInt({ min: 1 }).withMessage('Page must be a positive integer'),
    query('limit').optional().isInt({ min: 1, max: 100 }).withMessage('Limit must be between 1 and 100')
  ],
  
  // Date validations
  dateRange: [
    query('startDate').optional().isISO8601().withMessage('Invalid start date format'),
    query('endDate').optional().isISO8601().withMessage('Invalid end date format')
  ],
  
  // Email validation
  email: body('email').isEmail().normalizeEmail().withMessage('Valid email is required'),
  
  // Password validation
  password: body('password')
    .isLength({ min: 6 })
    .withMessage('Password must be at least 6 characters')
    .matches(/^(?=.*[A-Za-z])(?=.*\d)/)
    .withMessage('Password must contain at least one letter and one number'),
  
  // Phone validation
  phone: body('phoneNumber')
    .optional()
    .isMobilePhone()
    .withMessage('Valid phone number required'),
  
  // Name validation
  name: body('name')
    .notEmpty()
    .withMessage('Name is required')
    .isLength({ max: 100 })
    .withMessage('Name too long'),
  
  // URL validation
  url: body('url').optional().isURL().withMessage('Invalid URL format'),
  
  // Enum validation helper
  isEnum: (field, enumValues) => {
    return body(field).isIn(enumValues).withMessage(`Invalid value for ${field}`);
  }
};

// Farm validation
const farmValidation = {
  create: [
    body('name').notEmpty().withMessage('Farm name is required'),
    body('type').isIn(['FAMILY_FARM', 'PROFESSIONAL_FARM', 'CORPORATE_FARM', 'COOPERATIVE_FARM', 'PERSONAL_FARM', 'COMMUNITY_FARM', 'OTHER']),
    body('area').optional().isFloat({ min: 0 }).withMessage('Area must be a positive number'),
    body('country').optional().isString(),
    body('region').optional().isString(),
    validate
  ],
  update: [
    body('name').optional().notEmpty(),
    body('type').optional().isIn(['FAMILY_FARM', 'PROFESSIONAL_FARM', 'CORPORATE_FARM', 'COOPERATIVE_FARM', 'PERSONAL_FARM', 'COMMUNITY_FARM', 'OTHER']),
    body('status').optional().isIn(['ACTIVE', 'INACTIVE', 'SUSPENDED', 'PENDING_APPROVAL']),
    validate
  ]
};

// Waste validation
const wasteValidation = {
  create: [
    body('sourceName').notEmpty().withMessage('Source name is required'),
    body('sourceType').isIn(['AGRICULTURAL', 'FOOD_WASTE', 'MARKET_WASTE', 'HOUSEHOLD', 'INDUSTRIAL', 'MUNICIPAL', 'COMMERCIAL', 'OTHER']),
    body('quantity').isFloat({ gt: 0 }).withMessage('Quantity must be greater than 0'),
    body('date').isISO8601().withMessage('Valid date is required'),
    body('unit').optional().isString(),
    validate
  ],
  update: [
    body('quantity').optional().isFloat({ gt: 0 }),
    body('status').optional().isIn(['PENDING', 'SCHEDULED', 'COLLECTED', 'PROCESSING', 'PROCESSED', 'CANCELLED', 'REJECTED']),
    validate
  ]
};

// Processing batch validation
const processingValidation = {
  create: [
    body('processType').isIn(['COMPOSTING', 'ANAEROBIC_DIGESTION', 'VERMICOMPOSTING', 'BSF_LARVAE_PROCESSING', 'BLACK_SOLDIER_FLY', 'FERMENTATION', 'DRYING', 'PELLETIZING', 'OTHER']),
    body('quantity').isFloat({ gt: 0 }).withMessage('Quantity must be greater than 0'),
    body('startDate').isISO8601().withMessage('Valid start date is required'),
    validate
  ],
  recordOutput: [
    body('liquidOutput').optional().isFloat({ min: 0 }),
    body('fertilizerOutput').optional().isFloat({ min: 0 }),
    body('conversionRate').optional().isFloat({ min: 0, max: 100 }),
    validate
  ]
};

// Product validation
const productValidation = {
  create: [
    body('name').notEmpty().withMessage('Product name is required'),
    body('category').isIn(['ORGANIC_FERTILIZER', 'PROTEIN_FEED', 'INSECT_OIL', 'SOIL_CONDITIONER', 'DRIED_LARVAE', 'COMPOST', 'LIQUID_FERTILIZER', 'BIOCHAR', 'OTHER']),
    body('variants').isArray().withMessage('At least one variant is required'),
    body('variants.*.name').notEmpty(),
    body('variants.*.quantity').isInt({ min: 0 }),
    body('variants.*.price').isFloat({ min: 0 }),
    validate
  ],
  variant: [
    body('name').notEmpty(),
    body('quantity').isInt({ min: 0 }),
    body('price').isFloat({ min: 0 }),
    body('unitType').notEmpty(),
    validate
  ]
};

// Order validation
const orderValidation = {
  create: [
    body('items').isArray().withMessage('Items must be an array'),
    body('items.*.variantId').notEmpty().withMessage('Variant ID is required'),
    body('items.*.quantity').isInt({ min: 1 }).withMessage('Quantity must be at least 1'),
    body('deliveryAddress').isObject().withMessage('Delivery address is required'),
    body('paymentMethod').isIn(['CASH_ON_DELIVERY', 'MOBILE_MONEY', 'BANK_TRANSFER', 'CREDIT_CARD', 'DEBIT_CARD', 'PAYPAL', 'STRIPE', 'OTHER']),
    validate
  ],
  updateStatus: [
    body('status').isIn(['CONFIRMED', 'PROCESSING', 'READY_FOR_PICKUP', 'SHIPPED', 'OUT_FOR_DELIVERY', 'DELIVERED', 'COMPLETED']),
    validate
  ]
};

// User validation
const userValidation = {
  register: [
    commonValidations.email,
    commonValidations.password,
    body('fullName').notEmpty().withMessage('Full name is required'),
    commonValidations.phone,
    body('role').isIn(['DRIVER', 'BUYER', 'SUPPLIER']).withMessage('Invalid role selected'),
    validate
  ],
  login: [
    commonValidations.email,
    body('password').notEmpty().withMessage('Password is required'),
    validate
  ],
  update: [
    body('fullName').optional().notEmpty(),
    body('phoneNumber').optional(),
    body('status').optional().isIn(['ACTIVE', 'INACTIVE', 'SUSPENDED']),
    validate
  ],
  changePassword: [
    body('currentPassword').notEmpty().withMessage('Current password is required'),
    body('newPassword').isLength({ min: 6 }).withMessage('New password must be at least 6 characters'),
    validate
  ]
};

module.exports = {
  validate,
  commonValidations,
  farmValidation,
  wasteValidation,
  processingValidation,
  productValidation,
  orderValidation,
  userValidation
};