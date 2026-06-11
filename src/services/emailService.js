const nodemailer = require('nodemailer');
const config = require('../config');
const logger = require('../utils/logger');

class EmailService {
  constructor() {
    this.transporter = null;
    this.initializeTransporter();
  }

  initializeTransporter() {
    if (config.SMTP_HOST && config.SMTP_USER && config.SMTP_PASS) {
      this.transporter = nodemailer.createTransport({
        host: config.SMTP_HOST,
        port: config.SMTP_PORT,
        secure: config.SMTP_SECURE,
        auth: {
          user: config.SMTP_USER,
          pass: config.SMTP_PASS
        }
      });
      
      logger.info('Email service initialized');
    } else {
      logger.warn('Email service not configured. Email sending disabled.');
    }
  }

  async sendEmail(to, subject, html, text = null) {
    if (!this.transporter) {
      logger.warn('Email service not configured. Email not sent:', { to, subject });
      return false;
    }

    try {
      const mailOptions = {
        from: config.EMAIL_FROM,
        to,
        subject,
        html,
        text: text || html.replace(/<[^>]*>/g, '')
      };

      const info = await this.transporter.sendMail(mailOptions);
      logger.info('Email sent successfully:', { to, subject, messageId: info.messageId });
      return true;
    } catch (error) {
      logger.error('Failed to send email:', error);
      return false;
    }
  }

  async sendVerificationEmail(email, token) {
    const verificationUrl = `${config.API_URL}/api/auth/verify-email/${token}`;
    const html = `
      <!DOCTYPE html>
      <html>
      <head>
        <style>
          body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; }
          .container { max-width: 600px; margin: 0 auto; padding: 20px; }
          .header { background-color: #4CAF50; color: white; padding: 20px; text-align: center; }
          .content { padding: 20px; background-color: #f9f9f9; }
          .button { display: inline-block; padding: 12px 24px; background-color: #4CAF50; color: white; text-decoration: none; border-radius: 4px; margin: 20px 0; }
          .footer { text-align: center; padding: 20px; font-size: 12px; color: #666; }
        </style>
      </head>
      <body>
        <div class="container">
          <div class="header">
            <h1>Welcome to BioDigital BSF!</h1>
          </div>
          <div class="content">
            <p>Hello,</p>
            <p>Thank you for registering with BioDigital BSF Farm Management System.</p>
            <p>Please verify your email address by clicking the button below:</p>
            <div style="text-align: center;">
              <a href="${verificationUrl}" class="button">Verify Email Address</a>
            </div>
            <p>Or copy and paste this link into your browser:</p>
            <p>${verificationUrl}</p>
            <p>This link will expire in 24 hours.</p>
            <p>If you didn't create an account, please ignore this email.</p>
          </div>
          <div class="footer">
            <p>&copy; 2024 BioDigital BSF. All rights reserved.</p>
          </div>
        </div>
      </body>
      </html>
    `;
    
    return this.sendEmail(email, 'Verify Your Email Address', html);
  }

  async sendPasswordResetEmail(email, token) {
    const resetUrl = `${config.API_URL}/api/auth/reset-password/${token}`;
    const html = `
      <!DOCTYPE html>
      <html>
      <head>
        <style>
          body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; }
          .container { max-width: 600px; margin: 0 auto; padding: 20px; }
          .header { background-color: #FF9800; color: white; padding: 20px; text-align: center; }
          .content { padding: 20px; background-color: #f9f9f9; }
          .button { display: inline-block; padding: 12px 24px; background-color: #FF9800; color: white; text-decoration: none; border-radius: 4px; margin: 20px 0; }
          .warning { color: #f44336; font-size: 14px; margin-top: 20px; }
        </style>
      </head>
      <body>
        <div class="container">
          <div class="header">
            <h1>Password Reset Request</h1>
          </div>
          <div class="content">
            <p>Hello,</p>
            <p>We received a request to reset your password for your BioDigital BSF account.</p>
            <div style="text-align: center;">
              <a href="${resetUrl}" class="button">Reset Password</a>
            </div>
            <p>Or copy and paste this link into your browser:</p>
            <p>${resetUrl}</p>
            <p>This link will expire in 1 hour.</p>
            <div class="warning">
              <p>If you didn't request a password reset, please ignore this email or contact support.</p>
            </div>
          </div>
          <div class="footer">
            <p>&copy; 2024 BioDigital BSF. All rights reserved.</p>
          </div>
        </div>
      </body>
      </html>
    `;
    
    return this.sendEmail(email, 'Reset Your Password', html);
  }

  async sendOrderConfirmationEmail(email, order) {
    const html = `
      <!DOCTYPE html>
      <html>
      <head>
        <style>
          body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; }
          .container { max-width: 600px; margin: 0 auto; padding: 20px; }
          .header { background-color: #2196F3; color: white; padding: 20px; text-align: center; }
          .content { padding: 20px; background-color: #f9f9f9; }
          .order-details { background-color: white; padding: 15px; border-radius: 4px; margin: 15px 0; }
          table { width: 100%; border-collapse: collapse; }
          th, td { padding: 10px; text-align: left; border-bottom: 1px solid #ddd; }
          .total { font-size: 18px; font-weight: bold; text-align: right; margin-top: 15px; }
        </style>
      </head>
      <body>
        <div class="container">
          <div class="header">
            <h1>Order Confirmation</h1>
          </div>
          <div class="content">
            <p>Hello ${order.customer?.fullName || 'Customer'},</p>
            <p>Thank you for your order! Your order has been confirmed.</p>
            
            <div class="order-details">
              <h3>Order Details</h3>
              <p><strong>Order Number:</strong> ${order.orderNumber}</p>
              <p><strong>Order Date:</strong> ${new Date(order.createdAt).toLocaleString()}</p>
              <p><strong>Payment Method:</strong> ${order.paymentMethod}</p>
              
              <h3>Items Ordered</h3>
              <table>
                <thead>
                  <tr><th>Product</th><th>Quantity</th><th>Price</th><th>Subtotal</th></tr>
                </thead>
                <tbody>
                  ${order.items.map(item => `
                    <tr>
                      <td>${item.variant.product.name} - ${item.variant.name}</td>
                      <td>${item.quantity}</td>
                      <td>$${item.price.toFixed(2)}</td>
                      <td>$${item.subtotal.toFixed(2)}</td>
                    </tr>
                  `).join('')}
                </tbody>
              </table>
              
              <div class="total">
                <p>Subtotal: $${order.subtotal.toFixed(2)}</p>
                <p>Shipping: $${order.shippingCost.toFixed(2)}</p>
                <p>Tax: $${order.tax.toFixed(2)}</p>
                <p><strong>Total: $${order.total.toFixed(2)}</strong></p>
              </div>
            </div>
            
            <h3>Delivery Address</h3>
            <p>${order.deliveryAddress.street}<br>
            ${order.deliveryAddress.city}, ${order.deliveryAddress.region}<br>
            ${order.deliveryAddress.country} - ${order.deliveryAddress.postalCode}</p>
            
            <p>We'll notify you once your order is shipped.</p>
          </div>
          <div class="footer">
            <p>&copy; 2024 BioDigital BSF. All rights reserved.</p>
          </div>
        </div>
      </body>
      </html>
    `;
    
    return this.sendEmail(email, `Order Confirmation #${order.orderNumber}`, html);
  }

  async sendWasteCollectionNotification(email, wasteRecord) {
    const html = `
      <!DOCTYPE html>
      <html>
      <head>
        <style>
          body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; }
          .container { max-width: 600px; margin: 0 auto; padding: 20px; }
          .header { background-color: #8BC34A; color: white; padding: 20px; text-align: center; }
          .content { padding: 20px; background-color: #f9f9f9; }
        </style>
      </head>
      <body>
        <div class="container">
          <div class="header">
            <h1>Waste Collection Scheduled</h1>
          </div>
          <div class="content">
            <p>Hello,</p>
            <p>A waste collection has been scheduled:</p>
            <p><strong>Source:</strong> ${wasteRecord.sourceName}</p>
            <p><strong>Quantity:</strong> ${wasteRecord.quantity} ${wasteRecord.unit}</p>
            <p><strong>Type:</strong> ${wasteRecord.sourceType}</p>
            <p><strong>Date:</strong> ${new Date(wasteRecord.date).toLocaleString()}</p>
            ${wasteRecord.location ? `<p><strong>Location:</strong> ${wasteRecord.location.address || 'See map'}</p>` : ''}
          </div>
          <div class="footer">
            <p>&copy; 2024 BioDigital BSF. All rights reserved.</p>
          </div>
        </div>
      </body>
      </html>
    `;
    
    return this.sendEmail(email, 'Waste Collection Scheduled', html);
  }

  async sendBatchCompletionEmail(email, batch) {
    const html = `
      <!DOCTYPE html>
      <html>
      <head>
        <style>
          body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; }
          .container { max-width: 600px; margin: 0 auto; padding: 20px; }
          .header { background-color: #4CAF50; color: white; padding: 20px; text-align: center; }
          .content { padding: 20px; background-color: #f9f9f9; }
          .stats { background-color: white; padding: 15px; border-radius: 4px; margin: 15px 0; }
        </style>
      </head>
      <body>
        <div class="container">
          <div class="header">
            <h1>Processing Batch Completed</h1>
          </div>
          <div class="content">
            <p>Hello,</p>
            <p>Processing batch <strong>${batch.batchNumber}</strong> has been completed.</p>
            
            <div class="stats">
              <h3>Batch Results</h3>
              <p><strong>Input Waste:</strong> ${batch.quantity} kg</p>
              <p><strong>Liquid Output:</strong> ${batch.liquidOutput || 0} liters</p>
              <p><strong>Fertilizer Output:</strong> ${batch.fertilizerOutput || 0} kg</p>
              <p><strong>Conversion Rate:</strong> ${batch.conversionRate || 0}%</p>
              <p><strong>Duration:</strong> ${Math.ceil((new Date(batch.endDate) - new Date(batch.startDate)) / (1000 * 60 * 60 * 24))} days</p>
            </div>
          </div>
          <div class="footer">
            <p>&copy; 2024 BioDigital BSF. All rights reserved.</p>
          </div>
        </div>
      </body>
      </html>
    `;
    
    return this.sendEmail(email, `Batch ${batch.batchNumber} Completed`, html);
  }

  async sendDriverReviewEmail(email, driverName, { rating, comment, orderNumber }) {
    const stars = '★'.repeat(rating) + '☆'.repeat(5 - rating);
    const html = `
      <!DOCTYPE html>
      <html>
      <head>
        <style>
          body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; }
          .container { max-width: 600px; margin: 0 auto; padding: 20px; }
          .header { background-color: #1a5c2a; color: white; padding: 20px; text-align: center; }
          .content { padding: 20px; background-color: #f9f9f9; }
          .stars { font-size: 28px; color: #f59e0b; letter-spacing: 4px; }
          .comment { background: white; border-left: 4px solid #1a5c2a; padding: 12px 16px; margin: 16px 0; font-style: italic; color: #555; }
          .footer { text-align: center; padding: 20px; font-size: 12px; color: #666; }
        </style>
      </head>
      <body>
        <div class="container">
          <div class="header"><h1>You received a new review!</h1></div>
          <div class="content">
            <p>Hi ${driverName},</p>
            <p>A buyer has rated your delivery for order <strong>#${orderNumber}</strong>.</p>
            <p class="stars">${stars}</p>
            <p><strong>${rating} out of 5 stars</strong></p>
            ${comment ? `<div class="comment">"${comment}"</div>` : ''}
            <p>Thank you for your great service. Keep it up!</p>
          </div>
          <div class="footer"><p>&copy; BioDigital BSF. All rights reserved.</p></div>
        </div>
      </body>
      </html>
    `;
    return this.sendEmail(email, `New delivery review – Order #${orderNumber}`, html);
  }

  // ── Support ticket emails ─────────────────────────────────────────────────

  /**
   * Sent to ADMIN / MANAGER when a new support ticket is submitted.
   */
  async sendSupportTicketAdminEmail(email, adminName, ticket) {
    const priorityColor = { LOW: '#6b7280', MEDIUM: '#2563eb', HIGH: '#d97706', URGENT: '#dc2626' }[ticket.priority] || '#6b7280';
    const html = `
      <!DOCTYPE html><html><head>
      <style>
        body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; }
        .container { max-width: 600px; margin: 0 auto; padding: 20px; }
        .header { background-color: #166534; color: white; padding: 20px; text-align: center; border-radius: 6px 6px 0 0; }
        .content { padding: 20px; background-color: #f9fafb; }
        .box { background: white; border: 1px solid #e5e7eb; border-radius: 6px; padding: 16px; margin: 12px 0; }
        .label { font-size: 12px; color: #6b7280; text-transform: uppercase; letter-spacing: 0.05em; }
        .badge { display: inline-block; padding: 2px 10px; border-radius: 9999px; font-size: 12px; font-weight: 600; color: white; background: ${priorityColor}; }
        .footer { text-align: center; font-size: 12px; color: #9ca3af; margin-top: 20px; }
      </style></head><body>
      <div class="container">
        <div class="header"><h2 style="margin:0">📋 New Support Ticket</h2></div>
        <div class="content">
          <p>Hello ${adminName},</p>
          <p>A new support ticket has been submitted and requires your attention.</p>
          <div class="box">
            <p class="label">Ticket Number</p>
            <p style="font-family:monospace;font-weight:700;font-size:16px;margin:4px 0">${ticket.ticketNumber}</p>
          </div>
          <div class="box">
            <table style="width:100%;border-collapse:collapse">
              <tr><td style="padding:6px 0"><span class="label">Submitted by</span><br><strong>${ticket.user?.fullName ?? 'Unknown'}</strong> (${ticket.user?.email ?? ''}) — <em>${ticket.userRole}</em></td></tr>
              <tr><td style="padding:6px 0"><span class="label">Category</span><br><strong>${ticket.category.replace(/_/g, ' ')}</strong></td></tr>
              <tr><td style="padding:6px 0"><span class="label">Priority</span><br><span class="badge">${ticket.priority}</span></td></tr>
              <tr><td style="padding:6px 0"><span class="label">Title</span><br><strong>${ticket.title}</strong></td></tr>
              <tr><td style="padding:6px 0"><span class="label">Description</span><br>${ticket.description}</td></tr>
              <tr><td style="padding:6px 0"><span class="label">Submitted at</span><br>${new Date(ticket.createdAt).toLocaleString()}</td></tr>
            </table>
          </div>
          <p>Please log in to the admin dashboard to review and respond to this ticket.</p>
        </div>
        <div class="footer"><p>&copy; BioDigital BSF. All rights reserved.</p></div>
      </div>
      </body></html>
    `;
    return this.sendEmail(email, `[Support] New Ticket ${ticket.ticketNumber} – ${ticket.priority} Priority`, html);
  }

  /**
   * Sent to the user (buyer/driver/supplier) when their ticket status changes.
   */
  async sendSupportTicketStatusUpdateEmail(email, userName, ticket) {
    const statusLabel = { OPEN: 'Open', IN_PROGRESS: 'In Progress', RESOLVED: 'Resolved', CLOSED: 'Closed' }[ticket.status] || ticket.status;
    const statusColor = { OPEN: '#2563eb', IN_PROGRESS: '#d97706', RESOLVED: '#16a34a', CLOSED: '#6b7280' }[ticket.status] || '#6b7280';
    const html = `
      <!DOCTYPE html><html><head>
      <style>
        body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; }
        .container { max-width: 600px; margin: 0 auto; padding: 20px; }
        .header { background-color: #166534; color: white; padding: 20px; text-align: center; border-radius: 6px 6px 0 0; }
        .content { padding: 20px; background-color: #f9fafb; }
        .box { background: white; border: 1px solid #e5e7eb; border-radius: 6px; padding: 16px; margin: 12px 0; }
        .label { font-size: 12px; color: #6b7280; text-transform: uppercase; letter-spacing: 0.05em; }
        .badge { display: inline-block; padding: 3px 12px; border-radius: 9999px; font-size: 13px; font-weight: 700; color: white; background: ${statusColor}; }
        .footer { text-align: center; font-size: 12px; color: #9ca3af; margin-top: 20px; }
      </style></head><body>
      <div class="container">
        <div class="header"><h2 style="margin:0">🔔 Support Ticket Update</h2></div>
        <div class="content">
          <p>Hello ${userName},</p>
          <p>Your support ticket has been updated.</p>
          <div class="box">
            <p class="label">Ticket Number</p>
            <p style="font-family:monospace;font-weight:700;font-size:16px;margin:4px 0">${ticket.ticketNumber}</p>
            <p class="label" style="margin-top:12px">New Status</p>
            <p style="margin:4px 0"><span class="badge">${statusLabel}</span></p>
            <p class="label" style="margin-top:12px">Title</p>
            <p style="margin:4px 0">${ticket.title}</p>
            ${ticket.adminNote ? `<p class="label" style="margin-top:12px">Admin Response</p><p style="margin:4px 0;background:#f0fdf4;border-left:3px solid #16a34a;padding:8px 12px;border-radius:0 4px 4px 0">${ticket.adminNote}</p>` : ''}
            ${ticket.resolvedAt ? `<p class="label" style="margin-top:12px">Resolved At</p><p style="margin:4px 0">${new Date(ticket.resolvedAt).toLocaleString()}</p>` : ''}
          </div>
          <p>If you have further questions, please submit a new ticket or reply to this email.</p>
        </div>
        <div class="footer"><p>&copy; BioDigital BSF. All rights reserved.</p></div>
      </div>
      </body></html>
    `;
    return this.sendEmail(email, `[Support] Ticket ${ticket.ticketNumber} Updated – ${statusLabel}`, html);
  }
}

module.exports = new EmailService();