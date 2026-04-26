const crypto = require('crypto');
const bcrypt = require('bcryptjs');

// Encryption algorithm
const ALGORITHM = 'aes-256-gcm';
const IV_LENGTH = 16;
const SALT_LENGTH = 64;
const KEY_LENGTH = 32;
const TAG_LENGTH = 16;

// Get encryption key from environment or generate
const getEncryptionKey = () => {
  let key = process.env.ENCRYPTION_KEY;
  if (!key) {
    // In production, you should have this set in environment
    console.warn('ENCRYPTION_KEY not set, using generated key (not secure for production)');
    key = crypto.randomBytes(KEY_LENGTH).toString('hex');
  }
  return Buffer.from(key, 'hex');
};

// Encrypt text
const encrypt = (text) => {
  if (!text) return null;
  
  const iv = crypto.randomBytes(IV_LENGTH);
  const cipher = crypto.createCipheriv(ALGORITHM, getEncryptionKey(), iv);
  
  let encrypted = cipher.update(text, 'utf8', 'hex');
  encrypted += cipher.final('hex');
  
  const tag = cipher.getAuthTag();
  
  return {
    encrypted: encrypted,
    iv: iv.toString('hex'),
    tag: tag.toString('hex')
  };
};

// Decrypt text
const decrypt = (encryptedData) => {
  if (!encryptedData || !encryptedData.encrypted) return null;
  
  const iv = Buffer.from(encryptedData.iv, 'hex');
  const tag = Buffer.from(encryptedData.tag, 'hex');
  const decipher = crypto.createDecipheriv(ALGORITHM, getEncryptionKey(), iv);
  
  decipher.setAuthTag(tag);
  
  let decrypted = decipher.update(encryptedData.encrypted, 'hex', 'utf8');
  decrypted += decipher.final('utf8');
  
  return decrypted;
};

// Hash password
const hashPassword = async (password) => {
  if (!password) return null;
  const salt = await bcrypt.genSalt(10);
  return bcrypt.hash(password, salt);
};

// Compare password
const comparePassword = async (password, hash) => {
  if (!password || !hash) return false;
  return bcrypt.compare(password, hash);
};

// Generate random token
const generateRandomToken = (length = 32) => {
  return crypto.randomBytes(length).toString('hex');
};

// Generate OTP
const generateOTP = (length = 6) => {
  const digits = '0123456789';
  let otp = '';
  for (let i = 0; i < length; i++) {
    otp += digits[Math.floor(Math.random() * digits.length)];
  }
  return otp;
};

// Hash data (SHA256)
const hashData = (data) => {
  return crypto.createHash('sha256').update(data).digest('hex');
};

// Hash data with salt (HMAC)
const hmacHash = (data, secret) => {
  return crypto.createHmac('sha256', secret).update(data).digest('hex');
};

// Generate salt
const generateSalt = (length = SALT_LENGTH) => {
  return crypto.randomBytes(length).toString('hex');
};

// Derive key from password
const deriveKey = (password, salt, iterations = 100000, keyLength = KEY_LENGTH) => {
  return crypto.pbkdf2Sync(password, salt, iterations, keyLength, 'sha256');
};

// Encrypt with password (using PBKDF2)
const encryptWithPassword = (text, password) => {
  const salt = generateSalt();
  const key = deriveKey(password, salt);
  const iv = crypto.randomBytes(IV_LENGTH);
  const cipher = crypto.createCipheriv(ALGORITHM, key, iv);
  
  let encrypted = cipher.update(text, 'utf8', 'hex');
  encrypted += cipher.final('hex');
  
  const tag = cipher.getAuthTag();
  
  return {
    encrypted,
    iv: iv.toString('hex'),
    tag: tag.toString('hex'),
    salt: salt.toString('hex')
  };
};

// Decrypt with password
const decryptWithPassword = (encryptedData, password) => {
  const salt = Buffer.from(encryptedData.salt, 'hex');
  const key = deriveKey(password, salt);
  const iv = Buffer.from(encryptedData.iv, 'hex');
  const tag = Buffer.from(encryptedData.tag, 'hex');
  const decipher = crypto.createDecipheriv(ALGORITHM, key, iv);
  
  decipher.setAuthTag(tag);
  
  let decrypted = decipher.update(encryptedData.encrypted, 'hex', 'utf8');
  decrypted += decipher.final('utf8');
  
  return decrypted;
};

// Mask sensitive data
const maskData = (data, visibleStart = 2, visibleEnd = 2, maskChar = '*') => {
  if (!data) return null;
  const str = data.toString();
  if (str.length <= visibleStart + visibleEnd) {
    return maskChar.repeat(str.length);
  }
  const start = str.substring(0, visibleStart);
  const end = str.substring(str.length - visibleEnd);
  const middle = maskChar.repeat(str.length - visibleStart - visibleEnd);
  return start + middle + end;
};

// Mask email
const maskEmail = (email) => {
  if (!email) return null;
  const [local, domain] = email.split('@');
  if (local.length <= 2) {
    return `***@${domain}`;
  }
  const maskedLocal = local[0] + '*'.repeat(local.length - 2) + local[local.length - 1];
  return `${maskedLocal}@${domain}`;
};

// Mask phone number
const maskPhone = (phone) => {
  if (!phone) return null;
  const cleaned = phone.replace(/\D/g, '');
  if (cleaned.length <= 6) {
    return '*'.repeat(cleaned.length);
  }
  const start = cleaned.substring(0, 3);
  const end = cleaned.substring(cleaned.length - 3);
  const middle = '*'.repeat(cleaned.length - 6);
  return `${start}${middle}${end}`;
};

// Encrypt API key
const encryptApiKey = (apiKey) => {
  return encrypt(apiKey);
};

// Decrypt API key
const decryptApiKey = (encryptedApiKey) => {
  return decrypt(encryptedApiKey);
};

// Generate API signature
const generateApiSignature = (method, path, timestamp, body, secret) => {
  const data = `${method}${path}${timestamp}${JSON.stringify(body)}`;
  return hmacHash(data, secret);
};

// Verify API signature
const verifyApiSignature = (signature, method, path, timestamp, body, secret) => {
  const expectedSignature = generateApiSignature(method, path, timestamp, body, secret);
  return crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expectedSignature));
};

// Encrypt webhook payload
const encryptWebhookPayload = (payload, webhookSecret) => {
  const payloadString = JSON.stringify(payload);
  return encryptWithPassword(payloadString, webhookSecret);
};

// Decrypt webhook payload
const decryptWebhookPayload = (encryptedPayload, webhookSecret) => {
  const decrypted = decryptWithPassword(encryptedPayload, webhookSecret);
  return JSON.parse(decrypted);
};

module.exports = {
  encrypt,
  decrypt,
  hashPassword,
  comparePassword,
  generateRandomToken,
  generateOTP,
  hashData,
  hmacHash,
  generateSalt,
  deriveKey,
  encryptWithPassword,
  decryptWithPassword,
  maskData,
  maskEmail,
  maskPhone,
  encryptApiKey,
  decryptApiKey,
  generateApiSignature,
  verifyApiSignature,
  encryptWebhookPayload,
  decryptWebhookPayload
};