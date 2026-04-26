const AWS = require('aws-sdk');
const config = require('./index');
const logger = require('../utils/logger');

// AWS configuration
const awsConfig = {
  accessKeyId: config.AWS_ACCESS_KEY_ID,
  secretAccessKey: config.AWS_SECRET_ACCESS_KEY,
  region: config.AWS_REGION,
  signatureVersion: 'v4',
  maxRetries: 3,
  retryDelayOptions: { base: 300 }
};

// Initialize AWS services
let s3Client = null;
let sesClient = null;
let snsClient = null;

const getS3Client = () => {
  if (!s3Client && awsConfig.accessKeyId && awsConfig.secretAccessKey) {
    AWS.config.update(awsConfig);
    s3Client = new AWS.S3();
    logger.info('AWS S3 client initialized');
  }
  return s3Client;
};

const getSESClient = () => {
  if (!sesClient && awsConfig.accessKeyId && awsConfig.secretAccessKey) {
    AWS.config.update(awsConfig);
    sesClient = new AWS.SES();
    logger.info('AWS SES client initialized');
  }
  return sesClient;
};

const getSNSClient = () => {
  if (!snsClient && awsConfig.accessKeyId && awsConfig.secretAccessKey) {
    AWS.config.update(awsConfig);
    snsClient = new AWS.SNS();
    logger.info('AWS SNS client initialized');
  }
  return snsClient;
};

// S3 Operations
const uploadToS3 = async (file, key, options = {}) => {
  try {
    const s3 = getS3Client();
    if (!s3) {
      throw new Error('AWS S3 not configured');
    }
    
    const params = {
      Bucket: config.AWS_S3_BUCKET,
      Key: key,
      Body: file.buffer || file,
      ContentType: file.mimetype || 'application/octet-stream',
      ACL: options.acl || 'private',
      ...options
    };
    
    const result = await s3.upload(params).promise();
    logger.info(`File uploaded to S3: ${result.Key}`);
    return {
      url: result.Location,
      key: result.Key,
      bucket: result.Bucket
    };
  } catch (error) {
    logger.error('S3 upload error:', error);
    throw error;
  }
};

const getFromS3 = async (key) => {
  try {
    const s3 = getS3Client();
    if (!s3) {
      throw new Error('AWS S3 not configured');
    }
    
    const params = {
      Bucket: config.AWS_S3_BUCKET,
      Key: key
    };
    
    const result = await s3.getObject(params).promise();
    return result.Body;
  } catch (error) {
    logger.error(`S3 get error for key ${key}:`, error);
    return null;
  }
};

const deleteFromS3 = async (key) => {
  try {
    const s3 = getS3Client();
    if (!s3) {
      throw new Error('AWS S3 not configured');
    }
    
    const params = {
      Bucket: config.AWS_S3_BUCKET,
      Key: key
    };
    
    await s3.deleteObject(params).promise();
    logger.info(`File deleted from S3: ${key}`);
    return true;
  } catch (error) {
    logger.error(`S3 delete error for key ${key}:`, error);
    return false;
  }
};

const getSignedUrl = async (key, expiresIn = 3600) => {
  try {
    const s3 = getS3Client();
    if (!s3) {
      throw new Error('AWS S3 not configured');
    }
    
    const params = {
      Bucket: config.AWS_S3_BUCKET,
      Key: key,
      Expires: expiresIn
    };
    
    const url = await s3.getSignedUrlPromise('getObject', params);
    return url;
  } catch (error) {
    logger.error(`S3 signed URL error for key ${key}:`, error);
    return null;
  }
};

const listS3Objects = async (prefix = '') => {
  try {
    const s3 = getS3Client();
    if (!s3) {
      throw new Error('AWS S3 not configured');
    }
    
    const params = {
      Bucket: config.AWS_S3_BUCKET,
      Prefix: prefix
    };
    
    const result = await s3.listObjectsV2(params).promise();
    return result.Contents || [];
  } catch (error) {
    logger.error(`S3 list error for prefix ${prefix}:`, error);
    return [];
  }
};

// SES Operations (Email)
const sendEmailViaSES = async (to, subject, html, from = null) => {
  try {
    const ses = getSESClient();
    if (!ses) {
      throw new Error('AWS SES not configured');
    }
    
    const params = {
      Source: from || config.EMAIL_FROM,
      Destination: {
        ToAddresses: Array.isArray(to) ? to : [to]
      },
      Message: {
        Subject: { Data: subject },
        Body: {
          Html: { Data: html }
        }
      }
    };
    
    const result = await ses.sendEmail(params).promise();
    logger.info(`Email sent via SES: ${result.MessageId}`);
    return result.MessageId;
  } catch (error) {
    logger.error('SES email error:', error);
    throw error;
  }
};

// SNS Operations (SMS/Push)
const sendSMSViaSNS = async (phoneNumber, message) => {
  try {
    const sns = getSNSClient();
    if (!sns) {
      throw new Error('AWS SNS not configured');
    }
    
    const params = {
      Message: message,
      PhoneNumber: phoneNumber,
      MessageAttributes: {
        'AWS.SNS.SMS.SenderID': {
          DataType: 'String',
          StringValue: 'BioDigital'
        },
        'AWS.SNS.SMS.SMSType': {
          DataType: 'String',
          StringValue: 'Transactional'
        }
      }
    };
    
    const result = await sns.publish(params).promise();
    logger.info(`SMS sent via SNS: ${result.MessageId}`);
    return result.MessageId;
  } catch (error) {
    logger.error('SNS SMS error:', error);
    throw error;
  }
};

const publishToSNSTopic = async (topicArn, message, subject = null) => {
  try {
    const sns = getSNSClient();
    if (!sns) {
      throw new Error('AWS SNS not configured');
    }
    
    const params = {
      TopicArn: topicArn,
      Message: typeof message === 'string' ? message : JSON.stringify(message),
      ...(subject && { Subject: subject })
    };
    
    const result = await sns.publish(params).promise();
    logger.info(`Message published to SNS topic: ${result.MessageId}`);
    return result.MessageId;
  } catch (error) {
    logger.error('SNS publish error:', error);
    throw error;
  }
};

// Health check
const checkAWSHealth = async () => {
  try {
    const s3 = getS3Client();
    if (!s3) {
      return { status: 'not_configured' };
    }
    
    await s3.headBucket({ Bucket: config.AWS_S3_BUCKET }).promise();
    return { status: 'healthy' };
  } catch (error) {
    logger.error('AWS health check failed:', error);
    return { status: 'unhealthy', error: error.message };
  }
};

module.exports = {
  awsConfig,
  getS3Client,
  getSESClient,
  getSNSClient,
  uploadToS3,
  getFromS3,
  deleteFromS3,
  getSignedUrl,
  listS3Objects,
  sendEmailViaSES,
  sendSMSViaSNS,
  publishToSNSTopic,
  checkAWSHealth
};