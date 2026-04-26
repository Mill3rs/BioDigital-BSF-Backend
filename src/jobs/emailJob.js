const Queue = require('bull');
const nodemailer = require('nodemailer');
const config = require('../config');
const logger = require('../utils/logger');
const { prisma } = require('../config/database');

// Create queue
const emailQueue = new Queue('email-processing', {
  redis: {
    host: process.env.REDIS_HOST || 'localhost',
    port: parseInt(process.env.REDIS_PORT, 10) || 6379,
    password: process.env.REDIS_PASSWORD
  },
  defaultJobOptions: {
    attempts: 5,
    backoff: {
      type: 'exponential',
      delay: 5000
    },
    removeOnComplete: 100,
    removeOnFail: 500
  }
});

// Email transporter
let transporter = null;

const getTransporter = () => {
  if (!transporter && config.SMTP_HOST && config.SMTP_USER) {
    transporter = nodemailer.createTransport({
      host: config.SMTP_HOST,
      port: config.SMTP_PORT,
      secure: config.SMTP_SECURE,
      auth: {
        user: config.SMTP_USER,
        pass: config.SMTP_PASS
      },
      pool: true,
      maxConnections: 5,
      maxMessages: 100
    });
  }
  return transporter;
};

// Email templates
const emailTemplates = {
  welcome: (data) => ({
    subject: 'Welcome to BioDigital BSF!',
    html: `
      <h1>Welcome ${data.fullName}!</h1>
      <p>Thank you for joining BioDigital BSF Farm Management System.</p>
      <p>Get started by:</p>
      <ul>
        <li>Completing your profile</li>
        <li>Adding your farm</li>
        <li>Recording waste</li>
      </ul>
      <a href="${config.CLIENT_URL}/dashboard">Go to Dashboard</a>
    `
  }),
  
  verification: (data) => ({
    subject: 'Verify Your Email Address',
    html: `
      <h1>Email Verification</h1>
      <p>Please verify your email address by clicking the link below:</p>
      <a href="${config.CLIENT_URL}/verify-email?token=${data.token}">Verify Email</a>
      <p>This link expires in 24 hours.</p>
    `
  }),
  
  passwordReset: (data) => ({
    subject: 'Reset Your Password',
    html: `
      <h1>Password Reset Request</h1>
      <p>Click the link below to reset your password:</p>
      <a href="${config.CLIENT_URL}/reset-password?token=${data.token}">Reset Password</a>
      <p>This link expires in 1 hour.</p>
      <p>If you didn't request this, please ignore this email.</p>
    `
  }),
  
  orderConfirmation: (data) => ({
    subject: `Order Confirmation #${data.order.orderNumber}`,
    html: `
      <h1>Order Confirmed!</h1>
      <p>Thank you for your order, ${data.customerName}.</p>
      <h2>Order Details</h2>
      <p><strong>Order Number:</strong> ${data.order.orderNumber}</p>
      <p><strong>Total Amount:</strong> $${data.order.total}</p>
      <p><strong>Payment Method:</strong> ${data.order.paymentMethod}</p>
      <h3>Items</h3>
      <ul>
        ${data.order.items.map(item => `
          <li>${item.quantity}x ${item.productName} - $${item.subtotal}</li>
        `).join('')}
      </ul>
      <a href="${config.CLIENT_URL}/orders/${data.order.id}">View Order</a>
    `
  }),
  
  orderShipped: (data) => ({
    subject: `Order Shipped #${data.order.orderNumber}`,
    html: `
      <h1>Your Order Has Been Shipped!</h1>
      <p>Good news! Your order #${data.order.orderNumber} is on its way.</p>
      ${data.trackingNumber ? `<p><strong>Tracking Number:</strong> ${data.trackingNumber}</p>` : ''}
      <a href="${config.CLIENT_URL}/orders/${data.order.id}">Track Order</a>
    `
  }),
  
  orderDelivered: (data) => ({
    subject: `Order Delivered #${data.order.orderNumber}`,
    html: `
      <h1>Order Delivered!</h1>
      <p>Your order #${data.order.orderNumber} has been delivered.</p>
      <p>Thank you for shopping with us!</p>
      <a href="${config.CLIENT_URL}/orders/${data.order.id}">Leave a Review</a>
    `
  }),
  
  wasteCollection: (data) => ({
    subject: 'Waste Collection Scheduled',
    html: `
      <h1>Waste Collection Scheduled</h1>
      <p>A waste collection has been scheduled:</p>
      <p><strong>Source:</strong> ${data.wasteRecord.sourceName}</p>
      <p><strong>Quantity:</strong> ${data.wasteRecord.quantity} ${data.wasteRecord.unit}</p>
      <p><strong>Date:</strong> ${new Date(data.wasteRecord.date).toLocaleString()}</p>
      ${data.driverName ? `<p><strong>Driver:</strong> ${data.driverName}</p>` : ''}
    `
  }),
  
  batchComplete: (data) => ({
    subject: `Processing Batch Complete - ${data.batch.batchNumber}`,
    html: `
      <h1>Processing Batch Complete!</h1>
      <p>Batch ${data.batch.batchNumber} has been completed.</p>
      <h2>Results</h2>
      <ul>
        <li><strong>Input Waste:</strong> ${data.batch.quantity} kg</li>
        <li><strong>Fertilizer Output:</strong> ${data.batch.fertilizerOutput || 0} kg</li>
        <li><strong>Liquid Output:</strong> ${data.batch.liquidOutput || 0} L</li>
        <li><strong>Conversion Rate:</strong> ${data.batch.conversionRate || 0}%</li>
      </ul>
      <a href="${config.CLIENT_URL}/batches/${data.batch.id}">View Details</a>
    `
  }),
  
  reportReady: (data) => ({
    subject: `Your Report is Ready - ${data.report.title}`,
    html: `
      <h1>Report Ready for Download</h1>
      <p>Your requested report "${data.report.title}" is now ready.</p>
      <a href="${config.API_URL}/api/reports/${data.report.id}/download">Download Report</a>
      <p>This link expires in 7 days.</p>
    `
  }),
  
  lowStock: (data) => ({
    subject: 'Low Stock Alert',
    html: `
      <h1>Low Stock Alert</h1>
      <p>The following products are running low:</p>
      <ul>
        ${data.products.map(product => `
          <li><strong>${product.name}</strong> - Only ${product.quantity} left</li>
        `).join('')}
      </ul>
      <a href="${config.CLIENT_URL}/products">Restock Now</a>
    `
  })
};

// Process email jobs
emailQueue.process(async (job) => {
  const { type, to, data, priority = 'normal' } = job.data;
  
  logger.info(`Processing email job: ${type} to ${to}`);
  
  const transporter = getTransporter();
  if (!transporter) {
    throw new Error('Email transporter not configured');
  }
  
  const template = emailTemplates[type];
  if (!template) {
    throw new Error(`Unknown email template: ${type}`);
  }
  
  const { subject, html } = template(data);
  
  const mailOptions = {
    from: config.EMAIL_FROM,
    to,
    subject,
    html,
    priority: priority === 'high' ? 'high' : 'normal'
  };
  
  const info = await transporter.sendMail(mailOptions);
  
  // Log email sent
  await prisma.emailLog.create({
    data: {
      type,
      to,
      subject,
      messageId: info.messageId,
      sentAt: new Date(),
      metadata: data
    }
  });
  
  logger.info(`Email sent: ${info.messageId}`);
  
  return { messageId: info.messageId, sent: true };
});

// Queue event handlers
emailQueue.on('completed', (job, result) => {
  logger.info(`Email job ${job.id} completed: ${result.messageId}`);
});

emailQueue.on('failed', (job, error) => {
  logger.error(`Email job ${job.id} failed:`, error);
  
  // Log failed email
  prisma.emailLog.create({
    data: {
      type: job.data.type,
      to: job.data.to,
      subject: 'Failed Email',
      error: error.message,
      sentAt: null,
      metadata: job.data.data
    }
  }).catch(console.error);
});

// Add email to queue
const sendEmail = async (type, to, data, priority = 'normal') => {
  const job = await emailQueue.add({
    type,
    to,
    data,
    priority
  }, {
    priority: priority === 'high' ? 1 : 3
  });
  
  return job;
};

// Batch send emails
const sendBatchEmails = async (emails) => {
  const jobs = await Promise.all(
    emails.map(email => sendEmail(email.type, email.to, email.data, email.priority))
  );
  
  return jobs;
};

// Get queue stats
const getEmailQueueStats = async () => {
  const [waiting, active, completed, failed] = await Promise.all([
    emailQueue.getWaitingCount(),
    emailQueue.getActiveCount(),
    emailQueue.getCompletedCount(),
    emailQueue.getFailedCount()
  ]);
  
  return { waiting, active, completed, failed };
};

module.exports = {
  emailQueue,
  sendEmail,
  sendBatchEmails,
  getEmailQueueStats
};