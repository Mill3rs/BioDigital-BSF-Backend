-- =============================================================================
-- BioDigital BSF Farm — Script 10: Sync Schema (Idempotent)
-- =============================================================================
-- Purpose : Bring an EXISTING database fully up to date with the current
--           Prisma schema without data loss. Safe to re-run multiple times.
--           Covers every difference between the v1 SQL scripts (01-09) and
--           the live schema.prisma as of May 2026.
--
-- What this script does:
--   1. Enum patches        — add missing enum values / types
--   2. Users patches       — googleId, location columns; nullable email/password
--   3. SupplierProfile     — crops column
--   4. ProcessingBatch     — qualityScore column
--   5. ProductVariant      — points_cost column
--   6. SupportTicket table — full create if absent
--   7. PayoutRequest table — full create if absent
--
-- Prerequisites : Scripts 01-08 have already been applied (or equivalent).
-- Usage         : PGPASSWORD=<pw> psql -U <user> -d biodigital -f 10_sync_schema.sql
-- Safe to re-run: every statement uses IF NOT EXISTS / DO $$ blocks
-- =============================================================================

\set ON_ERROR_STOP on
\connect biodigital

BEGIN;

-- =============================================================================
-- 1. ENUM PATCHES
-- =============================================================================

-- NotificationType: add SUPPORT if not already present
DO $$ BEGIN
  ALTER TYPE "NotificationType" ADD VALUE IF NOT EXISTS 'SUPPORT';
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- WasteStatus: add ACKNOWLEDGED + NO_SHOW (in case DB predates migration 20260407)
DO $$ BEGIN
  ALTER TYPE "WasteStatus" ADD VALUE IF NOT EXISTS 'ACKNOWLEDGED';
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
DO $$ BEGIN
  ALTER TYPE "WasteStatus" ADD VALUE IF NOT EXISTS 'NO_SHOW';
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- OnboardingStep: add PENDING_OTP (registration OTP verification step)
DO $$ BEGIN
  ALTER TYPE "OnboardingStep" ADD VALUE IF NOT EXISTS 'PENDING_OTP';
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- SupportCategory — create only if it doesn't exist yet
DO $$ BEGIN
  CREATE TYPE "SupportCategory" AS ENUM (
    'ORDER_ISSUE', 'DELIVERY_ISSUE', 'PAYMENT_ISSUE',
    'PRODUCT_ISSUE', 'ACCOUNT_ISSUE', 'APP_BUG', 'OTHER'
  );
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- SupportStatus
DO $$ BEGIN
  CREATE TYPE "SupportStatus" AS ENUM (
    'OPEN', 'IN_PROGRESS', 'RESOLVED', 'CLOSED'
  );
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- SupportPriority
DO $$ BEGIN
  CREATE TYPE "SupportPriority" AS ENUM (
    'LOW', 'MEDIUM', 'HIGH', 'URGENT'
  );
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

COMMIT;

-- ALTER TYPE ... ADD VALUE cannot run inside a transaction block, so we commit
-- above and run the DO blocks outside a transaction for safety.

-- =============================================================================
-- 2. Users TABLE PATCHES
-- =============================================================================

BEGIN;

-- Make email nullable (Google-OAuth accounts may have no email/password)
ALTER TABLE "Users" ALTER COLUMN "email" DROP NOT NULL;

-- Make password nullable
ALTER TABLE "Users" ALTER COLUMN "password" DROP NOT NULL;

-- Add googleId (unique, nullable)
ALTER TABLE "Users" ADD COLUMN IF NOT EXISTS "googleId" TEXT;
DO $$ BEGIN
  ALTER TABLE "Users" ADD CONSTRAINT "Users_googleId_key" UNIQUE ("googleId");
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- Add location (plain text, e.g. "Accra, Ghana")
ALTER TABLE "Users" ADD COLUMN IF NOT EXISTS "location" TEXT;

-- Partial index for googleId (non-null only)
CREATE INDEX IF NOT EXISTS "Users_googleId_idx"
  ON "Users" ("googleId") WHERE "googleId" IS NOT NULL;

-- Adjust email index to be partial (non-null only) to avoid duplicate-null issues
DROP INDEX IF EXISTS "Users_email_idx";
CREATE INDEX IF NOT EXISTS "Users_email_idx"
  ON "Users" ("email") WHERE "email" IS NOT NULL;

COMMIT;

-- =============================================================================
-- 3. SupplierProfile — add crops column
-- =============================================================================

BEGIN;

ALTER TABLE "SupplierProfile"
  ADD COLUMN IF NOT EXISTS "crops" TEXT[] NOT NULL DEFAULT '{}';

COMMIT;

-- =============================================================================
-- 4. ProcessingBatch — add qualityScore column
-- =============================================================================

BEGIN;

ALTER TABLE "ProcessingBatch"
  ADD COLUMN IF NOT EXISTS "qualityScore" DOUBLE PRECISION;

COMMIT;

-- =============================================================================
-- 5. ProductVariant — add points_cost column
-- =============================================================================

BEGIN;

ALTER TABLE "ProductVariant"
  ADD COLUMN IF NOT EXISTS "points_cost" INTEGER;

COMMIT;

-- =============================================================================
-- 6. SupportTicket TABLE (create if absent)
-- =============================================================================

BEGIN;

CREATE TABLE IF NOT EXISTS "SupportTicket" (
  "id"           TEXT               NOT NULL DEFAULT gen_random_uuid()::TEXT,
  "ticketNumber" TEXT               NOT NULL UNIQUE,
  "userId"       TEXT               NOT NULL,
  "userRole"     TEXT               NOT NULL,
  "category"     "SupportCategory"  NOT NULL,
  "title"        TEXT               NOT NULL,
  "description"  TEXT               NOT NULL,
  "status"       "SupportStatus"    NOT NULL DEFAULT 'OPEN',
  "priority"     "SupportPriority"  NOT NULL DEFAULT 'MEDIUM',
  "adminNote"    TEXT,
  "resolvedAt"   TIMESTAMPTZ,
  "createdAt"    TIMESTAMPTZ        NOT NULL DEFAULT NOW(),
  "updatedAt"    TIMESTAMPTZ        NOT NULL DEFAULT NOW(),
  CONSTRAINT "SupportTicket_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "SupportTicket_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "Users"("id")
    ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE INDEX IF NOT EXISTS "SupportTicket_userId_idx" ON "SupportTicket" ("userId");
CREATE INDEX IF NOT EXISTS "SupportTicket_status_idx" ON "SupportTicket" ("status");

-- updatedAt trigger (safe re-apply)
DROP TRIGGER IF EXISTS "SupportTicket_updatedAt" ON "SupportTicket";
CREATE TRIGGER "SupportTicket_updatedAt"
  BEFORE UPDATE ON "SupportTicket"
  FOR EACH ROW EXECUTE FUNCTION trigger_set_updated_at();

COMMIT;

-- =============================================================================
-- 7. PayoutRequest TABLE (create if absent)
-- =============================================================================

BEGIN;

CREATE TABLE IF NOT EXISTS "PayoutRequest" (
  "id"                 TEXT             NOT NULL DEFAULT gen_random_uuid()::TEXT,
  "supplierId"         TEXT             NOT NULL,
  "adminId"            TEXT,
  "points"             INTEGER          NOT NULL,
  "amountGhs"          DOUBLE PRECISION NOT NULL,
  "status"             TEXT             NOT NULL DEFAULT 'PENDING',
  "paymentMethod"      TEXT,
  "paymentDetails"     JSONB,
  "adminPaymentMethod" TEXT,
  "notes"              TEXT,
  "processedAt"        TIMESTAMPTZ,
  "processedBy"        TEXT,
  "createdAt"          TIMESTAMPTZ      NOT NULL DEFAULT NOW(),
  "updatedAt"          TIMESTAMPTZ      NOT NULL DEFAULT NOW(),
  CONSTRAINT "PayoutRequest_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "PayoutRequest_supplierId_fkey"
    FOREIGN KEY ("supplierId") REFERENCES "Users"("id")
    ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "PayoutRequest_adminId_fkey"
    FOREIGN KEY ("adminId") REFERENCES "Admin"("id")
    ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT "PayoutRequest_processedBy_fkey"
    FOREIGN KEY ("processedBy") REFERENCES "Users"("id")
    ON DELETE SET NULL ON UPDATE CASCADE
);

CREATE INDEX IF NOT EXISTS "PayoutRequest_supplierId_idx" ON "PayoutRequest" ("supplierId");
CREATE INDEX IF NOT EXISTS "PayoutRequest_status_idx"     ON "PayoutRequest" ("status");

DROP TRIGGER IF EXISTS "PayoutRequest_updatedAt" ON "PayoutRequest";
CREATE TRIGGER "PayoutRequest_updatedAt"
  BEFORE UPDATE ON "PayoutRequest"
  FOR EACH ROW EXECUTE FUNCTION trigger_set_updated_at();

COMMIT;

-- =============================================================================
-- 8. Product — add createdById column (per-company data isolation)
-- =============================================================================

BEGIN;

ALTER TABLE "Product"
  ADD COLUMN IF NOT EXISTS "createdById" TEXT;

CREATE INDEX IF NOT EXISTS "Product_createdById_idx" ON "Product" ("createdById");

COMMIT;

-- =============================================================================
-- 9. Order — add createdById column (per-company data isolation)
-- =============================================================================

BEGIN;

ALTER TABLE "Order"
  ADD COLUMN IF NOT EXISTS "createdById" TEXT;

CREATE INDEX IF NOT EXISTS "Order_createdById_idx" ON "Order" ("createdById");

COMMIT;

-- =============================================================================
-- 10. Vehicle — add adminId column (per-company data isolation)
-- =============================================================================

BEGIN;

ALTER TABLE "Vehicle"
  ADD COLUMN IF NOT EXISTS "adminId" TEXT;

CREATE INDEX IF NOT EXISTS "Vehicle_adminId_idx" ON "Vehicle" ("adminId");

COMMIT;

-- =============================================================================

\echo ''
\echo '✅  10_sync_schema.sql complete — database is now in sync with schema.prisma.'
