const twilio = require('twilio');
const config = require('./index');
const logger = require('../utils/logger');

// Twilio configuration
let twilioClient = null;
let messagingServiceSid = null;

const getTwilioClient = () => {
  if (!twilioClient && config.TWILIO_ACCOUNT_SID && config.TWILIO_AUTH_TOKEN) {
    twilioClient = twilio(config.TWILIO_ACCOUNT_SID, config.TWILIO_AUTH_TOKEN);
    logger.info('Twilio client initialized');
  }
  return twilioClient;
};

const getMessagingServiceSid = () => {
  if (!messagingServiceSid) {
    messagingServiceSid = config.TWILIO_MESSAGING_SERVICE_SID;
  }
  return messagingServiceSid;
};

// SMS operations
const sendSMS = async (to, body, from = null) => {
  try {
    const client = getTwilioClient();
    if (!client) {
      throw new Error('Twilio not configured');
    }
    
    const params = {
      body,
      to,
      from: from || config.TWILIO_PHONE_NUMBER
    };
    
    const message = await client.messages.create(params);
    logger.info(`SMS sent: ${message.sid}`);
    
    return {
      sid: message.sid,
      status: message.status,
      to: message.to,
      from: message.from
    };
  } catch (error) {
    logger.error('Twilio SMS error:', error);
    throw error;
  }
};

const sendBulkSMS = async (toNumbers, body, from = null) => {
  try {
    const client = getTwilioClient();
    if (!client) {
      throw new Error('Twilio not configured');
    }
    
    const promises = toNumbers.map(to => 
      client.messages.create({
        body,
        to,
        from: from || config.TWILIO_PHONE_NUMBER
      })
    );
    
    const results = await Promise.all(promises);
    logger.info(`Bulk SMS sent: ${results.length} messages`);
    
    return results.map(message => ({
      sid: message.sid,
      status: message.status,
      to: message.to
    }));
  } catch (error) {
    logger.error('Twilio bulk SMS error:', error);
    throw error;
  }
};

const sendSMSWithMessagingService = async (to, body) => {
  try {
    const client = getTwilioClient();
    const serviceSid = getMessagingServiceSid();
    
    if (!client || !serviceSid) {
      throw new Error('Twilio messaging service not configured');
    }
    
    const message = await client.messages.create({
      body,
      to,
      messagingServiceSid: serviceSid
    });
    
    logger.info(`SMS sent via messaging service: ${message.sid}`);
    return {
      sid: message.sid,
      status: message.status,
      to: message.to
    };
  } catch (error) {
    logger.error('Twilio messaging service SMS error:', error);
    throw error;
  }
};

// WhatsApp operations
const sendWhatsAppMessage = async (to, body, from = null) => {
  try {
    const client = getTwilioClient();
    if (!client) {
      throw new Error('Twilio not configured');
    }
    
    const message = await client.messages.create({
      body,
      from: from || `whatsapp:${config.TWILIO_PHONE_NUMBER}`,
      to: `whatsapp:${to}`
    });
    
    logger.info(`WhatsApp message sent: ${message.sid}`);
    return {
      sid: message.sid,
      status: message.status,
      to: message.to
    };
  } catch (error) {
    logger.error('Twilio WhatsApp error:', error);
    throw error;
  }
};

// Voice operations
const makeCall = async (to, twimlUrl, from = null) => {
  try {
    const client = getTwilioClient();
    if (!client) {
      throw new Error('Twilio not configured');
    }
    
    const call = await client.calls.create({
      url: twimlUrl,
      to,
      from: from || config.TWILIO_PHONE_NUMBER
    });
    
    logger.info(`Call initiated: ${call.sid}`);
    return {
      sid: call.sid,
      status: call.status,
      to: call.to
    };
  } catch (error) {
    logger.error('Twilio call error:', error);
    throw error;
  }
};

// Verify Service (2FA)
let verifyService = null;

const getVerifyService = () => {
  const client = getTwilioClient();
  if (!verifyService && client) {
    verifyService = client.verify.services;
  }
  return verifyService;
};

const sendVerificationCode = async (to, channel = 'sms') => {
  try {
    const verify = getVerifyService();
    if (!verify) {
      throw new Error('Twilio verify service not configured');
    }
    
    const verification = await verify.verifications.create({
      to,
      channel
    });
    
    logger.info(`Verification code sent to ${to}: ${verification.sid}`);
    return verification;
  } catch (error) {
    logger.error('Twilio verification send error:', error);
    throw error;
  }
};

const checkVerificationCode = async (to, code) => {
  try {
    const verify = getVerifyService();
    if (!verify) {
      throw new Error('Twilio verify service not configured');
    }
    
    const verificationCheck = await verify.verificationChecks.create({
      to,
      code
    });
    
    return verificationCheck.status === 'approved';
  } catch (error) {
    logger.error('Twilio verification check error:', error);
    return false;
  }
};

// Lookup phone number
const lookupPhoneNumber = async (phoneNumber) => {
  try {
    const client = getTwilioClient();
    if (!client) {
      throw new Error('Twilio not configured');
    }
    
    const lookup = await client.lookups.phoneNumbers(phoneNumber).fetch();
    return {
      countryCode: lookup.countryCode,
      phoneNumber: lookup.phoneNumber,
      nationalFormat: lookup.nationalFormat,
      carrier: lookup.carrier
    };
  } catch (error) {
    logger.error('Twilio lookup error:', error);
    return null;
  }
};

// Health check
const checkTwilioHealth = async () => {
  try {
    const client = getTwilioClient();
    if (!client) {
      return { status: 'not_configured' };
    }
    
    const account = await client.api.accounts(config.TWILIO_ACCOUNT_SID).fetch();
    return { status: 'healthy', accountStatus: account.status };
  } catch (error) {
    logger.error('Twilio health check failed:', error);
    return { status: 'unhealthy', error: error.message };
  }
};

module.exports = {
  getTwilioClient,
  getMessagingServiceSid,
  sendSMS,
  sendBulkSMS,
  sendSMSWithMessagingService,
  sendWhatsAppMessage,
  makeCall,
  sendVerificationCode,
  checkVerificationCode,
  lookupPhoneNumber,
  checkTwilioHealth
};