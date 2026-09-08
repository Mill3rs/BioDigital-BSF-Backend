-- =============================================================================
-- BioDigital BSF Farm — Script 07: Delete Old (x_) Backup Tables
-- =============================================================================
-- Purpose : Drop all x_-prefixed backup tables created by Script 04 after
--           verifying that the data migration (Script 06) was successful.
--
-- IMPORTANT: Run this script ONLY after you have:
--   1. Executed 06_insert_old_data_into_updated_database_tables.sql
--   2. Verified that all row counts match between new and x_ tables
--   3. Confirmed the application is working correctly with the new tables
--
-- This action is IRREVERSIBLE. Ensure you have a full database backup before
-- proceeding. A recommended verification query is provided at the bottom.
--
-- Usage : psql -U biodigital -d biodigital -f 07_delete_old_tables.sql
-- =============================================================================

\set ON_ERROR_STOP on
\connect biodigital

-- =============================================================================
-- PRE-FLIGHT: Row count verification
-- =============================================================================
-- Uncomment the block below to verify counts BEFORE dropping:
/*
SELECT
  'Admin'           AS table_name,
  (SELECT COUNT(*) FROM "Admin")    AS new_count,
  (SELECT COUNT(*) FROM "x_Admin")  AS old_count
UNION ALL SELECT 'User',           (SELECT COUNT(*) FROM "Users"),           (SELECT COUNT(*) FROM "x_Users")
UNION ALL SELECT 'Farm',           (SELECT COUNT(*) FROM "Farm"),           (SELECT COUNT(*) FROM "x_Farm")
UNION ALL SELECT 'Vehicle',        (SELECT COUNT(*) FROM "Vehicle"),        (SELECT COUNT(*) FROM "x_Vehicle")
UNION ALL SELECT 'DriverProfile',  (SELECT COUNT(*) FROM "DriverProfile"),  (SELECT COUNT(*) FROM "x_DriverProfile")
UNION ALL SELECT 'BuyerProfile',   (SELECT COUNT(*) FROM "BuyerProfile"),   (SELECT COUNT(*) FROM "x_BuyerProfile")
UNION ALL SELECT 'SupplierProfile',(SELECT COUNT(*) FROM "SupplierProfile"),(SELECT COUNT(*) FROM "x_SupplierProfile")
UNION ALL SELECT 'ProcessingBatch',(SELECT COUNT(*) FROM "ProcessingBatch"),(SELECT COUNT(*) FROM "x_ProcessingBatch")
UNION ALL SELECT 'WasteRecord',    (SELECT COUNT(*) FROM "WasteRecord"),    (SELECT COUNT(*) FROM "x_WasteRecord")
UNION ALL SELECT 'QualityCheck',   (SELECT COUNT(*) FROM "QualityCheck"),   (SELECT COUNT(*) FROM "x_QualityCheck")
UNION ALL SELECT 'TeamAssignment', (SELECT COUNT(*) FROM "TeamAssignment"), (SELECT COUNT(*) FROM "x_TeamAssignment")
UNION ALL SELECT 'ActivityLog',    (SELECT COUNT(*) FROM "ActivityLog"),    (SELECT COUNT(*) FROM "x_ActivityLog")
UNION ALL SELECT 'Product',        (SELECT COUNT(*) FROM "Product"),        (SELECT COUNT(*) FROM "x_Product")
UNION ALL SELECT 'ProductVariant', (SELECT COUNT(*) FROM "ProductVariant"), (SELECT COUNT(*) FROM "x_ProductVariant")
UNION ALL SELECT 'ProductReview',  (SELECT COUNT(*) FROM "ProductReview"),  (SELECT COUNT(*) FROM "x_ProductReview")
UNION ALL SELECT 'Order',          (SELECT COUNT(*) FROM "Order"),          (SELECT COUNT(*) FROM "x_Order")
UNION ALL SELECT 'OrderItem',      (SELECT COUNT(*) FROM "OrderItem"),      (SELECT COUNT(*) FROM "x_OrderItem")
UNION ALL SELECT 'Invoice',        (SELECT COUNT(*) FROM "Invoice"),        (SELECT COUNT(*) FROM "x_Invoice")
UNION ALL SELECT 'Shipment',       (SELECT COUNT(*) FROM "Shipment"),       (SELECT COUNT(*) FROM "x_Shipment")
UNION ALL SELECT 'Cart',           (SELECT COUNT(*) FROM "Cart"),           (SELECT COUNT(*) FROM "x_Cart")
UNION ALL SELECT 'CartItem',       (SELECT COUNT(*) FROM "CartItem"),       (SELECT COUNT(*) FROM "x_CartItem")
UNION ALL SELECT 'Notification',   (SELECT COUNT(*) FROM "Notification"),   (SELECT COUNT(*) FROM "x_Notification")
UNION ALL SELECT 'OfflineSync',    (SELECT COUNT(*) FROM "OfflineSync"),    (SELECT COUNT(*) FROM "x_OfflineSync")
UNION ALL SELECT 'Report',         (SELECT COUNT(*) FROM "Report"),         (SELECT COUNT(*) FROM "x_Report")
UNION ALL SELECT 'Integration',    (SELECT COUNT(*) FROM "Integration"),    (SELECT COUNT(*) FROM "x_Integration")
UNION ALL SELECT 'SystemSetting',  (SELECT COUNT(*) FROM "SystemSetting"),  (SELECT COUNT(*) FROM "x_SystemSetting")
ORDER BY table_name;
*/

BEGIN;

-- =============================================================================
-- DROP x_ backup tables — in reverse dependency order (children first)
-- =============================================================================
DROP TABLE IF EXISTS "x_CartItem"        CASCADE;
DROP TABLE IF EXISTS "x_Cart"            CASCADE;
DROP TABLE IF EXISTS "x_Shipment"        CASCADE;
DROP TABLE IF EXISTS "x_Invoice"         CASCADE;
DROP TABLE IF EXISTS "x_OrderItem"       CASCADE;
DROP TABLE IF EXISTS "x_Order"           CASCADE;
DROP TABLE IF EXISTS "x_ProductReview"   CASCADE;
DROP TABLE IF EXISTS "x_ProductVariant"  CASCADE;
DROP TABLE IF EXISTS "x_Product"         CASCADE;
DROP TABLE IF EXISTS "x_ActivityLog"     CASCADE;
DROP TABLE IF EXISTS "x_TeamAssignment"  CASCADE;
DROP TABLE IF EXISTS "x_QualityCheck"    CASCADE;
DROP TABLE IF EXISTS "x_WasteRecord"     CASCADE;
DROP TABLE IF EXISTS "x_ProcessingBatch" CASCADE;
DROP TABLE IF EXISTS "x_OfflineSync"     CASCADE;
DROP TABLE IF EXISTS "x_Notification"    CASCADE;
DROP TABLE IF EXISTS "x_Report"          CASCADE;
DROP TABLE IF EXISTS "x_Integration"     CASCADE;
DROP TABLE IF EXISTS "x_SupplierProfile" CASCADE;
DROP TABLE IF EXISTS "x_BuyerProfile"    CASCADE;
DROP TABLE IF EXISTS "x_DriverProfile"   CASCADE;
DROP TABLE IF EXISTS "x_Farm"            CASCADE;
DROP TABLE IF EXISTS "x_Vehicle"         CASCADE;
DROP TABLE IF EXISTS "x_Users"            CASCADE;
DROP TABLE IF EXISTS "x_SystemSetting"   CASCADE;
DROP TABLE IF EXISTS "x_Admin"           CASCADE;

COMMIT;

\echo ''
\echo '✅  07_delete_old_tables.sql — All x_ backup tables have been dropped.'
\echo '    Migration complete. The database is now running the updated schema.'
