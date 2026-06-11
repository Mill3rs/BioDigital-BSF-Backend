const express = require('express');
const { prisma } = require('../config/database');
const { authenticate, authorize } = require('../middleware/auth');
const { AppError } = require('../middleware/errorHandler');
const notificationService = require('../services/notificationService');
const emailService = require('../services/emailService');
const { broadcastToRole, sendToUser } = require('../sockets/helpers');

const router = express.Router();

const ADMIN_ROLES = ['SUPER_ADMIN', 'ADMIN', 'MANAGER'];
const USER_ROLES = ['BUYER', 'DRIVER', 'SUPPLIER'];

// Generate a ticket number: SUP-YYYYMMDD-XXXX
function generateTicketNumber() {
  const date = new Date().toISOString().slice(0, 10).replace(/-/g, '');
  const suffix = Math.random().toString(36).slice(2, 6).toUpperCase();
  return `SUP-${date}-${suffix}`;
}

// POST /api/support — create a ticket (buyers, drivers, suppliers)
router.post('/', authenticate, async (req, res, next) => {
  try {
    const { role } = req.user;
    if (!USER_ROLES.includes(role)) {
      throw new AppError('Only buyers, drivers and suppliers can submit support tickets', 403);
    }

    const { category, title, description, priority } = req.body;

    if (!category || !title || !description) {
      throw new AppError('category, title and description are required', 400);
    }

    const validCategories = ['ORDER_ISSUE', 'DELIVERY_ISSUE', 'PAYMENT_ISSUE', 'PRODUCT_ISSUE', 'ACCOUNT_ISSUE', 'APP_BUG', 'OTHER'];
    if (!validCategories.includes(category)) {
      throw new AppError(`Invalid category. Must be one of: ${validCategories.join(', ')}`, 400);
    }

    const validPriorities = ['LOW', 'MEDIUM', 'HIGH', 'URGENT'];
    const resolvedPriority = priority && validPriorities.includes(priority) ? priority : 'MEDIUM';

    const ticket = await prisma.supportTicket.create({
      data: {
        ticketNumber: generateTicketNumber(),
        userId: req.user.id,
        userRole: role,
        category,
        title: title.trim(),
        description: description.trim(),
        priority: resolvedPriority,
      },
      include: {
        user: { select: { id: true, fullName: true, email: true } },
      },
    });

    // ── Notify all admins & managers ─────────────────────────────────────
    setImmediate(async () => {
      try {
        const admins = await prisma.user.findMany({
          where: { role: { in: ['SUPER_ADMIN', 'ADMIN', 'MANAGER'] } },
          select: { id: true, fullName: true, email: true },
        });

        const adminIds = admins.map(a => a.id);
        if (adminIds.length) {
          await notificationService.sendBulkNotifications(
            adminIds,
            '📋 New Support Ticket',
            `${ticket.userRole} ${ticket.user?.fullName ?? 'Unknown'} submitted a ${ticket.priority} priority ticket: "${ticket.title}" [${ticket.ticketNumber}]`,
            'SUPPORT',
            { ticketId: ticket.id, ticketNumber: ticket.ticketNumber, priority: ticket.priority },
          );
        }

        for (const admin of admins) {
          if (admin.email) {
            emailService.sendSupportTicketAdminEmail(admin.email, admin.fullName, ticket).catch(() => {});
          }
        }

        // Real-time socket push to web admin/manager dashboard
        const socketPayload = {
          ticketId: ticket.id,
          ticketNumber: ticket.ticketNumber,
          title: ticket.title,
          priority: ticket.priority,
          category: ticket.category,
          userRole: ticket.userRole,
          userName: ticket.user?.fullName ?? 'Unknown',
        };
        broadcastToRole('ADMIN', 'support:new', socketPayload);
        broadcastToRole('MANAGER', 'support:new', socketPayload);
        broadcastToRole('SUPER_ADMIN', 'support:new', socketPayload);
      } catch (_) { /* non-fatal */ }
    });

    res.status(201).json({ success: true, data: ticket });
  } catch (error) {
    next(error);
  }
});

// GET /api/support — list tickets
//   - BUYER/DRIVER/SUPPLIER → own tickets only
//   - ADMIN/MANAGER/SUPER_ADMIN → all tickets with optional filters
router.get('/', authenticate, async (req, res, next) => {
  try {
    const { role } = req.user;
    const { status, priority, page = 1, limit = 20 } = req.query;

    const where = {};

    if (USER_ROLES.includes(role)) {
      where.userId = req.user.id;
    } else if (!ADMIN_ROLES.includes(role)) {
      throw new AppError('Unauthorized', 403);
    }

    if (status) where.status = status;
    if (priority) where.priority = priority;

    const skip = (parseInt(page) - 1) * parseInt(limit);

    const [tickets, total] = await Promise.all([
      prisma.supportTicket.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip,
        take: parseInt(limit),
        include: {
          user: { select: { id: true, fullName: true, email: true } },
        },
      }),
      prisma.supportTicket.count({ where }),
    ]);

    res.json({
      success: true,
      data: tickets,
      pagination: {
        page: parseInt(page),
        limit: parseInt(limit),
        total,
        pages: Math.ceil(total / parseInt(limit)),
      },
    });
  } catch (error) {
    next(error);
  }
});

// GET /api/support/:id — single ticket
router.get('/:id', authenticate, async (req, res, next) => {
  try {
    const { id } = req.params;
    const { role } = req.user;

    const ticket = await prisma.supportTicket.findUnique({
      where: { id },
      include: { user: { select: { id: true, fullName: true, email: true } } },
    });

    if (!ticket) throw new AppError('Ticket not found', 404);

    // Non-admin users can only view their own tickets
    if (USER_ROLES.includes(role) && ticket.userId !== req.user.id) {
      throw new AppError('Ticket not found', 404);
    }

    res.json({ success: true, data: ticket });
  } catch (error) {
    next(error);
  }
});

// PATCH /api/support/:id/status — admin updates status / note
router.patch('/:id/status', authenticate, async (req, res, next) => {
  try {
    if (!ADMIN_ROLES.includes(req.user.role)) {
      throw new AppError('Admin access required', 403);
    }

    const { id } = req.params;
    const { status, adminNote } = req.body;

    const validStatuses = ['OPEN', 'IN_PROGRESS', 'RESOLVED', 'CLOSED'];
    if (!status || !validStatuses.includes(status)) {
      throw new AppError(`Invalid status. Must be one of: ${validStatuses.join(', ')}`, 400);
    }

    const ticket = await prisma.supportTicket.findUnique({ where: { id } });
    if (!ticket) throw new AppError('Ticket not found', 404);

    const updateData = { status };
    if (adminNote !== undefined) updateData.adminNote = adminNote;
    if (status === 'RESOLVED' || status === 'CLOSED') {
      updateData.resolvedAt = new Date();
    }

    const updated = await prisma.supportTicket.update({
      where: { id },
      data: updateData,
      include: { user: { select: { id: true, fullName: true, email: true } } },
    });

    // ── Notify the ticket owner of the status change ──────────────────────
    setImmediate(async () => {
      try {
        const statusLabel = { OPEN: 'Open', IN_PROGRESS: 'In Progress', RESOLVED: 'Resolved', CLOSED: 'Closed' }[status] || status;
        const noteSnippet = updated.adminNote ? ` — "${updated.adminNote.slice(0, 80)}${updated.adminNote.length > 80 ? '…' : ''}"` : '';

        await notificationService.createNotification(
          updated.userId,
          '🔔 Support Ticket Updated',
          `Your ticket ${updated.ticketNumber} is now ${statusLabel}${noteSnippet}`,
          'SUPPORT',
          { ticketId: updated.id, ticketNumber: updated.ticketNumber, status },
        );

        if (updated.user?.email) {
          emailService.sendSupportTicketStatusUpdateEmail(
            updated.user.email,
            updated.user.fullName ?? 'User',
            updated,
          ).catch(() => {});
        }

        // Real-time socket push to the ticket owner (mobile app)
        sendToUser(updated.userId, 'support:status', {
          ticketId: updated.id,
          ticketNumber: updated.ticketNumber,
          status: updated.status,
          statusLabel,
          adminNote: updated.adminNote ?? null,
        });
      } catch (_) { /* non-fatal */ }
    });

    res.json({ success: true, data: updated });
  } catch (error) {
    next(error);
  }
});

module.exports = router;
