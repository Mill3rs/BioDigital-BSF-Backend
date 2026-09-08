-- =============================================================================
-- BioDigital BSF Farm — Script 11: Latest Schema Sync (Idempotent)
-- =============================================================================
-- Purpose : Bring an EXISTING database up to date with the schema changes that
--           landed AFTER script 10 (May 2026 baseline). Safe to re-run multiple
--           times — every statement is idempotent (IF NOT EXISTS / DO $$ blocks).
--
-- What this script covers:
--   1. Users            — appleId column (Apple Sign-In)  [2026-06]
--   2. WasteRecord      — collectedAt / deliveredAt timestamps (driver pickup)
--   3. ProcessingBatch  — fedQuantity (larvae feeding) + waste classification
--                         columns (wasteType, specificWasteItem, instructions)
--   4. Cage table       — full create if absent (breeding cage management)
--   5. Tray table       — full create if absent (larvae feeding trays)
--   (Users resetPasswordCode / resetPasswordExpires are added in section 1 too.)
--
-- Prerequisites : Scripts 01-10 applied (or an equivalent schema). On a fresh
--                 install, running 01-11 in order reproduces the full schema.
-- Usage         : PGPASSWORD=<pw> psql -U <user> -d biodigital -f 11_sync_schema_latest.sql
-- Safe to re-run: yes.
-- =============================================================================

\set ON_ERROR_STOP on
\connect biodigital

-- =============================================================================
-- 1. USERS — appleId (Apple Sign-In) + password-reset code columns
-- =============================================================================

BEGIN;

-- Nullable unique column (schema: appleId String? @unique)
ALTER TABLE "Users" ADD COLUMN IF NOT EXISTS "appleId" TEXT;

DO $$ BEGIN
  ALTER TABLE "Users" ADD CONSTRAINT "Users_appleId_key" UNIQUE ("appleId");
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- Password reset by short 6-digit code (schema: resetPasswordCode String?,
-- resetPasswordExpires DateTime?)
ALTER TABLE "Users"
  ADD COLUMN IF NOT EXISTS "resetPasswordCode" TEXT,
  ADD COLUMN IF NOT EXISTS "resetPasswordExpires" TIMESTAMPTZ;

COMMIT;

-- =============================================================================
-- 2. WASTE RECORD — collection / delivery timestamps
--    (deliveredAt may already exist from earlier scripts; both are idempotent)
-- =============================================================================

BEGIN;

ALTER TABLE "WasteRecord"
  ADD COLUMN IF NOT EXISTS "collectedAt" TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS "deliveredAt" TIMESTAMPTZ;

COMMIT;

-- =============================================================================
-- 3. PROCESSING BATCH — fedQuantity + waste classification fields
-- =============================================================================

BEGIN;

-- Amount of this batch's waste already fed to larvae (Stage 3)
ALTER TABLE "ProcessingBatch"
  ADD COLUMN IF NOT EXISTS "fedQuantity" DOUBLE PRECISION NOT NULL DEFAULT 0;

-- Waste classification + handling instructions (set in Waste Batching)
ALTER TABLE "ProcessingBatch"
  ADD COLUMN IF NOT EXISTS "wasteType" TEXT,
  ADD COLUMN IF NOT EXISTS "specificWasteItem" TEXT,
  ADD COLUMN IF NOT EXISTS "instructions" TEXT;

COMMIT;

-- =============================================================================
-- 4. CAGE TABLE (create if absent) — breeding cage management
--    Mirrors src/startup.js ensureCageTable()
-- =============================================================================

BEGIN;

CREATE TABLE IF NOT EXISTS "Cage" (
  id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  "cageId" TEXT NOT NULL,
  description TEXT,
  location TEXT,
  capacity DOUBLE PRECISION,
  status TEXT NOT NULL DEFAULT 'ACTIVE',
  notes TEXT,
  "createdById" TEXT REFERENCES "Users"(id),
  "batchId" TEXT REFERENCES "ProcessingBatch"(id),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE UNIQUE INDEX IF NOT EXISTS "Cage_cageId_key" ON "Cage"("cageId");
CREATE INDEX IF NOT EXISTS "Cage_batchId_idx" ON "Cage"("batchId");
CREATE INDEX IF NOT EXISTS "Cage_createdById_idx" ON "Cage"("createdById");

COMMIT;

-- =============================================================================
-- 5. TRAY TABLE (create if absent) — larvae feeding trays
--    Mirrors src/startup.js ensureTrayTable()
-- =============================================================================

BEGIN;

CREATE TABLE IF NOT EXISTS "Tray" (
  id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  "trayId" TEXT NOT NULL,
  description TEXT,
  location TEXT,
  capacity DOUBLE PRECISION,
  status TEXT NOT NULL DEFAULT 'ACTIVE',
  notes TEXT,
  "createdById" TEXT REFERENCES "Users"(id),
  "batchId" TEXT REFERENCES "ProcessingBatch"(id),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE UNIQUE INDEX IF NOT EXISTS "Tray_trayId_key" ON "Tray"("trayId");
CREATE INDEX IF NOT EXISTS "Tray_batchId_idx" ON "Tray"("batchId");
CREATE INDEX IF NOT EXISTS "Tray_createdById_idx" ON "Tray"("createdById");

COMMIT;

-- =============================================================================

\echo ''
\echo '✅  11_sync_schema_latest.sql complete — database schema is fully up to date.'
