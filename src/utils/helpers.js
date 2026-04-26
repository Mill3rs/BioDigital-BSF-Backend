const { v4: uuidv4 } = require('uuid');
const moment = require('moment');

// Generate UUID
const generateUUID = () => uuidv4();

// Generate order number
const generateOrderNumber = () => {
  const timestamp = Date.now();
  const random = Math.floor(Math.random() * 10000);
  return `ORD-${timestamp}-${random}`;
};

// Generate batch number
const generateBatchNumber = () => {
  const date = moment().format('YYYYMMDD');
  const random = Math.floor(Math.random() * 1000);
  return `BATCH-${date}-${random}`;
};

// Generate invoice number
const generateInvoiceNumber = () => {
  const timestamp = Date.now();
  const random = Math.floor(Math.random() * 10000);
  return `INV-${timestamp}-${random}`;
};

// Generate tracking number
const generateTrackingNumber = () => {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
  let result = '';
  for (let i = 0; i < 12; i++) {
    result += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return result;
};

// Format date
const formatDate = (date, format = 'YYYY-MM-DD HH:mm:ss') => {
  if (!date) return null;
  return moment(date).format(format);
};

// Parse date
const parseDate = (dateString) => {
  if (!dateString) return null;
  return moment(dateString).toDate();
};

// Calculate pagination
const calculatePagination = (page = 1, limit = 20, total = 0) => {
  const skip = (page - 1) * limit;
  const totalPages = Math.ceil(total / limit);
  return {
    skip,
    take: parseInt(limit),
    pagination: {
      page: parseInt(page),
      limit: parseInt(limit),
      total,
      totalPages,
      hasNext: page < totalPages,
      hasPrev: page > 1,
      nextPage: page < totalPages ? page + 1 : null,
      prevPage: page > 1 ? page - 1 : null
    }
  };
};

// Sanitize object (remove sensitive fields)
const sanitizeObject = (obj, fieldsToRemove = ['password', '__v', 'refreshToken']) => {
  if (!obj) return null;
  const sanitized = { ...obj };
  fieldsToRemove.forEach(field => {
    delete sanitized[field];
  });
  return sanitized;
};

// Deep clone object
const deepClone = (obj) => {
  return JSON.parse(JSON.stringify(obj));
};

// Sleep/delay
const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

// Retry function
const retry = async (fn, retries = 3, delay = 1000) => {
  try {
    return await fn();
  } catch (error) {
    if (retries <= 0) throw error;
    await sleep(delay);
    return retry(fn, retries - 1, delay * 2);
  }
};

// Debounce function
const debounce = (func, wait) => {
  let timeout;
  return function executedFunction(...args) {
    const later = () => {
      clearTimeout(timeout);
      func(...args);
    };
    clearTimeout(timeout);
    timeout = setTimeout(later, wait);
  };
};

// Throttle function
const throttle = (func, limit) => {
  let inThrottle;
  return function(...args) {
    if (!inThrottle) {
      func.apply(this, args);
      inThrottle = true;
      setTimeout(() => inThrottle = false, limit);
    }
  };
};

// Extract number from string
const extractNumber = (str) => {
  const match = str?.match(/\d+/);
  return match ? parseInt(match[0]) : null;
};

// Format currency
const formatCurrency = (amount, currency = 'GHS') => {
  return new Intl.NumberFormat('en-GH', {
    style: 'currency',
    currency: currency
  }).format(amount);
};

// Format phone number
const formatPhoneNumber = (phone) => {
  if (!phone) return null;
  // Remove all non-digit characters
  let cleaned = phone.replace(/\D/g, '');
  // Add country code if missing
  if (cleaned.length === 9) {
    cleaned = '233' + cleaned;
  }
  return '+' + cleaned;
};

// Truncate text
const truncateText = (text, maxLength = 100, suffix = '...') => {
  if (!text) return '';
  if (text.length <= maxLength) return text;
  return text.substring(0, maxLength) + suffix;
};

// Slugify string
const slugify = (text) => {
  if (!text) return '';
  return text
    .toString()
    .toLowerCase()
    .trim()
    .replace(/\s+/g, '-')
    .replace(/[^\w\-]+/g, '')
    .replace(/\-\-+/g, '-')
    .replace(/^-+/, '')
    .replace(/-+$/, '');
};

// Random string generator
const randomString = (length = 10) => {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  let result = '';
  for (let i = 0; i < length; i++) {
    result += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return result;
};

// Check if object is empty
const isEmpty = (obj) => {
  return !obj || Object.keys(obj).length === 0;
};

// Group array by key
const groupBy = (array, key) => {
  return array.reduce((result, item) => {
    const groupKey = item[key];
    if (!result[groupKey]) {
      result[groupKey] = [];
    }
    result[groupKey].push(item);
    return result;
  }, {});
};

// Calculate percentage
const calculatePercentage = (value, total) => {
  if (total === 0) return 0;
  return (value / total) * 100;
};

// Get days between dates
const getDaysBetween = (startDate, endDate) => {
  const start = moment(startDate);
  const end = moment(endDate);
  return end.diff(start, 'days');
};

// Add days to date
const addDays = (date, days) => {
  return moment(date).add(days, 'days').toDate();
};

// Compare objects
const isEqual = (obj1, obj2) => {
  return JSON.stringify(obj1) === JSON.stringify(obj2);
};

module.exports = {
  generateUUID,
  generateOrderNumber,
  generateBatchNumber,
  generateInvoiceNumber,
  generateTrackingNumber,
  formatDate,
  parseDate,
  calculatePagination,
  sanitizeObject,
  deepClone,
  sleep,
  retry,
  debounce,
  throttle,
  extractNumber,
  formatCurrency,
  formatPhoneNumber,
  truncateText,
  slugify,
  randomString,
  isEmpty,
  groupBy,
  calculatePercentage,
  getDaysBetween,
  addDays,
  isEqual
};