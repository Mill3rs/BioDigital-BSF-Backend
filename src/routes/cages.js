const express = require('express');
const { body, validationResult } = require('express-validator');
const { prisma } = require('../config/database');
const { authenticate } = require('../middleware/auth');
const { authorize } = require('../middleware/auth');
const { AppError } = require('../middleware/errorHandler');

const router = express.Router();

// Get all cages
router.get('/', authenticate, async (req, res, next) => {
  try {
    const { status, page: rawPage = '1', limit: rawLimit = '50' } = req.query;
    const page = parseInt(rawPage, 10) || 1;
    const limit = parseInt(rawLimit, 10) || 50;
    const where = {};
    
    if (status) where.status = status;
    
    const skip = (page - 1) * limit;
    
    const [cages, total] = await Promise.all([
      prisma.cage.findMany({
        where,
        include: {
          createdBy: { select: { id: true, fullName: true } },
          batch: { select: { id: true, batchNumber: true, name: true } },
        },
        orderBy: { createdAt: 'desc' },
        skip,
        take: limit,
      }),
      prisma.cage.count({ where }),
    ]);
    
    res.json({
      success: true,
      data: cages,
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

// Get cage by ID
router.get('/:id', authenticate, async (req, res, next) => {
  try {
    const cage = await prisma.cage.findUnique({
      where: { id: req.params.id },
      include: {
        createdBy: { select: { id: true, fullName: true } },
        batch: { select: { id: true, batchNumber: true, name: true } },
      },
    });
    
    if (!cage) throw new AppError('Cage not found', 404);
    
    res.json({ success: true, data: cage });
  } catch (error) {
    next(error);
  }
});

// Create cage
router.post(
  '/',
  authenticate,
  authorize('SUPER_ADMIN', 'ADMIN', 'MANAGER'),
  [
    body('cageId').notEmpty().withMessage('Cage ID is required'),
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
      const { cageId, description, location, capacity, notes, batchId } = req.body;
      
      const existing = await prisma.cage.findFirst({ where: { cageId } });
      if (existing) throw new AppError('A cage with this ID already exists', 409);
      
      const cage = await prisma.cage.create({
        data: {
          cageId,
          description,
          location,
          capacity: capacity ? parseFloat(capacity) : null,
          notes,
          batchId: batchId || null,
          createdById: req.user.id,
        },
        include: {
          createdBy: { select: { id: true, fullName: true } },
        },
      });
      
      res.status(201).json({ success: true, data: cage });
    } catch (error) {
      next(error);
    }
  },
);

// Update cage
router.put(
  '/:id',
  authenticate,
  authorize('SUPER_ADMIN', 'ADMIN', 'MANAGER'),
  [
    body('cageId').optional().notEmpty(),
    body('description').optional().isString(),
    body('location').optional().isString(),
    body('capacity').optional({ nullable: true }).isFloat({ min: 0 }),
    body('status').optional().isIn(['ACTIVE', 'INACTIVE']),
    body('notes').optional().isString(),
    body('batchId').optional({ nullable: true }).isString(),
  ],
  async (req, res, next) => {
    try {
      const { id } = req.params;
      const { cageId, description, location, capacity, status, notes, batchId } = req.body;
      
      const existing = await prisma.cage.findUnique({ where: { id } });
      if (!existing) throw new AppError('Cage not found', 404);
      
      if (cageId && cageId !== existing.cageId) {
        const duplicate = await prisma.cage.findFirst({ where: { cageId } });
        if (duplicate) throw new AppError('A cage with this ID already exists', 409);
      }
      
      const cage = await prisma.cage.update({
        where: { id },
        data: {
          ...(cageId !== undefined && { cageId }),
          ...(description !== undefined && { description }),
          ...(location !== undefined && { location }),
          ...(capacity !== undefined && { capacity: capacity ? parseFloat(capacity) : null }),
          ...(status !== undefined && { status }),
          ...(notes !== undefined && { notes }),
          ...(batchId !== undefined && { batchId: batchId || null }),
        },
        include: {
          createdBy: { select: { id: true, fullName: true } },
          batch: { select: { id: true, batchNumber: true, name: true } },
        },
      });
      
      res.json({ success: true, data: cage });
    } catch (error) {
      next(error);
    }
  },
);

// Delete cage
router.delete(
  '/:id',
  authenticate,
  authorize('SUPER_ADMIN', 'ADMIN', 'MANAGER'),
  async (req, res, next) => {
    try {
      const existing = await prisma.cage.findUnique({ where: { id: req.params.id } });
      if (!existing) throw new AppError('Cage not found', 404);
      
      await prisma.cage.delete({ where: { id: req.params.id } });
      
      res.json({ success: true, message: 'Cage deleted successfully' });
    } catch (error) {
      next(error);
    }
  },
);

module.exports = router;
