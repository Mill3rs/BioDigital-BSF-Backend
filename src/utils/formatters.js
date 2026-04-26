const moment = require('moment');
const { DATE_FORMATS } = require('./constants');

// Format date
const formatDate = (date, format = DATE_FORMATS.DEFAULT) => {
  if (!date) return null;
  return moment(date).format(format);
};

// Format currency
const formatCurrency = (amount, currency = 'GHS', locale = 'en-GH') => {
  if (amount === undefined || amount === null) return null;
  return new Intl.NumberFormat(locale, {
    style: 'currency',
    currency: currency,
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
  }).format(amount);
};

// Format number
const formatNumber = (number, decimals = 2, locale = 'en-GH') => {
  if (number === undefined || number === null) return null;
  return new Intl.NumberFormat(locale, {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals
  }).format(number);
};

// Format percentage
const formatPercentage = (value, decimals = 2, locale = 'en-GH') => {
  if (value === undefined || value === null) return null;
  return new Intl.NumberFormat(locale, {
    style: 'percent',
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals
  }).format(value / 100);
};

// Format phone number
const formatPhoneNumber = (phone, countryCode = '233') => {
  if (!phone) return null;
  // Remove all non-digit characters
  let cleaned = phone.replace(/\D/g, '');
  // Remove country code if present
  if (cleaned.startsWith(countryCode)) {
    cleaned = cleaned.substring(countryCode.length);
  }
  // Format as Ghana number: (XXX) XXX-XXXX
  if (cleaned.length === 9) {
    return `(${cleaned.substring(0, 3)}) ${cleaned.substring(3, 6)}-${cleaned.substring(6, 9)}`;
  }
  return phone;
};

// Format address
const formatAddress = (address) => {
  if (!address) return null;
  if (typeof address === 'string') return address;
  const parts = [];
  if (address.street) parts.push(address.street);
  if (address.city) parts.push(address.city);
  if (address.region) parts.push(address.region);
  if (address.postalCode) parts.push(address.postalCode);
  if (address.country) parts.push(address.country);
  return parts.join(', ');
};

// Format file size
const formatFileSize = (bytes) => {
  if (bytes === 0) return '0 Bytes';
  const k = 1024;
  const sizes = ['Bytes', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
};

// Format duration (milliseconds to human readable)
const formatDuration = (ms) => {
  if (!ms) return '0 seconds';
  const seconds = Math.floor(ms / 1000);
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);
  const days = Math.floor(hours / 24);
  
  if (days > 0) return `${days} day${days > 1 ? 's' : ''}`;
  if (hours > 0) return `${hours} hour${hours > 1 ? 's' : ''}`;
  if (minutes > 0) return `${minutes} minute${minutes > 1 ? 's' : ''}`;
  return `${seconds} second${seconds > 1 ? 's' : ''}`;
};

// Format weight
const formatWeight = (kg, unit = 'kg', decimals = 2) => {
  if (kg === undefined || kg === null) return null;
  if (unit === 'kg') return `${formatNumber(kg, decimals)} kg`;
  if (unit === 'g') return `${formatNumber(kg * 1000, decimals)} g`;
  if (unit === 'tons') return `${formatNumber(kg / 1000, decimals)} tons`;
  return `${formatNumber(kg, decimals)} ${unit}`;
};

// Format volume
const formatVolume = (liters, unit = 'L', decimals = 2) => {
  if (liters === undefined || liters === null) return null;
  if (unit === 'L') return `${formatNumber(liters, decimals)} L`;
  if (unit === 'mL') return `${formatNumber(liters * 1000, decimals)} mL`;
  if (unit === 'm³') return `${formatNumber(liters / 1000, decimals)} m³`;
  return `${formatNumber(liters, decimals)} ${unit}`;
};

// Format area
const formatArea = (hectares, unit = 'ha', decimals = 2) => {
  if (hectares === undefined || hectares === null) return null;
  if (unit === 'ha') return `${formatNumber(hectares, decimals)} ha`;
  if (unit === 'm²') return `${formatNumber(hectares * 10000, decimals)} m²`;
  if (unit === 'acres') return `${formatNumber(hectares * 2.47105, decimals)} acres`;
  return `${formatNumber(hectares, decimals)} ${unit}`;
};

// Format carbon savings
const formatCarbonSavings = (kgCO2e) => {
  if (kgCO2e === undefined || kgCO2e === null) return null;
  if (kgCO2e > 1000) {
    return `${formatNumber(kgCO2e / 1000, 2)} tons CO₂e`;
  }
  return `${formatNumber(kgCO2e, 0)} kg CO₂e`;
};

// Format order number
const formatOrderNumber = (orderNumber) => {
  if (!orderNumber) return null;
  return `#${orderNumber}`;
};

// Format batch number
const formatBatchNumber = (batchNumber) => {
  if (!batchNumber) return null;
  return `Batch ${batchNumber}`;
};

// Format status with badge
const formatStatusBadge = (status) => {
  const statusMap = {
    ACTIVE: { text: 'Active', color: 'green' },
    INACTIVE: { text: 'Inactive', color: 'gray' },
    PENDING: { text: 'Pending', color: 'yellow' },
    COMPLETED: { text: 'Completed', color: 'blue' },
    CANCELLED: { text: 'Cancelled', color: 'red' },
    SUSPENDED: { text: 'Suspended', color: 'orange' },
    PROCESSING: { text: 'Processing', color: 'purple' },
    DELIVERED: { text: 'Delivered', color: 'teal' }
  };
  
  return statusMap[status] || { text: status, color: 'gray' };
};

// Format name (capitalize)
const formatName = (name) => {
  if (!name) return null;
  return name
    .toLowerCase()
    .split(' ')
    .map(word => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ');
};

// Format email (lowercase)
const formatEmail = (email) => {
  if (!email) return null;
  return email.toLowerCase().trim();
};

// Format slug
const formatSlug = (text) => {
  if (!text) return null;
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

// Format JSON for response
const formatResponse = (data, message = null, success = true) => {
  const response = { success };
  if (message) response.message = message;
  if (data !== undefined) response.data = data;
  return response;
};

// Format error response
const formatError = (message, errors = null, statusCode = 400) => {
  const response = {
    success: false,
    message,
    statusCode
  };
  if (errors) response.errors = errors;
  return response;
};

// Format pagination response
const formatPaginationResponse = (data, pagination) => {
  return {
    success: true,
    data,
    pagination
  };
};

// Format coordinates
const formatCoordinates = (lat, lng, decimals = 6) => {
  if (lat === undefined || lng === undefined) return null;
  return {
    lat: parseFloat(lat.toFixed(decimals)),
    lng: parseFloat(lng.toFixed(decimals)),
    formatted: `${lat.toFixed(decimals)}, ${lng.toFixed(decimals)}`
  };
};

// Format distance
const formatDistance = (km, unit = 'km', decimals = 1) => {
  if (km === undefined || km === null) return null;
  if (unit === 'km') return `${formatNumber(km, decimals)} km`;
  if (unit === 'miles') return `${formatNumber(km * 0.621371, decimals)} miles`;
  return `${formatNumber(km, decimals)} ${unit}`;
};

// Format temperature
const formatTemperature = (celsius, unit = '°C', decimals = 1) => {
  if (celsius === undefined || celsius === null) return null;
  if (unit === '°C') return `${formatNumber(celsius, decimals)}°C`;
  if (unit === '°F') return `${formatNumber((celsius * 9/5) + 32, decimals)}°F`;
  return `${formatNumber(celsius, decimals)}${unit}`;
};

// Format humidity
const formatHumidity = (percentage) => {
  if (percentage === undefined || percentage === null) return null;
  return `${formatNumber(percentage, 0)}%`;
};

module.exports = {
  formatDate,
  formatCurrency,
  formatNumber,
  formatPercentage,
  formatPhoneNumber,
  formatAddress,
  formatFileSize,
  formatDuration,
  formatWeight,
  formatVolume,
  formatArea,
  formatCarbonSavings,
  formatOrderNumber,
  formatBatchNumber,
  formatStatusBadge,
  formatName,
  formatEmail,
  formatSlug,
  formatResponse,
  formatError,
  formatPaginationResponse,
  formatCoordinates,
  formatDistance,
  formatTemperature,
  formatHumidity
};