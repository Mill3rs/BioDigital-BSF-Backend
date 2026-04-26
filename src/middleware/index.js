// Export all middleware from a single file
const auth = require('./auth');
const errorHandler = require('./errorHandler');
const validation = require('./validation');
const rateLimiter = require('./rateLimiter');
const upload = require('./upload');
const logger = require('./logger');
const cors = require('./cors');

module.exports = {
  auth,
  errorHandler,
  validation,
  rateLimiter,
  upload,
  logger,
  cors
};