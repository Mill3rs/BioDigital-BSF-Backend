const morgan = require('morgan');
const logger = require('../utils/logger');

// Create stream for morgan
const stream = {
  write: (message) => {
    logger.info(message.trim());
  }
};

// Skip logging for certain routes
const skip = (req) => {
  const skipPaths = ['/health', '/metrics', '/favicon.ico'];
  return skipPaths.includes(req.path);
};

// Custom token for user ID
morgan.token('userId', (req) => {
  return req.user?.id || 'anonymous';
});

// Custom token for response time
morgan.token('response-time-ms', (req, res) => {
  const responseTime = res.getHeader('X-Response-Time');
  return responseTime || '-';
});

// Development logging format
const devFormat = ':method :url :status :response-time-ms ms - :userId - :res[content-length]';

// Production logging format
const prodFormat = ':remote-addr - :userId [:date[clf]] ":method :url HTTP/:http-version" :status :res[content-length] ":referrer" ":user-agent" :response-time-ms ms';

// HTTP request logger middleware
const httpLogger = morgan(process.env.NODE_ENV === 'production' ? prodFormat : devFormat, {
  stream,
  skip
});

// Request logger middleware (custom)
const requestLogger = (req, res, next) => {
  const start = Date.now();
  
  res.on('finish', () => {
    const duration = Date.now() - start;
    res.setHeader('X-Response-Time', `${duration}ms`);
    
    const logData = {
      method: req.method,
      url: req.url,
      status: res.statusCode,
      duration: `${duration}ms`,
      userId: req.user?.id,
      ip: req.ip,
      userAgent: req.get('user-agent')
    };
    
    if (res.statusCode >= 400) {
      logger.warn('Request error', logData);
    } else {
      logger.info('Request completed', logData);
    }
  });
  
  next();
};

// Error logger middleware
const errorLogger = (err, req, res, next) => {
  logger.error({
    message: err.message,
    stack: err.stack,
    method: req.method,
    url: req.url,
    userId: req.user?.id,
    ip: req.ip
  });
  next(err);
};

module.exports = {
  httpLogger,
  requestLogger,
  errorLogger
};