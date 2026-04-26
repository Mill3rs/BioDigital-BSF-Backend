const validator = require('validator');

// Email validator
const isValidEmail = (email) => {
  if (!email) return false;
  return validator.isEmail(email);
};

// Phone validator
const isValidPhone = (phone) => {
  if (!phone) return false;
  return validator.isMobilePhone(phone, 'any');
};

// Password validator (at least 6 chars, 1 letter, 1 number)
const isValidPassword = (password) => {
  if (!password) return false;
  const passwordRegex = /^(?=.*[A-Za-z])(?=.*\d)[A-Za-z\d]{6,}$/;
  return passwordRegex.test(password);
};

// URL validator
const isValidUrl = (url) => {
  if (!url) return false;
  return validator.isURL(url);
};

// UUID validator
const isValidUUID = (uuid) => {
  if (!uuid) return false;
  return validator.isUUID(uuid);
};

// ObjectId validator (MongoDB)
const isValidObjectId = (id) => {
  if (!id) return false;
  return /^[0-9a-fA-F]{24}$/.test(id);
};

// Number validator
const isValidNumber = (num, min = null, max = null) => {
  if (num === undefined || num === null) return false;
  const number = parseFloat(num);
  if (isNaN(number)) return false;
  if (min !== null && number < min) return false;
  if (max !== null && number > max) return false;
  return true;
};

// Integer validator
const isValidInteger = (num, min = null, max = null) => {
  if (!Number.isInteger(num)) return false;
  if (min !== null && num < min) return false;
  if (max !== null && num > max) return false;
  return true;
};

// String validator
const isValidString = (str, minLength = null, maxLength = null) => {
  if (typeof str !== 'string') return false;
  if (minLength !== null && str.length < minLength) return false;
  if (maxLength !== null && str.length > maxLength) return false;
  return true;
};

// Date validator
const isValidDate = (date) => {
  if (!date) return false;
  const d = new Date(date);
  return d instanceof Date && !isNaN(d);
};

// Future date validator
const isFutureDate = (date) => {
  if (!isValidDate(date)) return false;
  return new Date(date) > new Date();
};

// Past date validator
const isPastDate = (date) => {
  if (!isValidDate(date)) return false;
  return new Date(date) < new Date();
};

// Enum validator
const isValidEnum = (value, enumValues) => {
  if (!value) return false;
  return enumValues.includes(value);
};

// Coordinates validator
const isValidCoordinates = (lat, lng) => {
  if (!isValidNumber(lat, -90, 90)) return false;
  if (!isValidNumber(lng, -180, 180)) return false;
  return true;
};

// Postal code validator
const isValidPostalCode = (postalCode, country = 'GH') => {
  if (!postalCode) return false;
  // Ghana postal code format: letters and numbers, typically AA-1234
  const ghanaPattern = /^[A-Z]{2}-\d{4}$/;
  if (country === 'GH') return ghanaPattern.test(postalCode);
  return true;
};

// Credit card validator (Luhn algorithm)
const isValidCreditCard = (cardNumber) => {
  if (!cardNumber) return false;
  return validator.isCreditCard(cardNumber);
};

// IBAN validator
const isValidIBAN = (iban) => {
  if (!iban) return false;
  return validator.isIBAN(iban);
};

// JSON validator
const isValidJSON = (str) => {
  if (!str) return false;
  try {
    JSON.parse(str);
    return true;
  } catch (e) {
    return false;
  }
};

// Array validator
const isValidArray = (arr, minLength = null, maxLength = null) => {
  if (!Array.isArray(arr)) return false;
  if (minLength !== null && arr.length < minLength) return false;
  if (maxLength !== null && arr.length > maxLength) return false;
  return true;
};

// Object validator
const isValidObject = (obj, requiredKeys = null) => {
  if (typeof obj !== 'object' || obj === null) return false;
  if (requiredKeys) {
    for (const key of requiredKeys) {
      if (!(key in obj)) return false;
    }
  }
  return true;
};

// Boolean validator
const isValidBoolean = (value) => {
  return typeof value === 'boolean';
};

// Percentage validator (0-100)
const isValidPercentage = (value) => {
  if (!isValidNumber(value)) return false;
  const num = parseFloat(value);
  return num >= 0 && num <= 100;
};

// Color validator (hex)
const isValidHexColor = (color) => {
  if (!color) return false;
  return /^#([A-Fa-f0-9]{6}|[A-Fa-f0-9]{3})$/.test(color);
};

// Domain validator
const isValidDomain = (domain) => {
  if (!domain) return false;
  return validator.isFQDN(domain);
};

// IP validator
const isValidIP = (ip) => {
  if (!ip) return false;
  return validator.isIP(ip);
};

// MAC address validator
const isValidMAC = (mac) => {
  if (!mac) return false;
  return validator.isMACAddress(mac);
};

// Base64 validator
const isValidBase64 = (str) => {
  if (!str) return false;
  return validator.isBase64(str);
};

// Data URI validator
const isValidDataURI = (uri) => {
  if (!uri) return false;
  return validator.isDataURI(uri);
};

// Latitude validator
const isValidLatitude = (lat) => {
  return isValidNumber(lat, -90, 90);
};

// Longitude validator
const isValidLongitude = (lng) => {
  return isValidNumber(lng, -180, 180);
};

// Altitude validator
const isValidAltitude = (alt) => {
  return isValidNumber(alt, -500, 10000);
};

// Speed validator (km/h)
const isValidSpeed = (speed) => {
  return isValidNumber(speed, 0, 300);
};

// Weight validator (kg)
const isValidWeight = (weight) => {
  return isValidNumber(weight, 0, 100000);
};

// Area validator (hectares)
const isValidArea = (area) => {
  return isValidNumber(area, 0, 1000000);
};

// Validate farm data
const validateFarmData = (data) => {
  const errors = [];
  if (!isValidString(data.name, 2, 100)) {
    errors.push('Farm name must be between 2 and 100 characters');
  }
  if (data.area && !isValidArea(data.area)) {
    errors.push('Invalid area value');
  }
  if (data.country && !isValidString(data.country, 2, 100)) {
    errors.push('Country must be between 2 and 100 characters');
  }
  return {
    isValid: errors.length === 0,
    errors
  };
};

// Validate waste data
const validateWasteData = (data) => {
  const errors = [];
  if (!isValidString(data.sourceName, 2, 100)) {
    errors.push('Source name must be between 2 and 100 characters');
  }
  if (!isValidNumber(data.quantity, 0.01)) {
    errors.push('Quantity must be greater than 0');
  }
  if (!isValidDate(data.date)) {
    errors.push('Invalid date');
  }
  return {
    isValid: errors.length === 0,
    errors
  };
};

// Validate order data
const validateOrderData = (data) => {
  const errors = [];
  if (!isValidArray(data.items, 1)) {
    errors.push('At least one item is required');
  }
  if (!isValidObject(data.deliveryAddress)) {
    errors.push('Delivery address is required');
  }
  if (!isValidEnum(data.paymentMethod, Object.values(require('./constants').PAYMENT_METHODS))) {
    errors.push('Invalid payment method');
  }
  return {
    isValid: errors.length === 0,
    errors
  };
};

module.exports = {
  isValidEmail,
  isValidPhone,
  isValidPassword,
  isValidUrl,
  isValidUUID,
  isValidObjectId,
  isValidNumber,
  isValidInteger,
  isValidString,
  isValidDate,
  isFutureDate,
  isPastDate,
  isValidEnum,
  isValidCoordinates,
  isValidPostalCode,
  isValidCreditCard,
  isValidIBAN,
  isValidJSON,
  isValidArray,
  isValidObject,
  isValidBoolean,
  isValidPercentage,
  isValidHexColor,
  isValidDomain,
  isValidIP,
  isValidMAC,
  isValidBase64,
  isValidDataURI,
  isValidLatitude,
  isValidLongitude,
  isValidAltitude,
  isValidSpeed,
  isValidWeight,
  isValidArea,
  validateFarmData,
  validateWasteData,
  validateOrderData
};