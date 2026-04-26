const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);
const config = require('../config');
const logger = require('../utils/logger');

class PaymentService {
  constructor() {
    this.stripe = stripe;
  }

  async createPaymentIntent(amount, currency = 'usd', metadata = {}) {
    try {
      const paymentIntent = await this.stripe.paymentIntents.create({
        amount: Math.round(amount * 100), // Convert to cents
        currency,
        metadata,
        payment_method_types: ['card', 'mobile_pay']
      });
      
      return {
        clientSecret: paymentIntent.client_secret,
        paymentIntentId: paymentIntent.id
      };
    } catch (error) {
      logger.error('Stripe payment intent error:', error);
      throw error;
    }
  }

  async confirmPayment(paymentIntentId) {
    try {
      const paymentIntent = await this.stripe.paymentIntents.confirm(paymentIntentId);
      return {
        status: paymentIntent.status,
        amount: paymentIntent.amount / 100,
        currency: paymentIntent.currency
      };
    } catch (error) {
      logger.error('Payment confirmation error:', error);
      throw error;
    }
  }

  async processMobileMoney(phoneNumber, amount, provider, orderId) {
    // This is a mock implementation. In production, integrate with actual mobile money APIs
    // like MTN MoMo, Vodafone Cash, AirtelTigo Money, etc.
    
    try {
      // Simulate API call
      logger.info(`Processing mobile money payment: ${provider} ${phoneNumber} for $${amount}`);
      
      // Mock response
      const transactionId = `MM-${Date.now()}-${Math.random().toString(36).substr(2, 6)}`;
      
      return {
        success: true,
        transactionId,
        status: 'COMPLETED',
        message: 'Payment processed successfully'
      };
    } catch (error) {
      logger.error('Mobile money payment error:', error);
      return {
        success: false,
        message: 'Payment failed. Please try again.'
      };
    }
  }

  async processBankTransfer(orderId, accountDetails) {
    // Mock implementation for bank transfer
    try {
      logger.info(`Processing bank transfer for order ${orderId}`);
      
      return {
        success: true,
        reference: `BT-${Date.now()}`,
        status: 'PENDING',
        message: 'Bank transfer initiated. Awaiting confirmation.'
      };
    } catch (error) {
      logger.error('Bank transfer error:', error);
      throw error;
    }
  }

  async refundPayment(paymentIntentId, amount = null) {
    try {
      const refundParams = { payment_intent: paymentIntentId };
      if (amount) {
        refundParams.amount = Math.round(amount * 100);
      }
      
      const refund = await this.stripe.refunds.create(refundParams);
      
      return {
        success: true,
        refundId: refund.id,
        amount: refund.amount / 100,
        status: refund.status
      };
    } catch (error) {
      logger.error('Refund error:', error);
      throw error;
    }
  }

  async getPaymentStatus(paymentIntentId) {
    try {
      const paymentIntent = await this.stripe.paymentIntents.retrieve(paymentIntentId);
      return {
        status: paymentIntent.status,
        amount: paymentIntent.amount / 100,
        currency: paymentIntent.currency,
        paymentMethod: paymentIntent.payment_method_types[0]
      };
    } catch (error) {
      logger.error('Get payment status error:', error);
      return null;
    }
  }

  async createPaymentLink(order, amount, currency = 'usd') {
    try {
      const session = await this.stripe.checkout.sessions.create({
        payment_method_types: ['card'],
        line_items: [
          {
            price_data: {
              currency: currency.toLowerCase(),
              product_data: {
                name: `Order #${order.orderNumber}`,
                description: `Payment for order ${order.orderNumber}`,
              },
              unit_amount: Math.round(amount * 100),
            },
            quantity: 1,
          },
        ],
        mode: 'payment',
        success_url: `${config.API_URL}/api/payments/success?session_id={CHECKOUT_SESSION_ID}`,
        cancel_url: `${config.API_URL}/api/payments/cancel`,
        metadata: {
          orderId: order.id,
          orderNumber: order.orderNumber
        }
      });
      
      return {
        paymentUrl: session.url,
        sessionId: session.id
      };
    } catch (error) {
      logger.error('Create payment link error:', error);
      throw error;
    }
  }

  async handleWebhook(signature, payload) {
    try {
      const webhookSecret = config.STRIPE_WEBHOOK_SECRET;
      const event = this.stripe.webhooks.constructEvent(payload, signature, webhookSecret);
      
      switch (event.type) {
        case 'payment_intent.succeeded':
          const paymentIntent = event.data.object;
          logger.info('Payment succeeded:', paymentIntent.id);
          return { type: 'PAYMENT_SUCCEEDED', data: paymentIntent };
          
        case 'payment_intent.payment_failed':
          const failedPayment = event.data.object;
          logger.info('Payment failed:', failedPayment.id);
          return { type: 'PAYMENT_FAILED', data: failedPayment };
          
        case 'charge.refunded':
          const refund = event.data.object;
          logger.info('Payment refunded:', refund.id);
          return { type: 'PAYMENT_REFUNDED', data: refund };
          
        default:
          logger.info(`Unhandled event type: ${event.type}`);
          return { type: 'UNHANDLED', data: event };
      }
    } catch (error) {
      logger.error('Webhook handling error:', error);
      throw error;
    }
  }
}

module.exports = new PaymentService();