const express = require('express');
const { body, validationResult } = require('express-validator');
const { prisma } = require('../config/database');
const { authenticate, authorize } = require('../middleware/auth');

const router = express.Router();

// ─── Helpers ─────────────────────────────────────────────────────────────────
async function getPayoutRatePerPoint() {
  const setting = await prisma.systemSetting.findUnique({ where: { key: 'payout_rate_per_point' } });
  return setting ? Number(setting.value) : 0;
}

async function getPointsRewardEnabled() {
  const setting = await prisma.systemSetting.findUnique({ where: { key: 'points_reward_enabled' } });
  return setting ? setting.value === 'true' : true; // default on
}

async function getEnabledPayoutMethods() {
  const setting = await prisma.systemSetting.findUnique({ where: { key: 'payout_methods_enabled' } });
  return setting ? JSON.parse(setting.value) : ['mobile_money'];
}

async function getPayoutMinimumPoints() {
  const setting = await prisma.systemSetting.findUnique({ where: { key: 'payout_minimum_points' } });
  return setting ? Number(setting.value) : 0;
}

// ─── Supplier: Get payout settings (rate + own balance + enabled methods) ────
router.get('/settings', authenticate, authorize('SUPPLIER'), async (req, res, next) => {
  try {
    const [ratePerPoint, pointsRewardEnabled, enabledPayoutMethods, minimumPoints, supplierProfile] = await Promise.all([
      getPayoutRatePerPoint(),
      getPointsRewardEnabled(),
      getEnabledPayoutMethods(),
      getPayoutMinimumPoints(),
      prisma.supplierProfile.findUnique({
        where: { userId: req.user.id },
        select: { pointsBalance: true },
      }),
    ]);
    res.json({
      success: true,
      data: {
        ratePerPoint,
        pointsBalance: supplierProfile?.pointsBalance ?? 0,
        pointsRewardEnabled,
        enabledPayoutMethods,
        minimumPoints,
      },
    });
  } catch (error) {
    next(error);
  }
});

// ─── Supplier: Submit payout request ─────────────────────────────────────────
router.post(
  '/request',
  authenticate,
  authorize('SUPPLIER'),
  [
    body('points').isInt({ min: 1 }).withMessage('points must be a positive integer'),
    body('paymentMethod').trim().notEmpty().withMessage('paymentMethod is required'),
    body('paymentDetails').isObject().withMessage('paymentDetails must be an object'),
  ],
  async (req, res, next) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) return res.status(400).json({ success: false, errors: errors.array() });

    try {
      const { points, paymentMethod, paymentDetails } = req.body;

      // Check if points reward system is enabled
      const rewardEnabled = await getPointsRewardEnabled();
      if (!rewardEnabled) {
        return res.status(403).json({
          success: false,
          message: 'The points reward system is currently disabled. Payout requests cannot be submitted.',
        });
      }

      // Validate payment method is enabled
      const enabledMethods = await getEnabledPayoutMethods();
      if (!enabledMethods.includes(paymentMethod)) {
        return res.status(400).json({
          success: false,
          message: `Payment method "${paymentMethod}" is not currently available.`,
        });
      }

      // Check supplier profile + points balance
      const supplierProfile = await prisma.supplierProfile.findUnique({
        where: { userId: req.user.id },
        select: { pointsBalance: true, adminId: true },
      });
      if (!supplierProfile) {
        return res.status(404).json({ success: false, message: 'Supplier profile not found' });
      }
      if (supplierProfile.pointsBalance < points) {
        return res.status(400).json({
          success: false,
          message: `Insufficient points. You have ${supplierProfile.pointsBalance} pts, requested ${points} pts.`,
        });
      }

      // Check for pending request already
      const pending = await prisma.payoutRequest.findFirst({
        where: { supplierId: req.user.id, status: 'PENDING' },
      });
      if (pending) {
        return res.status(409).json({
          success: false,
          message: 'You already have a pending payout request. Please wait for it to be processed.',
        });
      }

      // Enforce minimum points threshold
      const minimumPoints = await getPayoutMinimumPoints();
      if (minimumPoints > 0 && points < minimumPoints) {
        return res.status(400).json({
          success: false,
          message: `Minimum ${minimumPoints.toLocaleString()} points required to request a payout. You requested ${points} pts.`,
        });
      }

      const ratePerPoint = await getPayoutRatePerPoint();
      const amountGhs = parseFloat((points * ratePerPoint).toFixed(2));

      const payoutRequest = await prisma.payoutRequest.create({
        data: {
          supplierId: req.user.id,
          adminId: supplierProfile.adminId ?? null,
          points,
          amountGhs,
          paymentMethod,
          paymentDetails,
          status: 'PENDING',
        },
      });

      res.status(201).json({
        success: true,
        message: 'Payout request submitted successfully',
        data: payoutRequest,
      });
    } catch (error) {
      next(error);
    }
  },
);

// ─── Supplier: Get own payout request history ────────────────────────────────
router.get('/my-requests', authenticate, authorize('SUPPLIER'), async (req, res, next) => {
  try {
    const requests = await prisma.payoutRequest.findMany({
      where: { supplierId: req.user.id },
      orderBy: { createdAt: 'desc' },
    });
    res.json({ success: true, data: { requests } });
  } catch (error) {
    next(error);
  }
});

// ─── Admin: List payout requests for their company ───────────────────────────
router.get('/admin-requests', authenticate, authorize('ADMIN', 'MANAGER', 'SUPER_ADMIN'), async (req, res, next) => {
  try {
    const { status } = req.query;
    const where = {};

    if (status) where.status = status;

    const requests = await prisma.payoutRequest.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      include: {
        supplier: { select: { id: true, fullName: true, email: true, phoneNumber: true } },
      },
    });
    res.json({ success: true, data: { requests } });
  } catch (error) {
    next(error);
  }
});

// ─── Admin: Approve a payout request ─────────────────────────────────────────
router.patch(
  '/requests/:id/approve',
  authenticate,
  authorize('ADMIN', 'SUPER_ADMIN'),
  [body('notes').optional().trim(), body('adminPaymentMethod').optional().trim()],
  async (req, res, next) => {
    try {
      const { id } = req.params;
      const { notes, adminPaymentMethod } = req.body;

      const request = await prisma.payoutRequest.findUnique({ where: { id } });
      if (!request) return res.status(404).json({ success: false, message: 'Payout request not found' });
      if (request.status !== 'PENDING') {
        return res.status(400).json({ success: false, message: `Request is already ${request.status}` });
      }

      // Deduct points from supplier profile atomically
      const [updated] = await prisma.$transaction([
        prisma.payoutRequest.update({
          where: { id },
          data: {
            status: 'APPROVED',
            notes: notes ?? null,
            adminPaymentMethod: adminPaymentMethod ?? null,
            processedAt: new Date(),
            processedBy: req.user.id,
          },
        }),
        prisma.supplierProfile.update({
          where: { userId: request.supplierId },
          data: { pointsBalance: { decrement: request.points } },
        }),
      ]);

      res.json({ success: true, message: 'Payout request approved', data: updated });
    } catch (error) {
      next(error);
    }
  },
);

// ─── Admin: Reject a payout request ──────────────────────────────────────────
router.patch(
  '/requests/:id/reject',
  authenticate,
  authorize('ADMIN', 'SUPER_ADMIN'),
  [body('notes').optional().trim()],
  async (req, res, next) => {
    try {
      const { id } = req.params;
      const { notes } = req.body;

      const request = await prisma.payoutRequest.findUnique({ where: { id } });
      if (!request) return res.status(404).json({ success: false, message: 'Payout request not found' });
      if (request.status !== 'PENDING') {
        return res.status(400).json({ success: false, message: `Request is already ${request.status}` });
      }

      const updated = await prisma.payoutRequest.update({
        where: { id },
        data: {
          status: 'REJECTED',
          notes: notes ?? null,
          processedAt: new Date(),
          processedBy: req.user.id,
        },
      });

      res.json({ success: true, message: 'Payout request rejected', data: updated });
    } catch (error) {
      next(error);
    }
  },
);

// ─── Admin/Manager: Mark an approved request as paid ─────────────────────────
router.patch(
  '/requests/:id/mark-paid',
  authenticate,
  authorize('ADMIN', 'MANAGER', 'SUPER_ADMIN'),
  async (req, res, next) => {
    try {
      const { id } = req.params;
      const request = await prisma.payoutRequest.findUnique({ where: { id } });
      if (!request) return res.status(404).json({ success: false, message: 'Payout request not found' });
      if (request.status !== 'APPROVED') {
        return res.status(400).json({ success: false, message: 'Only APPROVED requests can be marked as paid' });
      }
      const updated = await prisma.payoutRequest.update({
        where: { id },
        data: { status: 'PAID', processedAt: new Date(), processedBy: req.user.id },
      });
      res.json({ success: true, message: 'Payout request marked as paid', data: updated });
    } catch (error) {
      next(error);
    }
  },
);

module.exports = router;
