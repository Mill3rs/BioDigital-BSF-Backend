const twilio = require('twilio');
const config = require('../config');
const logger = require('../utils/logger');

class SMSService {
  constructor() {
    this.client = null;
    this.fromNumber = config.TWILIO_PHONE_NUMBER;
    
    if (config.TWILIO_ACCOUNT_SID && config.TWILIO_AUTH_TOKEN) {
      this.client = twilio(config.TWILIO_ACCOUNT_SID, config.TWILIO_AUTH_TOKEN);
      logger.info('SMS service initialized');
    } else {
      logger.warn('SMS service not configured. SMS sending disabled.');
    }
  }

  async sendSMS(to, message) {
    if (!this.client) {
      logger.warn('SMS service not configured. Message not sent:', { to, message });
      return false;
    }

    try {
      const formattedNumber = this.formatPhoneNumber(to);
      
      const result = await this.client.messages.create({
        body: message,
        to: formattedNumber,
        from: this.fromNumber
      });
      
      logger.info('SMS sent successfully:', { to, sid: result.sid });
      return true;
    } catch (error) {
      logger.error('Failed to send SMS:', error);
      return false;
    }
  }

  async sendBulkSMS(numbers, message) {
    const results = await Promise.all(
      numbers.map(number => this.sendSMS(number, message))
    );
    
    return {
      total: numbers.length,
      successful: results.filter(r => r === true).length,
      failed: results.filter(r => r === false).length
    };
  }

  async sendWasteCollectionNotification(phoneNumber, wasteRecord) {
    const message = `BioDigital BSF: Waste collection scheduled for ${wasteRecord.quantity}${wasteRecord.unit} from ${wasteRecord.sourceName} on ${new Date(wasteRecord.date).toLocaleDateString()}.`;
    return this.sendSMS(phoneNumber, message);
  }

  async sendOrderConfirmation(phoneNumber, order) {
    const message = `BioDigital BSF: Your order #${order.orderNumber} has been confirmed. Total: $${order.total.toFixed(2)}. We'll notify you when it ships.`;
    return this.sendSMS(phoneNumber, message);
  }

  async sendDeliveryUpdate(phoneNumber, order, status) {
    let message;
    switch (status) {
      case 'SHIPPED':
        message = `BioDigital BSF: Your order #${order.orderNumber} has been shipped and is on its way!`;
        break;
      case 'OUT_FOR_DELIVERY':
        message = `BioDigital BSF: Your order #${order.orderNumber} is out for delivery!`;
        break;
      case 'DELIVERED':
        message = `BioDigital BSF: Your order #${order.orderNumber} has been delivered. Thank you for shopping with us!`;
        break;
      default:
        return false;
    }
    
    return this.sendSMS(phoneNumber, message);
  }

  async sendVerificationCode(phoneNumber, code) {
    const message = `BioDigital BSF: Your verification code is: ${code}. This code will expire in 10 minutes.`;
    return this.sendSMS(phoneNumber, message);
  }

  async sendAlert(phoneNumber, alertType, message) {
    const formattedMessage = `BioDigital BSF Alert [${alertType}]: ${message}`;
    return this.sendSMS(phoneNumber, formattedMessage);
  }

  formatPhoneNumber(phoneNumber) {
    // Remove any non-digit characters
    let cleaned = phoneNumber.replace(/\D/g, '');
    
    // Add country code if missing (assuming Ghana +233)
    if (cleaned.length === 9) {
      cleaned = '233' + cleaned;
    }
    
    // Add plus sign
    return '+' + cleaned;
  }

  generateVerificationCode() {
    return Math.floor(100000 + Math.random() * 900000).toString();
  }
}

module.exports = new SMSService();