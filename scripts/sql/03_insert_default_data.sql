-- =============================================================================
-- BioDigital BSF Farm — Script 03: Insert Default Data
-- =============================================================================
-- Purpose : Seed the database with the mandatory default records required
--           for the application to function on first boot:
--             • Default system settings (waste points rate, carbon factor, etc.)
--             • One SUPER_ADMIN user
--             • One default Admin company record linked to the SUPER_ADMIN
--             • A default company Vehicle
-- Run as  : psql -U biodigital -d biodigital -f 03_insert_default_data.sql
-- NOTE    : Change the SUPER_ADMIN password hash before going to production.
--           Generate a bcrypt hash:
--             node -e "const b=require('bcryptjs');b.hash('YourPassword',10).then(console.log)"
-- =============================================================================

\set ON_ERROR_STOP on
\connect biodigital

BEGIN;

-- =============================================================================
-- 1. SYSTEM SETTINGS
-- =============================================================================
INSERT INTO "SystemSetting" ("id", "key", "value", "description", "category", "updatedBy")
VALUES
  (
    gen_random_uuid()::TEXT,
    'waste_points_rate',
    '{"pointsPerKg": 10, "currency": "points", "description": "Points awarded per kg of waste supplied"}'::JSONB,
    'Number of loyalty points awarded per kilogram of waste supplied by a supplier',
    'rewards',
    'system'
  ),
  (
    gen_random_uuid()::TEXT,
    'carbon_calculation_factor',
    '{"kgCO2PerKgWaste": 0.85, "methaneFactorKgCO2e": 21, "description": "Carbon saving factors"}'::JSONB,
    'Environmental impact calculation factors (kg CO2 saved per kg waste diverted from landfill)',
    'environment',
    'system'
  ),
  (
    gen_random_uuid()::TEXT,
    'system_name',
    '"BioDigital BSF Farm"'::JSONB,
    'Platform display name',
    'general',
    'system'
  ),
  (
    gen_random_uuid()::TEXT,
    'support_email',
    '"support@biodigitalbsf.com"'::JSONB,
    'Customer support email address',
    'general',
    'system'
  ),
  (
    gen_random_uuid()::TEXT,
    'support_phone',
    '"+233000000000"'::JSONB,
    'Customer support phone number',
    'general',
    'system'
  ),
  (
    gen_random_uuid()::TEXT,
    'default_currency',
    '"GHS"'::JSONB,
    'Default currency code (ISO 4217)',
    'finance',
    'system'
  ),
  (
    gen_random_uuid()::TEXT,
    'default_waste_unit',
    '"kg"'::JSONB,
    'Default unit of measurement for waste records',
    'waste',
    'system'
  ),
  (
    gen_random_uuid()::TEXT,
    'max_batch_size_kg',
    '5000'::JSONB,
    'Maximum input quantity (kg) allowed per processing batch',
    'processing',
    'system'
  ),
  (
    gen_random_uuid()::TEXT,
    'notification_retention_days',
    '90'::JSONB,
    'Number of days to retain read notifications before auto-deletion',
    'notifications',
    'system'
  ),
  (
    gen_random_uuid()::TEXT,
    'offline_sync_max_retry',
    '5'::JSONB,
    'Maximum number of retry attempts for failed offline sync operations',
    'sync',
    'system'
  ),
  (
    gen_random_uuid()::TEXT,
    'driver_rating_threshold',
    '3.5'::JSONB,
    'Minimum driver rating before suspension review is triggered',
    'drivers',
    'system'
  ),
  (
    gen_random_uuid()::TEXT,
    'order_auto_cancel_hours',
    '48'::JSONB,
    'Hours after which an unpaid/unconfirmed order is automatically cancelled',
    'orders',
    'system'
  )
ON CONFLICT ("key") DO NOTHING;


-- =============================================================================
-- 2. SUPER ADMIN USER
-- =============================================================================
-- Password below is a bcrypt hash of "Admin@1234" (cost factor 10).
-- CHANGE THIS BEFORE GOING LIVE.
INSERT INTO "Users" (
  "id", "email", "password", "fullName", "phoneNumber",
  "role", "status", "onboardingStep", "emailVerified", "phoneVerified",
  "managedById"
)
VALUES (
  'superadmin-user-001',
  'superadmin@biodigitalbsf.com',
  crypt('Admin@1234', gen_salt('bf', 10)),
  'Super Administrator',
  '+233000000000',
  'SUPER_ADMIN',
  'ACTIVE',
  'COMPLETE',
  TRUE,
  TRUE,
  NULL
)
ON CONFLICT ("id") DO NOTHING;

-- Also ensure the email uniqueness is respected (idempotent upsert by email)
INSERT INTO "Users" (
  "id", "email", "password", "fullName", "phoneNumber",
  "role", "status", "onboardingStep", "emailVerified", "phoneVerified"
)
VALUES (
  gen_random_uuid()::TEXT,
  'superadmin@biodigitalbsf.com',
  crypt('Admin@1234', gen_salt('bf', 10)),
  'Super Administrator',
  '+233000000000',
  'SUPER_ADMIN',
  'ACTIVE',
  'COMPLETE',
  TRUE,
  TRUE
)
ON CONFLICT ("email") DO NOTHING;

COMMIT;

\echo ''
\echo '✅  03_insert_default_data.sql — Default data seeded successfully.'
\echo '⚠️   IMPORTANT: Change the SUPER_ADMIN and ADMIN passwords before going live!'
