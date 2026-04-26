const dotenv = require('dotenv');

// Load environment variables
dotenv.config();

// Application configuration
const config = {
  // Server
  NODE_ENV: process.env.NODE_ENV || 'development',
  PORT: parseInt(process.env.PORT, 10) || 3000,
  API_URL: process.env.API_URL || 'http://localhost:3000',
  CLIENT_URL: process.env.CLIENT_URL || 'http://localhost:3001',
  
  // CORS
  CORS_ORIGINS: process.env.CORS_ORIGINS 
    ? process.env.CORS_ORIGINS.split(',') 
    : ['http://localhost:3000', 'http://localhost:3001', 'http://localhost:8080'],
  
  // Database
  DATABASE_URL: process.env.DATABASE_URL,
  DATABASE_MAX_CONNECTIONS: parseInt(process.env.DATABASE_MAX_CONNECTIONS, 10) || 20,
  DATABASE_IDLE_TIMEOUT: parseInt(process.env.DATABASE_IDLE_TIMEOUT, 10) || 30000,
  DATABASE_CONNECTION_TIMEOUT: parseInt(process.env.DATABASE_CONNECTION_TIMEOUT, 10) || 2000,
  
  // Redis
  REDIS_URL: process.env.REDIS_URL || 'redis://localhost:6379',
  REDIS_HOST: process.env.REDIS_HOST || 'localhost',
  REDIS_PORT: parseInt(process.env.REDIS_PORT, 10) || 6379,
  REDIS_PASSWORD: process.env.REDIS_PASSWORD || null,
  REDIS_DB: parseInt(process.env.REDIS_DB, 10) || 0,
  
  // JWT
  JWT_SECRET: process.env.JWT_SECRET || 'default-secret-change-me',
  JWT_EXPIRES_IN: process.env.JWT_EXPIRES_IN || '7d',
  JWT_REFRESH_SECRET: process.env.JWT_REFRESH_SECRET || 'default-refresh-secret',
  JWT_REFRESH_EXPIRES_IN: process.env.JWT_REFRESH_EXPIRES_IN || '30d',
  
  // Email (SMTP)
  SMTP_HOST: process.env.SMTP_HOST,
  SMTP_PORT: parseInt(process.env.SMTP_PORT, 10) || 465,
  SMTP_SECURE: process.env.SMTP_SECURE === 'true',
  SMTP_USER: process.env.SMTP_USER,
  SMTP_PASS: process.env.SMTP_PASS,
  EMAIL_FROM: process.env.EMAIL_FROM || 'noreply@biodigital.com',
  
  // AWS S3
  AWS_ACCESS_KEY_ID: process.env.AWS_ACCESS_KEY_ID,
  AWS_SECRET_ACCESS_KEY: process.env.AWS_SECRET_ACCESS_KEY,
  AWS_REGION: process.env.AWS_REGION || 'us-east-1',
  AWS_S3_BUCKET: process.env.AWS_S3_BUCKET,
  AWS_S3_BASE_URL: process.env.AWS_S3_BASE_URL,
  
  // Stripe
  STRIPE_SECRET_KEY: process.env.STRIPE_SECRET_KEY,
  STRIPE_PUBLISHABLE_KEY: process.env.STRIPE_PUBLISHABLE_KEY,
  STRIPE_WEBHOOK_SECRET: process.env.STRIPE_WEBHOOK_SECRET,
  
  // Twilio
  TWILIO_ACCOUNT_SID: process.env.TWILIO_ACCOUNT_SID,
  TWILIO_AUTH_TOKEN: process.env.TWILIO_AUTH_TOKEN,
  TWILIO_PHONE_NUMBER: process.env.TWILIO_PHONE_NUMBER,
  TWILIO_MESSAGING_SERVICE_SID: process.env.TWILIO_MESSAGING_SERVICE_SID,
  
  // Google Maps
  GOOGLE_MAPS_API_KEY: process.env.GOOGLE_MAPS_API_KEY,
  
  // Carbon API
  CARBON_API_URL: process.env.CARBON_API_URL || 'https://api.carboninterface.com/v1',
  CARBON_API_KEY: process.env.CARBON_API_KEY,
  
  // Firebase Cloud Messaging
  FCM_SERVER_KEY: process.env.FCM_SERVER_KEY,
  
  // File Upload
  MAX_FILE_SIZE: parseInt(process.env.MAX_FILE_SIZE, 10) || 5242880, // 5MB default
  ALLOWED_FILE_TYPES: process.env.ALLOWED_FILE_TYPES 
    ? process.env.ALLOWED_FILE_TYPES.split(',') 
    : ['image/jpeg', 'image/png', 'image/jpg', 'application/pdf'],
  UPLOAD_DIR: process.env.UPLOAD_DIR || './uploads',
  
  // Rate Limiting
  RATE_LIMIT_WINDOW_MS: parseInt(process.env.RATE_LIMIT_WINDOW_MS, 10) || 900000, // 15 minutes
  RATE_LIMIT_MAX_REQUESTS: parseInt(process.env.RATE_LIMIT_MAX_REQUESTS, 10) || 100,
  
  // Logging
  LOG_LEVEL: process.env.LOG_LEVEL || 'info',
  LOG_FILE: process.env.LOG_FILE || 'logs/app.log',
  LOG_MAX_SIZE: parseInt(process.env.LOG_MAX_SIZE, 10) || 5242880, // 5MB
  LOG_MAX_FILES: parseInt(process.env.LOG_MAX_FILES, 10) || 5,
  
  // Session
  SESSION_SECRET: process.env.SESSION_SECRET || 'session-secret-change-me',
  SESSION_MAX_AGE: parseInt(process.env.SESSION_MAX_AGE, 10) || 86400000, // 24 hours
  
  // Cache
  CACHE_TTL: parseInt(process.env.CACHE_TTL, 10) || 3600, // 1 hour
  CACHE_CHECK_PERIOD: parseInt(process.env.CACHE_CHECK_PERIOD, 10) || 600, // 10 minutes
  
  // Queue
  QUEUE_REDIS_URL: process.env.QUEUE_REDIS_URL || 'redis://localhost:6379',
  BULL_QUEUE_PREFIX: process.env.BULL_QUEUE_PREFIX || 'bull',
  
  // Pagination
  DEFAULT_PAGE_SIZE: parseInt(process.env.DEFAULT_PAGE_SIZE, 10) || 20,
  MAX_PAGE_SIZE: parseInt(process.env.MAX_PAGE_SIZE, 10) || 100,
  
  // Timeouts
  REQUEST_TIMEOUT: parseInt(process.env.REQUEST_TIMEOUT, 10) || 30000, // 30 seconds
  KEEP_ALIVE_TIMEOUT: parseInt(process.env.KEEP_ALIVE_TIMEOUT, 10) || 65000, // 65 seconds
  
  // Security
  BCRYPT_ROUNDS: parseInt(process.env.BCRYPT_ROUNDS, 10) || 10,
  ENCRYPTION_KEY: process.env.ENCRYPTION_KEY,
  
  // Webhook
  WEBHOOK_TIMEOUT: parseInt(process.env.WEBHOOK_TIMEOUT, 10) || 10000, // 10 seconds
  WEBHOOK_RETRY_COUNT: parseInt(process.env.WEBHOOK_RETRY_COUNT, 10) || 3,
  
  // API
  API_VERSION: process.env.API_VERSION || 'v1',
  API_PREFIX: process.env.API_PREFIX || '/api'
};

// Validate required configuration
const validateConfig = () => {
  const requiredForProduction = [
    'JWT_SECRET',
    'JWT_REFRESH_SECRET',
    'DATABASE_URL'
  ];
  
  if (config.NODE_ENV === 'production') {
    const missing = requiredForProduction.filter(key => !config[key]);
    if (missing.length > 0) {
      throw new Error(`Missing required configuration in production: ${missing.join(', ')}`);
    }
  }
};

// Export configuration
module.exports = {
  ...config,
  validateConfig
};