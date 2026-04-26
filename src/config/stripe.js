const Stripe = require('stripe');
const config = require('./index');
const logger = require('../utils/logger');

// Stripe configuration
let stripeClient = null;
let webhookSecret = null;

const getStripeClient = () => {
  if (!stripeClient && config.STRIPE_SECRET_KEY) {
    stripeClient = new Stripe(config.STRIPE_SECRET_KEY, {
      apiVersion: '2023-10-16',
      maxNetworkRetries: 3,
      timeout: 30000
    });
    logger.info('Stripe client initialized');
  }
  return stripeClient;
};

const getWebhookSecret = () => {
  if (!webhookSecret) {
    webhookSecret = config.STRIPE_WEBHOOK_SECRET;
  }
  return webhookSecret;
};

// Payment Intent operations
const createPaymentIntent = async (amount, currency = 'usd', metadata = {}, customerId = null) => {
  try {
    const stripe = getStripeClient();
    if (!stripe) {
      throw new Error('Stripe not configured');
    }
    
    const params = {
      amount: Math.round(amount * 100), // Convert to cents
      currency: currency.toLowerCase(),
      metadata,
      payment_method_types: ['card']
    };
    
    if (customerId) {
      params.customer = customerId;
    }
    
    const paymentIntent = await stripe.paymentIntents.create(params);
    logger.info(`Payment intent created: ${paymentIntent.id}`);
    
    return {
      id: paymentIntent.id,
      clientSecret: paymentIntent.client_secret,
      amount: paymentIntent.amount / 100,
      currency: paymentIntent.currency,
      status: paymentIntent.status
    };
  } catch (error) {
    logger.error('Stripe create payment intent error:', error);
    throw error;
  }
};

const confirmPaymentIntent = async (paymentIntentId, paymentMethodId = null) => {
  try {
    const stripe = getStripeClient();
    if (!stripe) {
      throw new Error('Stripe not configured');
    }
    
    const params = {};
    if (paymentMethodId) {
      params.payment_method = paymentMethodId;
    }
    
    const paymentIntent = await stripe.paymentIntents.confirm(paymentIntentId, params);
    logger.info(`Payment intent confirmed: ${paymentIntentId}`);
    
    return {
      id: paymentIntent.id,
      status: paymentIntent.status,
      amount: paymentIntent.amount / 100,
      currency: paymentIntent.currency
    };
  } catch (error) {
    logger.error('Stripe confirm payment intent error:', error);
    throw error;
  }
};

const retrievePaymentIntent = async (paymentIntentId) => {
  try {
    const stripe = getStripeClient();
    if (!stripe) {
      throw new Error('Stripe not configured');
    }
    
    const paymentIntent = await stripe.paymentIntents.retrieve(paymentIntentId);
    return {
      id: paymentIntent.id,
      status: paymentIntent.status,
      amount: paymentIntent.amount / 100,
      currency: paymentIntent.currency,
      metadata: paymentIntent.metadata
    };
  } catch (error) {
    logger.error('Stripe retrieve payment intent error:', error);
    return null;
  }
};

const cancelPaymentIntent = async (paymentIntentId) => {
  try {
    const stripe = getStripeClient();
    if (!stripe) {
      throw new Error('Stripe not configured');
    }
    
    const paymentIntent = await stripe.paymentIntents.cancel(paymentIntentId);
    logger.info(`Payment intent cancelled: ${paymentIntentId}`);
    return true;
  } catch (error) {
    logger.error('Stripe cancel payment intent error:', error);
    return false;
  }
};

// Refund operations
const createRefund = async (paymentIntentId, amount = null) => {
  try {
    const stripe = getStripeClient();
    if (!stripe) {
      throw new Error('Stripe not configured');
    }
    
    const params = { payment_intent: paymentIntentId };
    if (amount) {
      params.amount = Math.round(amount * 100);
    }
    
    const refund = await stripe.refunds.create(params);
    logger.info(`Refund created: ${refund.id}`);
    
    return {
      id: refund.id,
      amount: refund.amount / 100,
      status: refund.status,
      paymentIntent: refund.payment_intent
    };
  } catch (error) {
    logger.error('Stripe create refund error:', error);
    throw error;
  }
};

// Customer operations
const createCustomer = async (email, name, metadata = {}) => {
  try {
    const stripe = getStripeClient();
    if (!stripe) {
      throw new Error('Stripe not configured');
    }
    
    const customer = await stripe.customers.create({
      email,
      name,
      metadata
    });
    
    logger.info(`Customer created: ${customer.id}`);
    return customer;
  } catch (error) {
    logger.error('Stripe create customer error:', error);
    throw error;
  }
};

const retrieveCustomer = async (customerId) => {
  try {
    const stripe = getStripeClient();
    if (!stripe) {
      throw new Error('Stripe not configured');
    }
    
    return await stripe.customers.retrieve(customerId);
  } catch (error) {
    logger.error('Stripe retrieve customer error:', error);
    return null;
  }
};

// Webhook handling
const constructWebhookEvent = (payload, signature) => {
  try {
    const stripe = getStripeClient();
    const webhookSecret = getWebhookSecret();
    
    if (!stripe || !webhookSecret) {
      throw new Error('Stripe webhook not configured');
    }
    
    const event = stripe.webhooks.constructEvent(payload, signature, webhookSecret);
    return event;
  } catch (error) {
    logger.error('Stripe webhook construction error:', error);
    throw error;
  }
};

// Checkout session
const createCheckoutSession = async (lineItems, successUrl, cancelUrl, customerId = null) => {
  try {
    const stripe = getStripeClient();
    if (!stripe) {
      throw new Error('Stripe not configured');
    }
    
    const params = {
      payment_method_types: ['card'],
      line_items: lineItems,
      mode: 'payment',
      success_url: successUrl,
      cancel_url: cancelUrl
    };
    
    if (customerId) {
      params.customer = customerId;
    }
    
    const session = await stripe.checkout.sessions.create(params);
    return {
      id: session.id,
      url: session.url
    };
  } catch (error) {
    logger.error('Stripe create checkout session error:', error);
    throw error;
  }
};

// Health check
const checkStripeHealth = async () => {
  try {
    const stripe = getStripeClient();
    if (!stripe) {
      return { status: 'not_configured' };
    }
    
    await stripe.balance.retrieve();
    return { status: 'healthy' };
  } catch (error) {
    logger.error('Stripe health check failed:', error);
    return { status: 'unhealthy', error: error.message };
  }
};

module.exports = {
  getStripeClient,
  getWebhookSecret,
  createPaymentIntent,
  confirmPaymentIntent,
  retrievePaymentIntent,
  cancelPaymentIntent,
  createRefund,
  createCustomer,
  retrieveCustomer,
  constructWebhookEvent,
  createCheckoutSession,
  checkStripeHealth
};