const cors = require('cors');
const config = require('../config');

// Allowed origins
const allowedOrigins = config.CORS_ORIGINS || [
  'http://localhost:3000',
  'http://localhost:3001',
  'http://localhost:8080',
  'http://localhost:19000',
  'http://localhost:19001',
  'http://localhost:19002'
];

// CORS options
const corsOptions = {
  origin: (origin, callback) => {
    // Allow requests with no origin (like mobile apps, curl, etc.)
    if (!origin) {
      return callback(null, true);
    }
    
    if (allowedOrigins.indexOf(origin) !== -1 || process.env.NODE_ENV !== 'production') {
      callback(null, true);
    } else {
      callback(new Error('CORS policy violation: Origin not allowed'), false);
    }
  },
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS', 'HEAD'],
  allowedHeaders: [
    'Content-Type',
    'Authorization',
    'X-Requested-With',
    'Accept',
    'Origin',
    'X-CSRF-Token',
    'X-API-Key',
    'X-User-Id',
    'X-Session-Token',
    'X-Refresh-Token'
  ],
  exposedHeaders: [
    'X-Total-Count',
    'X-Page',
    'X-Limit',
    'X-Response-Time',
    'X-Request-ID'
  ],
  maxAge: 86400 // 24 hours
};

// Pre-flight requests handling
const handlePreflight = (req, res, next) => {
  if (req.method === 'OPTIONS') {
    res.header('Access-Control-Allow-Methods', corsOptions.methods.join(','));
    res.header('Access-Control-Allow-Headers', corsOptions.allowedHeaders.join(','));
    res.header('Access-Control-Max-Age', corsOptions.maxAge);
    res.status(204).send();
  } else {
    next();
  }
};

// Dynamic CORS for different routes
const corsMiddleware = (options = {}) => {
  return cors({ ...corsOptions, ...options });
};

// Strict CORS for admin routes
const adminCors = cors({
  origin: allowedOrigins,
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE'],
  allowedHeaders: ['Content-Type', 'Authorization']
});

// Public CORS for public endpoints (more permissive)
const publicCors = cors({
  origin: '*',
  credentials: false,
  methods: ['GET', 'POST'],
  allowedHeaders: ['Content-Type']
});

// Webhook CORS (very permissive)
const webhookCors = cors({
  origin: '*',
  credentials: false,
  methods: ['POST'],
  allowedHeaders: ['Content-Type', 'X-Webhook-Signature']
});

module.exports = {
  corsOptions,
  corsMiddleware,
  handlePreflight,
  adminCors,
  publicCors,
  webhookCors
};