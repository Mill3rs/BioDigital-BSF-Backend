/**
 * WatermelonDB Sync Protocol
 * --------------------------
 * Mounted at /api/sync in index.js.
 *
 * GET  /api/sync?lastPulledAt=<unix_ms>   — pull server changes
 * POST /api/sync                          — push client changes
 *
 * ID strategy: WatermelonDB generates client-side UUIDs used as the server
 * record ID directly. No ID remapping needed — WDB `id` = server `id`.
 *
 * Tables synced:
 *   waste_records  — SUPPLIER (read/write own), DRIVER (read assigned)
 *   notifications  — all roles (server-push; client marks read)
 */
const express = require('express');
const { prisma } = require('../config/database');
const { authenticate } = require('../middleware/auth');

const router = express.Router();

// ─── Mapping helpers ─────────────────────────────────────────────────────────

function wasteToWdb(r) {
  const loc = r.location || {};
  return {
    id:               r.id,
    server_id:        r.id,
    source_name:      r.sourceName,
    source_type:      r.sourceType,
    quantity:         r.quantity,
    unit:             r.unit,
    date:             new Date(r.date).getTime(),
    status:           r.status,
    description:      r.description      ?? null,
    notes:            r.notes            ?? null,
    location_lat:     loc.lat            ?? null,
    location_lng:     loc.lng            ?? null,
    location_address: loc.address        ?? null,
    farm_id:          r.farmId           ?? null,
    supplier_id:      r.supplierId       ?? null,
    driver_id:        r.driverId         ?? null,
    carbon_saved:     r.carbonSaved      ?? null,
    points_awarded:   r.pointsAwarded    ?? 0,
    is_synced:        true,
    created_at:       new Date(r.createdAt).getTime(),
    updated_at:       new Date(r.updatedAt).getTime(),
  };
}

function notifToWdb(n) {
  return {
    id:         n.id,
    server_id:  n.id,
    title:      n.title,
    message:    n.message,
    type:       n.type,
    read:       n.read,
    metadata:   n.metadata != null ? JSON.stringify(n.metadata) : null,
    created_at: new Date(n.createdAt).getTime(),
  };
}

function wasteWhereForUser(user, since) {
  const base = { deletedAt: null, updatedAt: { gte: since } };
  if (user.role === 'SUPPLIER') {
    return { ...base, OR: [{ supplierId: user.id }, { recordedById: user.id }] };
  }
  if (user.role === 'DRIVER') {
    return { ...base, driverId: user.id };
  }
  if ((user.role === 'MANAGER' || user.role === 'ADMIN' || user.role === 'SUPER_ADMIN') && user.farmId) {
    return { ...base, farmId: user.farmId };
  }
  return { ...base, id: '__no_match__' };
}

// ─── PULL ─────────────────────────────────────────────────────────────────────

router.get('/', authenticate, async (req, res, next) => {
  try {
    const rawTs = parseInt(req.query.lastPulledAt ?? '0', 10);
    const since = new Date(isNaN(rawTs) ? 0 : rawTs);
    const nowMs  = Date.now();

    const [wasteRows, notifRows, deletedRows] = await Promise.all([
      prisma.wasteRecord.findMany({ where: wasteWhereForUser(req.user, since) }),
      prisma.notification.findMany({
        where: { userId: req.user.id, createdAt: { gte: since } },
        orderBy: { createdAt: 'desc' },
        take: 200,
      }),
      // Records soft-deleted on server since last pull
      prisma.wasteRecord.findMany({
        where: { deletedAt: { gte: since }, ...(() => {
          const w = wasteWhereForUser(req.user, new Date(0));
          const { deletedAt: _d, ...rest } = w;
          return rest;
        })() },
        select: { id: true },
      }),
    ]);

    const wasteCreated = [];
    const wasteUpdated = [];
    for (const r of wasteRows) {
      (new Date(r.createdAt) >= since ? wasteCreated : wasteUpdated).push(wasteToWdb(r));
    }

    return res.json({
      changes: {
        waste_records: {
          created: wasteCreated,
          updated: wasteUpdated,
          deleted: deletedRows.map(r => r.id),
        },
        notifications: {
          created: notifRows.map(notifToWdb),
          updated: [],
          deleted: [],
        },
      },
      timestamp: nowMs,
    });
  } catch (err) {
    next(err);
  }
});

// ─── PUSH ─────────────────────────────────────────────────────────────────────

router.post('/', authenticate, async (req, res, next) => {
  try {
    const { changes = {} } = req.body;
    const waste  = changes.waste_records  ?? {};
    const notifs = changes.notifications  ?? {};

    // waste_records.created — use client UUID as server ID (upsert for idempotency)
    for (const raw of waste.created ?? []) {
      if (!raw.id) continue;
      const location =
        raw.location_lat != null || raw.location_address != null
          ? { lat: raw.location_lat ?? null, lng: raw.location_lng ?? null, address: raw.location_address ?? null }
          : null;

      await prisma.wasteRecord.upsert({
        where:  { id: raw.id },
        create: {
          id:           raw.id,
          sourceName:   raw.source_name   ?? 'Unknown',
          sourceType:   raw.source_type   ?? 'OTHER',
          quantity:     Number(raw.quantity ?? 0),
          unit:         raw.unit          ?? 'kg',
          date:         raw.date ? new Date(raw.date) : new Date(),
          status:       'PENDING',
          description:  raw.description   ?? null,
          notes:        raw.notes         ?? null,
          location,
          farmId:       raw.farm_id       ?? null,
          supplierId:   req.user.role === 'SUPPLIER' ? req.user.id : (raw.supplier_id ?? null),
          recordedById: req.user.id,
        },
        update: {},   // already on server — preserve server state
      }).catch(err => console.warn('[Sync] upsert waste failed:', raw.id, err.message));
    }

    // waste_records.updated — clients can only update notes on their own records
    for (const raw of waste.updated ?? []) {
      if (!raw.id) continue;
      await prisma.wasteRecord.updateMany({
        where: { id: raw.id, recordedById: req.user.id },
        data:  { notes: raw.notes ?? undefined },
      }).catch(() => {});
    }

    // waste_records.deleted — soft-delete PENDING records created by this user
    for (const id of waste.deleted ?? []) {
      await prisma.wasteRecord.updateMany({
        where: { id, recordedById: req.user.id, status: 'PENDING' },
        data:  { deletedAt: new Date() },
      }).catch(() => {});
    }

    // notifications.updated — only allow marking as read
    for (const raw of notifs.updated ?? []) {
      if (!raw.id) continue;
      await prisma.notification.updateMany({
        where: { id: raw.id, userId: req.user.id },
        data:  { read: raw.read ?? true, readAt: raw.read ? new Date() : null },
      }).catch(() => {});
    }

    return res.json({ success: true });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
