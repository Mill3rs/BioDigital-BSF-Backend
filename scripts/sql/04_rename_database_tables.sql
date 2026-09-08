-- =============================================================================
-- BioDigital BSF Farm — Script 04: Rename Database Tables (x_ prefix backup)
-- =============================================================================
-- Purpose : Safely rename all current live tables to an "x_" prefix,
--           preserving all existing data while freeing up the original
--           table names for the updated schema (Script 05).
--
-- Workflow:
--   STEP 1 → Run this script  (renames live tables → x_TableName)
--   STEP 2 → Run 05_update_database_tables.sql  (creates new tables)
--   STEP 3 → Run 06_insert_old_data_into_updated_database_tables.sql
--   STEP 4 → Run 07_delete_old_tables.sql  (drops x_ tables)
--
-- Usage   : psql -U biodigital -d biodigital -f 04_rename_database_tables.sql
-- WARNING : Do NOT run this on a live system without a database backup first.
-- =============================================================================

\set ON_ERROR_STOP on
\connect biodigital

BEGIN;

-- ── Drop all updatedAt triggers before renaming (triggers follow table names) ─
DROP TRIGGER IF EXISTS "Admin_updatedAt"          ON "Admin";
DROP TRIGGER IF EXISTS "Vehicle_updatedAt"        ON "Vehicle";
DROP TRIGGER IF EXISTS "Users_updatedAt"           ON "Users";
DROP TRIGGER IF EXISTS "Farm_updatedAt"           ON "Farm";
DROP TRIGGER IF EXISTS "DriverProfile_updatedAt"  ON "DriverProfile";
DROP TRIGGER IF EXISTS "BuyerProfile_updatedAt"   ON "BuyerProfile";
DROP TRIGGER IF EXISTS "SupplierProfile_updatedAt" ON "SupplierProfile";
DROP TRIGGER IF EXISTS "ProcessingBatch_updatedAt" ON "ProcessingBatch";
DROP TRIGGER IF EXISTS "WasteRecord_updatedAt"    ON "WasteRecord";
DROP TRIGGER IF EXISTS "Product_updatedAt"        ON "Product";
DROP TRIGGER IF EXISTS "ProductVariant_updatedAt" ON "ProductVariant";
DROP TRIGGER IF EXISTS "Order_updatedAt"          ON "Order";
DROP TRIGGER IF EXISTS "Cart_updatedAt"           ON "Cart";
DROP TRIGGER IF EXISTS "Integration_updatedAt"    ON "Integration";
DROP TRIGGER IF EXISTS "SystemSetting_updatedAt"  ON "SystemSetting";

-- ── Rename tables in reverse-dependency order (children first) ────────────────
-- (Prevents FK constraint violations during rename operations)

-- Leaf / no-dependent tables first
ALTER TABLE IF EXISTS "CartItem"        RENAME TO "x_CartItem";
ALTER TABLE IF EXISTS "Cart"            RENAME TO "x_Cart";
ALTER TABLE IF EXISTS "Shipment"        RENAME TO "x_Shipment";
ALTER TABLE IF EXISTS "Invoice"         RENAME TO "x_Invoice";
ALTER TABLE IF EXISTS "OrderItem"       RENAME TO "x_OrderItem";
ALTER TABLE IF EXISTS "Order"           RENAME TO "x_Order";
ALTER TABLE IF EXISTS "ProductReview"   RENAME TO "x_ProductReview";
ALTER TABLE IF EXISTS "ProductVariant"  RENAME TO "x_ProductVariant";
ALTER TABLE IF EXISTS "Product"         RENAME TO "x_Product";
ALTER TABLE IF EXISTS "ActivityLog"     RENAME TO "x_ActivityLog";
ALTER TABLE IF EXISTS "TeamAssignment"  RENAME TO "x_TeamAssignment";
ALTER TABLE IF EXISTS "QualityCheck"    RENAME TO "x_QualityCheck";
ALTER TABLE IF EXISTS "WasteRecord"     RENAME TO "x_WasteRecord";
ALTER TABLE IF EXISTS "ProcessingBatch" RENAME TO "x_ProcessingBatch";
ALTER TABLE IF EXISTS "OfflineSync"     RENAME TO "x_OfflineSync";
ALTER TABLE IF EXISTS "Notification"    RENAME TO "x_Notification";
ALTER TABLE IF EXISTS "Report"          RENAME TO "x_Report";
ALTER TABLE IF EXISTS "Integration"     RENAME TO "x_Integration";
ALTER TABLE IF EXISTS "SupplierProfile" RENAME TO "x_SupplierProfile";
ALTER TABLE IF EXISTS "BuyerProfile"    RENAME TO "x_BuyerProfile";
ALTER TABLE IF EXISTS "DriverProfile"   RENAME TO "x_DriverProfile";
ALTER TABLE IF EXISTS "Farm"            RENAME TO "x_Farm";
ALTER TABLE IF EXISTS "Vehicle"         RENAME TO "x_Vehicle";
ALTER TABLE IF EXISTS "Users"            RENAME TO "x_Users";
ALTER TABLE IF EXISTS "SystemSetting"   RENAME TO "x_SystemSetting";
ALTER TABLE IF EXISTS "Admin"           RENAME TO "x_Admin";

-- ── Record the rename timestamp ───────────────────────────────────────────────
-- (Stored as a comment on the x_Admin table as a lightweight audit trail)
DO $$
BEGIN
  EXECUTE format(
    'COMMENT ON TABLE "x_Admin" IS %L',
    'Pre-migration backup. Renamed at: ' || NOW()::TEXT
  );
END;
$$;

COMMIT;

\echo ''
\echo '✅  04_rename_database_tables.sql — All tables renamed with x_ prefix.'
\echo '    Next: run 05_update_database_tables.sql to create the updated schema.'
