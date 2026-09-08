-- =============================================================================
-- BioDigital BSF Farm — Script 01: Create Database
-- =============================================================================
-- Purpose : Create the PostgreSQL database, enable required extensions,
--           and define all custom ENUM types used by the application.
-- Run as  : PostgreSQL superuser (postgres)
-- Usage   : psql -U postgres -f 01_create_database.sql
-- =============================================================================

\set ON_ERROR_STOP on

-- ── Create database (idempotent) ──────────────────────────────────────────────
SELECT 'CREATE DATABASE biodigital'
  WHERE NOT EXISTS (
    SELECT FROM pg_database WHERE datname = 'biodigital'
  )
\gexec

-- ── Connect to the new database ──────────────────────────────────────────────
\connect biodigital

-- ── Extensions ───────────────────────────────────────────────────────────────
CREATE EXTENSION IF NOT EXISTS "pgcrypto";   -- bcrypt hashing via crypt()
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";  -- uuid_generate_v4()

-- ── Trigger helper: auto-update "updatedAt" columns ─────────────────────────
CREATE OR REPLACE FUNCTION trigger_set_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW."updatedAt" = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- =============================================================================
-- ENUM TYPES
-- =============================================================================

-- User
CREATE TYPE "UserRole" AS ENUM (
  'SUPER_ADMIN', 'ADMIN', 'MANAGER', 'USER', 'DRIVER', 'BUYER', 'SUPPLIER'
);

CREATE TYPE "UserStatus" AS ENUM (
  'ACTIVE', 'INACTIVE', 'SUSPENDED', 'PENDING_VERIFICATION'
);

CREATE TYPE "OnboardingStep" AS ENUM (
  'COMPLETE', 'PENDING_OTP', 'PENDING_CODE', 'PENDING_LOCATION', 'PENDING_PROFILE'
);

-- Admin / Company
CREATE TYPE "SubscriptionStatus" AS ENUM (
  'TRIAL', 'ACTIVE', 'EXPIRED', 'CANCELLED', 'SUSPENDED'
);

-- Farm
CREATE TYPE "FarmType" AS ENUM (
  'FAMILY_FARM', 'PROFESSIONAL_FARM', 'CORPORATE_FARM', 'COOPERATIVE_FARM',
  'PERSONAL_FARM', 'COMMUNITY_FARM', 'OTHER'
);

CREATE TYPE "FarmStatus" AS ENUM (
  'ACTIVE', 'INACTIVE', 'SUSPENDED', 'PENDING_APPROVAL'
);

-- Driver
CREATE TYPE "DriverStatus" AS ENUM (
  'PENDING', 'APPROVED', 'REJECTED', 'SUSPENDED', 'ACTIVE', 'OFFLINE'
);

-- Buyer
CREATE TYPE "BuyerStatus" AS ENUM (
  'ACTIVE', 'INACTIVE', 'SUSPENDED', 'PENDING_VERIFICATION'
);

-- Supplier
CREATE TYPE "SupplierStatus" AS ENUM (
  'PENDING', 'APPROVED', 'REJECTED', 'ACTIVE', 'SUSPENDED'
);

-- Waste
CREATE TYPE "WasteSourceType" AS ENUM (
  'AGRICULTURAL', 'FOOD_WASTE', 'MARKET_WASTE', 'HOUSEHOLD',
  'INDUSTRIAL', 'MUNICIPAL', 'COMMERCIAL', 'OTHER'
);

CREATE TYPE "WasteStatus" AS ENUM (
  'PENDING', 'SCHEDULED', 'COLLECTED', 'PROCESSING', 'PROCESSED',
  'ACKNOWLEDGED', 'NO_SHOW', 'CANCELLED', 'REJECTED'
);

-- Processing
CREATE TYPE "ProcessType" AS ENUM (
  'COMPOSTING', 'ANAEROBIC_DIGESTION', 'VERMICOMPOSTING',
  'BSF_LARVAE_PROCESSING', 'BLACK_SOLDIER_FLY', 'FERMENTATION',
  'DRYING', 'PELLETIZING', 'OTHER'
);

CREATE TYPE "BatchStatus" AS ENUM (
  'PLANNED', 'PENDING', 'ACTIVE', 'PAUSED', 'COMPLETED', 'FAILED', 'CANCELLED'
);

-- Quality
CREATE TYPE "QualityType" AS ENUM (
  'TEMPERATURE', 'PH', 'MOISTURE', 'NUTRIENT_CONTENT', 'PATHOGEN_TEST',
  'HEAVY_METAL', 'ODOR', 'APPEARANCE', 'OTHER'
);

-- Activity
CREATE TYPE "ActivityAction" AS ENUM (
  'BATCH_STARTED', 'BATCH_PAUSED', 'BATCH_RESUMED', 'BATCH_COMPLETED',
  'TEMPERATURE_CHANGED', 'MATERIAL_ADDED', 'OUTPUT_RECORDED',
  'QUALITY_CHECKED', 'TEAM_ASSIGNED', 'NOTE_ADDED', 'IMAGE_UPLOADED'
);

-- Products
CREATE TYPE "ProductCategory" AS ENUM (
  'ORGANIC_FERTILIZER', 'PROTEIN_FEED', 'INSECT_OIL', 'SOIL_CONDITIONER',
  'DRIED_LARVAE', 'COMPOST', 'LIQUID_FERTILIZER', 'BIOCHAR', 'OTHER'
);

CREATE TYPE "ProductStatus" AS ENUM (
  'ACTIVE', 'INACTIVE', 'OUT_OF_STOCK', 'DISCONTINUED'
);

-- Orders
CREATE TYPE "OrderStatus" AS ENUM (
  'PENDING', 'CONFIRMED', 'PROCESSING', 'READY_FOR_PICKUP', 'SHIPPED',
  'OUT_FOR_DELIVERY', 'DELIVERED', 'COMPLETED', 'CANCELLED', 'REFUNDED', 'ON_HOLD'
);

CREATE TYPE "PaymentMethod" AS ENUM (
  'CASH_ON_DELIVERY', 'MOBILE_MONEY', 'BANK_TRANSFER', 'CREDIT_CARD',
  'DEBIT_CARD', 'PAYPAL', 'STRIPE', 'OTHER'
);

CREATE TYPE "PaymentStatus" AS ENUM (
  'PENDING', 'PAID', 'FAILED', 'REFUNDED', 'PARTIALLY_REFUNDED'
);

-- Invoice
CREATE TYPE "InvoiceStatus" AS ENUM (
  'ISSUED', 'SENT', 'PAID', 'OVERDUE', 'CANCELLED'
);

-- Shipment
CREATE TYPE "ShipmentStatus" AS ENUM (
  'PENDING', 'LABEL_CREATED', 'PICKED_UP', 'IN_TRANSIT',
  'OUT_FOR_DELIVERY', 'DELIVERED', 'FAILED', 'RETURNED'
);

-- Notifications
CREATE TYPE "NotificationType" AS ENUM (
  'INFO', 'SUCCESS', 'WARNING', 'ERROR', 'ALERT',
  'ORDER_UPDATE', 'WASTE_COLLECTION', 'BATCH_UPDATE',
  'PAYMENT_CONFIRMED', 'DELIVERY_UPDATE', 'SYSTEM_ALERT', 'SUPPORT'
);

-- Support Tickets
CREATE TYPE "SupportCategory" AS ENUM (
  'ORDER_ISSUE', 'DELIVERY_ISSUE', 'PAYMENT_ISSUE',
  'PRODUCT_ISSUE', 'ACCOUNT_ISSUE', 'APP_BUG', 'OTHER'
);

CREATE TYPE "SupportStatus" AS ENUM (
  'OPEN', 'IN_PROGRESS', 'RESOLVED', 'CLOSED'
);

CREATE TYPE "SupportPriority" AS ENUM (
  'LOW', 'MEDIUM', 'HIGH', 'URGENT'
);

-- Offline sync
CREATE TYPE "SyncStatus" AS ENUM (
  'PENDING', 'SYNCED', 'FAILED', 'CONFLICT'
);

-- Reports
CREATE TYPE "ReportType" AS ENUM (
  'WASTE_SUMMARY', 'PROCESSING_EFFICIENCY', 'FINANCIAL_REPORT',
  'CARBON_SAVINGS', 'PRODUCT_SALES', 'FARM_PERFORMANCE',
  'DRIVER_PERFORMANCE', 'CUSTOMER_ANALYTICS', 'INVENTORY_REPORT', 'QUALITY_REPORT'
);

-- Integrations
CREATE TYPE "IntegrationType" AS ENUM (
  'CARBON_API', 'PAYMENT_GATEWAY', 'SMS_GATEWAY', 'EMAIL_SERVICE',
  'MAP_SERVICE', 'IOT_DEVICE', 'ERP_SYSTEM', 'OTHER'
);

CREATE TYPE "IntegrationStatus" AS ENUM (
  'ACTIVE', 'INACTIVE', 'ERROR', 'PENDING'
);

\echo ''
\echo '✅  01_create_database.sql — Database, extensions, and ENUM types created.'
