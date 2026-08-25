const express = require('express');
const { body, validationResult } = require('express-validator');
const { prisma } = require('../config/database');
const { authenticate, authorize } = require('../middleware/auth');
const { AppError } = require('../middleware/errorHandler');

const router = express.Router();

// Get all trays (company-scoped for ADMIN/MANAGER)
router.get('/', authenticate, async (req, res, next) => {
  try {
    const { status, page: rawPage = '1', limit: rawLimit = '50' } = req.query;
    const page = parseInt(rawPage, 10) || 1;
    const limit = parseInt(rawLimit, 10) || 50;
    const where = {};

    if (status) where.status = status;

    // Admin scope: users only see trays created within their company
    if (req.user.adminId) {
      where.createdBy = { managedById: req.user.adminId };
    }

    const skip = (page - 1) * limit;

    const [trays, total] = await Promise.all([
      prisma.tray.findMany({
        where,
        include: {
          createdBy: { select: { id: true, fullName: true } },
          batch: { select: { id: true, batchNumber: true, name: true } },
        },
        orderBy: { createdAt: 'desc' },
        skip,
        take: limit,
      }),
      prisma.tray.count({ where }),
    ]);

    res.json({
      success: true,
      data: trays,
      pagination: {
        page,
        limit,
        total,
        pages: Math.ceil(total / limit),
      },
    });
  } catch (error) {
    next(error);
  }
});

// Get tray by ID
router.get('/:id', authenticate, async (req, res, next) => {
  try {
    const tray = await prisma.tray.findUnique({
      where: { id: req.params.id },
      include: {
        createdBy: { select: { id: true, fullName: true } },
        batch: { select: { id: true, batchNumber: true, name: true } },
      },
    });

    if (!tray) throw new AppError('Tray not found', 404);

    res.json({ success: true, data: tray });
  } catch (error) {
    next(error);
  }
});

// Create tray
router.post(
  '/',
  authenticate,
  authorize('SUPER_ADMIN', 'ADMIN', 'MANAGER'),
  [
    body('trayId').notEmpty().withMessage('Tray ID is required'),
    body('description').optional().isString(),
    body('location').optional().isString(),
    body('capacity').optional({ nullable: true }).isFloat({ min: 0 }),
    body('notes').optional().isString(),
    body('batchId').optional().isString(),
  ],
  async (req, res, next) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ success: false, errors: errors.array() });
    }
    try {
      const { trayId, description, location, capacity, notes, batchId } = req.body;

      const existing = await prisma.tray.findFirst({ where: { trayId } });
      if (existing) throw new AppError('A tray with this ID already exists', 409);

      const tray = await prisma.tray.create({
        data: {
          trayId,
          description,
          location,
          capacity: capacity != null ? parseFloat(capacity) : null,
          notes,
          batchId: batchId || null,
          createdById: req.user.id,
        },
        include: {
          createdBy: { select: { id: true, fullName: true } },
        },
      });

      res.status(201).json({ success: true, data: tray });
    } catch (error) {
      next(error);
    }
  },
);

// Delete tray
router.delete(
  '/:id',
  authenticate,
  authorize('SUPER_ADMIN', 'ADMIN', 'MANAGER'),
  async (req, res, next) => {
    try {
      const existing = await prisma.tray.findUnique({ where: { id: req.params.id } });
      if (!existing) throw new AppError('Tray not found', 404);

      await prisma.tray.delete({ where: { id: req.params.id } });

      res.json({ success: true, message: 'Tray deleted successfully' });
    } catch (error) {
      next(error);
    }
  },
);

module.exports = router;
