-- =============================================================================
-- BioDigital BSF Farm — Script 08: Dashboard Indexes & Settings
-- =============================================================================
-- Purpose : Apply database optimisations and configuration updates that
--           accompany the Admin/Manager dashboard release (April 2026).
--
-- Changes covered:
--   1. Performance indexes for Super-Admin and Admin/Manager dashboard queries
--        • WasteRecord.date          — monthly trend (DATE_TRUNC GROUP BY)
--        • WasteRecord.farmId        — per-farm filtering
--        • WasteRecord.status        — status-based filtering
--        • WasteRecord.carbonSaved   — carbon savings aggregate
--        • User.role                 — byRole counts
--        • User.status               — byStatus counts
--        • User.lastLogin            — 7-day active-user window
--        • User.managedById          — admin→manager scoping
--        • Order.status              — completed-orders count
--        • Order.farmId              — per-farm order filtering
--        • Admin.subscription        — active-admin count
--        • ProcessingBatch.farmId    — per-farm batch queries
--        • ProcessingBatch.status    — status-based batch queries
--        • Farm.adminId              — admin→farm scoping
--        • Farm.status               — active-farm filtering
--        • Notification.userId       — per-user notification feed
--        • Notification.read         — unread-count queries
--        • ActivityLog.userId        — per-user activity feed
--        • TeamAssignment.farmId     — per-farm team queries
--
--   2. New SystemSetting rows
--        • dashboard_refresh_interval  — how often the UI re-fetches stats (ms)
--        • manager_waste_log_enabled   — feature flag: managers can log waste
--        • manager_farm_create_enabled — feature flag: managers can create farms
--        • carbon_display_unit        — tonne / kg display preference
--        • larvae_conversion_factor   — kg larvae per kg waste processed
--        • fertilizer_conversion_factor — kg fertilizer per kg waste processed
--
--   3. MANAGER role – no enum changes needed (MANAGER already existed in
--      UserRole).  The permission grants are enforced in application code
--      (src/routes/farms.js, src/routes/waste.js).
--
-- Run AFTER : 07_delete_old_tables.sql (or on any up-to-date DB)
-- Usage     : psql -U biodigital -d biodigital -f 08_dashboard_indexes_and_settings.sql
-- Safe to re-run: all statements use IF NOT EXISTS / ON CONFLICT DO NOTHING
-- =============================================================================

\set ON_ERROR_STOP on
\connect biodigital

-- =============================================================================
-- SECTION 1 — Performance Indexes
-- =============================================================================

BEGIN;

-- ── WasteRecord ───────────────────────────────────────────────────────────────
-- Monthly trend query:  DATE_TRUNC('month', date)  GROUP BY month  ORDER BY month
CREATE INDEX IF NOT EXISTS "idx_WasteRecord_date"
  ON "WasteRecord" ("date" DESC);

-- Per-farm filtering used in Manager-scoped waste queries
CREATE INDEX IF NOT EXISTS "idx_WasteRecord_farmId"
  ON "WasteRecord" ("farmId");

-- Status-based filtering (PENDING / PROCESSING / PROCESSED …)
CREATE INDEX IF NOT EXISTS "idx_WasteRecord_status"
  ON "WasteRecord" ("status");

-- Carbon-savings aggregate used in /waste/summary/stats
CREATE INDEX IF NOT EXISTS "idx_WasteRecord_carbonSaved"
  ON "WasteRecord" ("carbonSaved");

-- Composite: farm + date — used when Manager fetches their farm's monthly data
CREATE INDEX IF NOT EXISTS "idx_WasteRecord_farmId_date"
  ON "WasteRecord" ("farmId", "date" DESC);

-- ── User ──────────────────────────────────────────────────────────────────────
-- byRole count  (GROUP BY role or WHERE role = ?)
CREATE INDEX IF NOT EXISTS "idx_User_role"
  ON "Users" ("role");

-- byStatus count
CREATE INDEX IF NOT EXISTS "idx_User_status"
  ON "Users" ("status");

-- 7-day active-user window:  WHERE lastLogin >= NOW() - INTERVAL '7 days'
CREATE INDEX IF NOT EXISTS "idx_User_lastLogin"
  ON "Users" ("lastLogin" DESC);

-- Admin-to-manager scoping
CREATE INDEX IF NOT EXISTS "idx_User_managedById"
  ON "Users" ("managedById");

-- Composite: role + status — fast path for active-user count per role
CREATE INDEX IF NOT EXISTS "idx_User_role_status"
  ON "Users" ("role", "status");

-- ── Order ─────────────────────────────────────────────────────────────────────
-- Completed-orders count  /  revenue aggregate
CREATE INDEX IF NOT EXISTS "idx_Order_status"
  ON "Order" ("status");

-- Per-farm order queries
CREATE INDEX IF NOT EXISTS "idx_Order_farmId"
  ON "Order" ("farmId");

-- Composite: status + farmId — used in Admin/Manager farm-scoped order stats
CREATE INDEX IF NOT EXISTS "idx_Order_status_farmId"
  ON "Order" ("status", "farmId");

-- ── Admin ─────────────────────────────────────────────────────────────────────
-- Active-admin count:  WHERE subscription = 'ACTIVE'
CREATE INDEX IF NOT EXISTS "idx_Admin_subscription"
  ON "Admin" ("subscription");

-- ── ProcessingBatch ───────────────────────────────────────────────────────────
-- Per-farm batch queries
CREATE INDEX IF NOT EXISTS "idx_ProcessingBatch_farmId"
  ON "ProcessingBatch" ("farmId");

-- Status-based batch queries
CREATE INDEX IF NOT EXISTS "idx_ProcessingBatch_status"
  ON "ProcessingBatch" ("status");

-- Composite: farmId + status
CREATE INDEX IF NOT EXISTS "idx_ProcessingBatch_farmId_status"
  ON "ProcessingBatch" ("farmId", "status");

-- ── Farm ──────────────────────────────────────────────────────────────────────
-- Admin-to-farm scoping
CREATE INDEX IF NOT EXISTS "idx_Farm_adminId"
  ON "Farm" ("adminId");

-- Active-farm filtering
CREATE INDEX IF NOT EXISTS "idx_Farm_status"
  ON "Farm" ("status");

-- ── Notification ──────────────────────────────────────────────────────────────
-- Per-user notification feed (most common query pattern)
CREATE INDEX IF NOT EXISTS "idx_Notification_userId"
  ON "Notification" ("userId");

-- Unread-count query:  WHERE read = FALSE AND userId = ?
CREATE INDEX IF NOT EXISTS "idx_Notification_userId_read"
  ON "Notification" ("userId", "read");

-- ── ActivityLog ──────────────────────────────────────────────────────────────
-- Per-user/per-performer activity feed (column is performedById in this DB)
CREATE INDEX IF NOT EXISTS "idx_ActivityLog_performedById"
  ON "ActivityLog" ("performedById");

-- ── TeamAssignment ────────────────────────────────────────────────────────────
-- Per-batch team queries (TeamAssignment is batch-scoped, not farm-scoped)
CREATE INDEX IF NOT EXISTS "idx_TeamAssignment_batchId"
  ON "TeamAssignment" ("batchId");

COMMIT;

-- =============================================================================
-- SECTION 2 — New System Settings
-- =============================================================================

BEGIN;

INSERT INTO "SystemSetting" ("id", "key", "value", "description", "category", "updatedBy", "updatedAt")
VALUES
  -- How often the dashboard polls for fresh stats (30 seconds)
  (
    gen_random_uuid()::TEXT,
    'dashboard_refresh_interval_ms',
    '30000'::JSONB,
    'Interval in milliseconds between automatic dashboard stat refreshes',
    'dashboard',
    'system',
    NOW()
  ),
  -- Feature flag: MANAGER role can log waste records manually
  (
    gen_random_uuid()::TEXT,
    'manager_waste_log_enabled',
    'true'::JSONB,
    'Allow users with MANAGER role to create waste records manually',
    'permissions',
    'system',
    NOW()
  ),
  -- Feature flag: MANAGER role can create / edit farms
  (
    gen_random_uuid()::TEXT,
    'manager_farm_create_enabled',
    'true'::JSONB,
    'Allow users with MANAGER role to create and edit farms',
    'permissions',
    'system',
    NOW()
  ),
  -- Display unit for carbon savings on the dashboard
  (
    gen_random_uuid()::TEXT,
    'carbon_display_unit',
    '"kg"'::JSONB,
    'Unit used to display carbon savings on the dashboard (kg or tonne)',
    'dashboard',
    'system',
    NOW()
  ),
  -- Larvae yield factor: kg of larvae per kg of waste input
  (
    gen_random_uuid()::TEXT,
    'larvae_conversion_factor',
    '{"kgLarvaePerKgWaste": 0.15, "description": "Expected larvae yield per kg of organic waste processed"}'::JSONB,
    'Conversion factor for estimating larvae output from waste input quantity',
    'processing',
    'system',
    NOW()
  ),
  -- Fertilizer yield factor: kg of fertilizer per kg of waste input
  (
    gen_random_uuid()::TEXT,
    'fertilizer_conversion_factor',
    '{"kgFertilizerPerKgWaste": 0.25, "description": "Expected fertilizer yield per kg of organic waste processed"}'::JSONB,
    'Conversion factor for estimating fertilizer output from waste input quantity',
    'processing',
    'system',
    NOW()
  )
ON CONFLICT ("key") DO NOTHING;

COMMIT;

-- =============================================================================
-- SECTION 3 — Verify
-- =============================================================================

-- Show all new indexes
SELECT
  tablename,
  indexname
FROM pg_indexes
WHERE schemaname = 'public'
  AND indexname LIKE 'idx_%'
ORDER BY tablename, indexname;

-- Show all dashboard/processing/permissions settings
SELECT key, value, category
FROM "SystemSetting"
WHERE category IN ('dashboard', 'processing', 'permissions')
ORDER BY category, key;

\echo ''
\echo '✅  08_dashboard_indexes_and_settings.sql — Indexes and system settings applied.'
\echo '    Dashboard stat queries are now covered by appropriate indexes.'
\echo '    Manager permissions (waste logging, farm creation) are feature-flagged in SystemSetting.'
