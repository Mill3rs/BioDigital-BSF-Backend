const jwt = require('jsonwebtoken');
const crypto = require('crypto');

// JWT configuration
const JWT_SECRET = process.env.JWT_SECRET || 'default-secret-change-me';
const JWT_REFRESH_SECRET = process.env.JWT_REFRESH_SECRET || 'default-refresh-secret-change-me';
const JWT_EXPIRES_IN = process.env.JWT_EXPIRES_IN || '7d';
const JWT_REFRESH_EXPIRES_IN = process.env.JWT_REFRESH_EXPIRES_IN || '30d';

// Generate access token
const generateToken = (userId, role, additionalClaims = {}) => {
  return jwt.sign(
    { 
      userId, 
      role,
      ...additionalClaims
    },
    JWT_SECRET,
    { expiresIn: JWT_EXPIRES_IN }
  );
};

// Generate refresh token
const generateRefreshToken = (userId, additionalClaims = {}) => {
  return jwt.sign(
    { 
      userId,
      type: 'refresh',
      ...additionalClaims
    },
    JWT_REFRESH_SECRET,
    { expiresIn: JWT_REFRESH_EXPIRES_IN }
  );
};

// Verify access token
const verifyToken = (token) => {
  try {
    return jwt.verify(token, JWT_SECRET);
  } catch (error) {
    return null;
  }
};

// Verify refresh token
const verifyRefreshToken = (token) => {
  try {
    const decoded = jwt.verify(token, JWT_REFRESH_SECRET);
    if (decoded.type !== 'refresh') {
      return null;
    }
    return decoded;
  } catch (error) {
    return null;
  }
};

// Decode token without verification
const decodeToken = (token) => {
  return jwt.decode(token);
};

// Generate password reset token
const generatePasswordResetToken = (userId) => {
  const token = crypto.randomBytes(32).toString('hex');
  const expires = new Date();
  expires.setHours(expires.getHours() + 1); // 1 hour expiry
  
  return {
    token,
    expires
  };
};

// Generate email verification token
const generateEmailVerificationToken = (userId) => {
  const token = crypto.randomBytes(32).toString('hex');
  const expires = new Date();
  expires.setHours(expires.getHours() + 24); // 24 hour expiry
  
  return {
    token,
    expires
  };
};

// Generate API key
const generateApiKey = () => {
  return crypto.randomBytes(32).toString('hex');
};

// Generate secret key
const generateSecretKey = () => {
  return crypto.randomBytes(64).toString('hex');
};

// Hash token (for storing in database)
const hashToken = (token) => {
  return crypto.createHash('sha256').update(token).digest('hex');
};

// Validate token format
const isValidToken = (token) => {
  if (!token || typeof token !== 'string') return false;
  const parts = token.split('.');
  if (parts.length !== 3) return false;
  return true;
};

// Get token expiration time
const getTokenExpiration = (token) => {
  try {
    const decoded = jwt.decode(token);
    return decoded?.exp ? new Date(decoded.exp * 1000) : null;
  } catch (error) {
    return null;
  }
};

// Check if token is expired
const isTokenExpired = (token) => {
  const expiration = getTokenExpiration(token);
  if (!expiration) return true;
  return Date.now() >= expiration.getTime();
};

module.exports = {
  generateToken,
  generateRefreshToken,
  verifyToken,
  verifyRefreshToken,
  decodeToken,
  generatePasswordResetToken,
  generateEmailVerificationToken,
  generateApiKey,
  generateSecretKey,
  hashToken,
  isValidToken,
  getTokenExpiration,
  isTokenExpired
};