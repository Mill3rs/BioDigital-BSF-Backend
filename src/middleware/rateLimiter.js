const rateLimit = require('express-rate-limit');
const config = require('../config');

// Create custom rate limiter
const createRateLimiter = (options = {}) => {
  return rateLimit({
    windowMs: options.windowMs || config.RATE_LIMIT_WINDOW_MS,
    max: options.max || config.RATE_LIMIT_MAX_REQUESTS,
    message: {
      success: false,
      message: 'Too many requests from this IP, please try again later.',
      retryAfter: Math.ceil((options.windowMs || config.RATE_LIMIT_WINDOW_MS) / 1000)
    },
    standardHeaders: true,
    legacyHeaders: false,
    skipSuccessfulRequests: options.skipSuccessfulRequests || false,
    keyGenerator: (req) => {
      // Use user ID if authenticated, otherwise IP
      return req.user?.id || req.ip;
    },
    handler: (req, res, next, options) => {
      res.status(429).json({
        success: false,
        message: options.message.message,
        retryAfter: options.message.retryAfter
      });
    },
    ...options
  });
};

// Auth rate limiter (stricter)
const authLimiter = createRateLimiter({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 5,
  skipSuccessfulRequests: true,
  message: {
    message: 'Too many login attempts. Please try again after 15 minutes.',
    retryAfter: 900
  }
});

// General API rate limiter
const apiLimiter = createRateLimiter({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 100
});

// File upload rate limiter
const uploadLimiter = createRateLimiter({
  windowMs: 60 * 60 * 1000, // 1 hour
  max: 50,
  message: {
    message: 'Too many uploads. Please try again after an hour.',
    retryAfter: 3600
  }
});

// Order creation rate limiter
const orderLimiter = createRateLimiter({
  windowMs: 60 * 60 * 1000, // 1 hour
  max: 20,
  message: {
    message: 'Too many orders placed. Please try again later.',
    retryAfter: 3600
  }
});

// SMS/Email rate limiter
const messageLimiter = createRateLimiter({
  windowMs: 60 * 60 * 1000, // 1 hour
  max: 10,
  message: {
    message: 'Too many messages sent. Please try again later.',
    retryAfter: 3600
  }
});

// Report generation rate limiter
const reportLimiter = createRateLimiter({
  windowMs: 60 * 60 * 1000, // 1 hour
  max: 5,
  message: {
    message: 'Too many reports generated. Please try again later.',
    retryAfter: 3600
  }
});

// Webhook rate limiter (higher limit)
const webhookLimiter = createRateLimiter({
  windowMs: 60 * 1000, // 1 minute
  max: 100,
  message: {
    message: 'Too many webhook requests.',
    retryAfter: 60
  }
});

module.exports = {
  createRateLimiter,
  authLimiter,
  apiLimiter,
  uploadLimiter,
  orderLimiter,
  messageLimiter,
  reportLimiter,
  webhookLimiter
};