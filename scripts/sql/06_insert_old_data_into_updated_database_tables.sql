-- =============================================================================
-- BioDigital BSF Farm — Script 06: Migrate Data from x_ Tables to New Tables
-- =============================================================================
-- Purpose : Copy all rows from the x_-prefixed backup tables into the
--           newly created (updated) tables created by Script 05.
--
-- Strategy:
--   • Tables with NO new columns → INSERT INTO ... SELECT * FROM x_Table
--   • Tables WITH new columns    → INSERT INTO ... SELECT col1, col2, ...,
--                                    NULL / default AS new_col FROM x_Table
--
-- Run AFTER : 05_update_database_tables.sql
-- Run BEFORE: 07_delete_old_tables.sql
-- Usage     : psql -U biodigital -d biodigital -f 06_insert_old_data_into_updated_database_tables.sql
-- =============================================================================

\set ON_ERROR_STOP on
\connect biodigital

BEGIN;

-- ── Disable triggers temporarily so updatedAt triggers don't overwrite ────────
SET session_replication_role = 'replica';

-- =============================================================================
-- 1. Admin  (no new columns)
-- =============================================================================
INSERT INTO "Admin" (
  "id", "companyName", "companyLogo", "taxId", "address", "city", "country",
  "phoneNumber", "email", "region", "landmark", "lat", "lng", "employeeCount",
  "description", "tags", "profileCompleted", "subscription", "subscriptionEnd",
  "maxManagers", "maxFarms", "inviteCode", "createdAt", "updatedAt"
)
SELECT
  "id", "companyName", "companyLogo", "taxId", "address", "city", "country",
  "phoneNumber", "email", "region", "landmark", "lat", "lng", "employeeCount",
  "description", "tags", "profileCompleted", "subscription", "subscriptionEnd",
  "maxManagers", "maxFarms", "inviteCode", "createdAt", "updatedAt"
FROM "x_Admin"
ON CONFLICT ("id") DO NOTHING;

-- =============================================================================
-- 2. Vehicle  (no new columns)
-- =============================================================================
INSERT INTO "Vehicle" (
  "id", "plateNumber", "type", "model", "color", "isActive", "createdAt", "updatedAt"
)
SELECT
  "id", "plateNumber", "type", "model", "color", "isActive", "createdAt", "updatedAt"
FROM "x_Vehicle"
ON CONFLICT ("id") DO NOTHING;

-- =============================================================================
-- 3. SystemSetting  (no new columns)
-- =============================================================================
INSERT INTO "SystemSetting" (
  "id", "key", "value", "description", "category", "updatedBy", "updatedAt"
)
SELECT
  "id", "key", "value", "description", "category", "updatedBy", "updatedAt"
FROM "x_SystemSetting"
ON CONFLICT ("id") DO NOTHING;

-- =============================================================================
-- 4. User  (NEW: fcmToken, twoFactorEnabled, twoFactorSecret, lastActiveAt, deletedAt)
-- =============================================================================
INSERT INTO "Users" (
  "id", "email", "password", "fullName", "phoneNumber", "profileImage",
  "role", "status", "onboardingStep", "emailVerified", "phoneVerified",
  "lastLogin", "managedById", "createdAt", "updatedAt",
  -- new columns with safe defaults
  "fcmToken", "twoFactorEnabled", "twoFactorSecret", "lastActiveAt", "deletedAt"
)
SELECT
  "id", "email", "password", "fullName", "phoneNumber", "profileImage",
  "role", "status", "onboardingStep", "emailVerified", "phoneVerified",
  "lastLogin", "managedById", "createdAt", "updatedAt",
  -- new columns
  NULL AS "fcmToken",
  FALSE AS "twoFactorEnabled",
  NULL AS "twoFactorSecret",
  "lastLogin" AS "lastActiveAt",   -- best approximation from existing data
  NULL AS "deletedAt"
FROM "x_Users"
ON CONFLICT ("id") DO NOTHING;

-- =============================================================================
-- 5. Farm  (NEW: timezone, deletedAt)
-- =============================================================================
INSERT INTO "Farm" (
  "id", "name", "type", "description", "area", "areaUnit", "income",
  "equipment", "labor", "output", "expenses", "profit", "status",
  "location", "country", "region", "city", "postalCode",
  "totalWasteCollected", "totalWasteProcessed", "totalCarbonSaved",
  "totalRevenue", "totalProductsSold", "adminId", "managerId",
  "createdAt", "updatedAt",
  -- new columns
  "timezone", "deletedAt"
)
SELECT
  "id", "name", "type", "description", "area", "areaUnit", "income",
  "equipment", "labor", "output", "expenses", "profit", "status",
  "location", "country", "region", "city", "postalCode",
  "totalWasteCollected", "totalWasteProcessed", "totalCarbonSaved",
  "totalRevenue", "totalProductsSold", "adminId", "managerId",
  "createdAt", "updatedAt",
  -- new columns
  'Africa/Accra' AS "timezone",
  NULL           AS "deletedAt"
FROM "x_Farm"
ON CONFLICT ("id") DO NOTHING;

-- =============================================================================
-- 6. DriverProfile  (NEW: verifiedBy)
-- =============================================================================
INSERT INTO "DriverProfile" (
  "id", "userId", "licenseNumber", "licenseDocument", "licenseExpiry",
  "idCardNumber", "idCardDocument", "passportNumber", "passportDocument",
  "vehicleType", "vehicleModel", "vehiclePlateNumber", "vehicleRegistration",
  "vehicleDocument", "baseLocation", "currentLocation", "rating",
  "totalDeliveries", "status", "verifiedAt", "adminId", "createdAt", "updatedAt",
  -- new column
  "verifiedBy"
)
SELECT
  "id", "userId", "licenseNumber", "licenseDocument", "licenseExpiry",
  "idCardNumber", "idCardDocument", "passportNumber", "passportDocument",
  "vehicleType", "vehicleModel", "vehiclePlateNumber", "vehicleRegistration",
  "vehicleDocument", "baseLocation", "currentLocation", "rating",
  "totalDeliveries", "status", "verifiedAt", "adminId", "createdAt", "updatedAt",
  -- new column
  NULL AS "verifiedBy"
FROM "x_DriverProfile"
ON CONFLICT ("id") DO NOTHING;

-- =============================================================================
-- 7. BuyerProfile  (no new columns)
-- =============================================================================
INSERT INTO "BuyerProfile" (
  "id", "userId", "companyName", "businessType", "taxId", "taxDocument",
  "businessAddress", "deliveryAddress", "preferredPaymentMethod",
  "totalPurchases", "orderCount", "status", "verifiedAt", "createdAt", "updatedAt"
)
SELECT
  "id", "userId", "companyName", "businessType", "taxId", "taxDocument",
  "businessAddress", "deliveryAddress", "preferredPaymentMethod",
  "totalPurchases", "orderCount", "status", "verifiedAt", "createdAt", "updatedAt"
FROM "x_BuyerProfile"
ON CONFLICT ("id") DO NOTHING;

-- =============================================================================
-- 8. SupplierProfile  (NEW: verifiedBy)
-- =============================================================================
INSERT INTO "SupplierProfile" (
  "id", "userId", "supplierType", "organizationName", "farmName", "farmType",
  "farmSize", "farmSizeRange", "primaryProducts", "wasteTypes",
  "weeklyWasteAmount", "weeklyWasteAmountRange", "collectionAddress",
  "preferredPickupTime", "totalWasteSupplied", "totalEarnings",
  "pointsBalance", "pointsEarned", "rating", "status", "verifiedAt",
  "adminId", "createdAt", "updatedAt",
  -- new column
  "verifiedBy"
)
SELECT
  "id", "userId", "supplierType", "organizationName", "farmName", "farmType",
  "farmSize", "farmSizeRange", "primaryProducts", "wasteTypes",
  "weeklyWasteAmount", "weeklyWasteAmountRange", "collectionAddress",
  "preferredPickupTime", "totalWasteSupplied", "totalEarnings",
  "pointsBalance", "pointsEarned", "rating", "status", "verifiedAt",
  "adminId", "createdAt", "updatedAt",
  -- new column
  NULL AS "verifiedBy"
FROM "x_SupplierProfile"
ON CONFLICT ("id") DO NOTHING;

-- =============================================================================
-- 9. ProcessingBatch  (NEW: larvaeOutput, larvaeOutputUnit)
-- =============================================================================
INSERT INTO "ProcessingBatch" (
  "id", "batchNumber", "name", "startDate", "endDate", "processType",
  "quantity", "status", "temperature", "materialLevel", "moistureContent",
  "phLevel", "c02Level", "liquidOutput", "liquidOutputUnit",
  "larvaeOutput", "larvaeOutputUnit",
  "fertilizerOutput", "fertilizerOutputUnit", "gasOutput", "gasOutputUnit",
  "conversionRate", "processingEfficiency", "notes", "images",
  "farmId", "createdById", "createdAt", "updatedAt", "completedAt"
)
SELECT
  "id", "batchNumber", "name", "startDate", "endDate", "processType",
  "quantity", "status", "temperature", "materialLevel", "moistureContent",
  "phLevel", "c02Level", "liquidOutput", "liquidOutputUnit",
  NULL AS "larvaeOutput",
  'kg' AS "larvaeOutputUnit",
  "fertilizerOutput", "fertilizerOutputUnit", "gasOutput", "gasOutputUnit",
  "conversionRate", "processingEfficiency", "notes", "images",
  "farmId", "createdById", "createdAt", "updatedAt", "completedAt"
FROM "x_ProcessingBatch"
ON CONFLICT ("id") DO NOTHING;

-- =============================================================================
-- 10. WasteRecord  (NEW: deletedAt)
-- =============================================================================
INSERT INTO "WasteRecord" (
  "id", "sourceName", "sourceType", "quantity", "unit", "date", "status",
  "description", "images", "fileUrl", "location", "processedQuantity",
  "processingDate", "notes", "carbonSaved", "methanePrevented",
  "pointsAwarded", "farmId", "supplierId", "recordedById",
  "processingBatchId", "driverId", "vehicleId", "createdAt", "updatedAt",
  -- new column
  "deletedAt"
)
SELECT
  "id", "sourceName", "sourceType", "quantity", "unit", "date", "status",
  "description", "images", "fileUrl", "location", "processedQuantity",
  "processingDate", "notes", "carbonSaved", "methanePrevented",
  "pointsAwarded", "farmId", "supplierId", "recordedById",
  "processingBatchId", "driverId", "vehicleId", "createdAt", "updatedAt",
  -- new column
  NULL AS "deletedAt"
FROM "x_WasteRecord"
ON CONFLICT ("id") DO NOTHING;

-- =============================================================================
-- 11. QualityCheck  (no new columns)
-- =============================================================================
INSERT INTO "QualityCheck" (
  "id", "batchId", "checkType", "parameter", "value", "unit",
  "minThreshold", "maxThreshold", "passed", "notes", "checkedById", "checkedAt"
)
SELECT
  "id", "batchId", "checkType", "parameter", "value", "unit",
  "minThreshold", "maxThreshold", "passed", "notes", "checkedById", "checkedAt"
FROM "x_QualityCheck"
ON CONFLICT ("id") DO NOTHING;

-- =============================================================================
-- 12. TeamAssignment  (no new columns)
-- =============================================================================
INSERT INTO "TeamAssignment" (
  "id", "batchId", "teamMemberId", "role", "shift", "assignedAt", "endedAt"
)
SELECT
  "id", "batchId", "teamMemberId", "role", "shift", "assignedAt", "endedAt"
FROM "x_TeamAssignment"
ON CONFLICT ("id") DO NOTHING;

-- =============================================================================
-- 13. ActivityLog  (no new columns)
-- =============================================================================
INSERT INTO "ActivityLog" (
  "id", "batchId", "action", "description", "metadata", "performedById", "timestamp"
)
SELECT
  "id", "batchId", "action", "description", "metadata", "performedById", "timestamp"
FROM "x_ActivityLog"
ON CONFLICT ("id") DO NOTHING;

-- =============================================================================
-- 14. Product  (NEW: averageRating, reviewCount, deletedAt)
-- =============================================================================
INSERT INTO "Product" (
  "id", "name", "description", "shortDescription", "images", "category",
  "status", "featured", "tags", "slug", "metaTitle", "metaDescription",
  "farmId", "createdAt", "updatedAt",
  -- new columns
  "averageRating", "reviewCount", "deletedAt"
)
SELECT
  "id", "name", "description", "shortDescription", "images", "category",
  "status", "featured", "tags", "slug", "metaTitle", "metaDescription",
  "farmId", "createdAt", "updatedAt",
  -- new columns (compute averageRating/reviewCount from existing reviews)
  COALESCE((
    SELECT AVG(pr."rating")::DOUBLE PRECISION
    FROM "x_ProductReview" pr
    WHERE pr."productId" = xp."id"
  ), 0) AS "averageRating",
  COALESCE((
    SELECT COUNT(*)::INTEGER
    FROM "x_ProductReview" pr
    WHERE pr."productId" = xp."id"
  ), 0) AS "reviewCount",
  NULL AS "deletedAt"
FROM "x_Product" xp
ON CONFLICT ("id") DO NOTHING;

-- =============================================================================
-- 15. ProductVariant  (no new columns)
-- =============================================================================
INSERT INTO "ProductVariant" (
  "id", "productId", "name", "sku", "quantity", "price", "comparePrice",
  "cost", "unitType", "unitValue", "minOrderQuantity", "maxOrderQuantity",
  "weight", "dimensions", "images", "isActive", "createdAt", "updatedAt"
)
SELECT
  "id", "productId", "name", "sku", "quantity", "price", "comparePrice",
  "cost", "unitType", "unitValue", "minOrderQuantity", "maxOrderQuantity",
  "weight", "dimensions", "images", "isActive", "createdAt", "updatedAt"
FROM "x_ProductVariant"
ON CONFLICT ("id") DO NOTHING;

-- =============================================================================
-- 16. ProductReview  (no new columns)
-- =============================================================================
INSERT INTO "ProductReview" (
  "id", "productId", "userId", "rating", "title", "comment",
  "images", "verified", "helpful", "createdAt"
)
SELECT
  "id", "productId", "userId", "rating", "title", "comment",
  "images", "verified", "helpful", "createdAt"
FROM "x_ProductReview"
ON CONFLICT ("id") DO NOTHING;

-- =============================================================================
-- 17. Order  (NEW: paidAt, refundReason, deletedAt)
-- =============================================================================
INSERT INTO "Order" (
  "id", "orderNumber", "customerId", "status", "subtotal", "tax",
  "shippingCost", "discount", "total", "paymentMethod", "paymentStatus",
  "paymentDetails", "deliveryAddress", "deliveryInstructions",
  "specialInstructions", "trackingNumber", "estimatedDelivery", "deliveredAt",
  "cancelledAt", "cancellationReason", "driverId", "farmId",
  "createdAt", "updatedAt",
  -- new columns
  "paidAt", "refundReason", "deletedAt"
)
SELECT
  "id", "orderNumber", "customerId", "status", "subtotal", "tax",
  "shippingCost", "discount", "total", "paymentMethod", "paymentStatus",
  "paymentDetails", "deliveryAddress", "deliveryInstructions",
  "specialInstructions", "trackingNumber", "estimatedDelivery", "deliveredAt",
  "cancelledAt", "cancellationReason", "driverId", "farmId",
  "createdAt", "updatedAt",
  -- new columns: infer paidAt from deliveredAt for PAID orders as best-guess
  CASE WHEN "paymentStatus" = 'PAID' THEN "updatedAt" ELSE NULL END AS "paidAt",
  NULL AS "refundReason",
  NULL AS "deletedAt"
FROM "x_Order"
ON CONFLICT ("id") DO NOTHING;

-- =============================================================================
-- 18. OrderItem  (no new columns)
-- =============================================================================
INSERT INTO "OrderItem" (
  "id", "orderId", "variantId", "quantity", "price", "subtotal", "metadata"
)
SELECT
  "id", "orderId", "variantId", "quantity", "price", "subtotal", "metadata"
FROM "x_OrderItem"
ON CONFLICT ("id") DO NOTHING;

-- =============================================================================
-- 19. Invoice  (no new columns)
-- =============================================================================
INSERT INTO "Invoice" (
  "id", "orderId", "invoiceNumber", "issueDate", "dueDate",
  "paidAt", "pdfUrl", "status"
)
SELECT
  "id", "orderId", "invoiceNumber", "issueDate", "dueDate",
  "paidAt", "pdfUrl", "status"
FROM "x_Invoice"
ON CONFLICT ("id") DO NOTHING;

-- =============================================================================
-- 20. Shipment  (no new columns)
-- =============================================================================
INSERT INTO "Shipment" (
  "id", "orderId", "carrier", "trackingNumber", "trackingUrl", "labelUrl",
  "status", "shippedAt", "estimatedDelivery", "deliveredAt",
  "currentLocation", "events"
)
SELECT
  "id", "orderId", "carrier", "trackingNumber", "trackingUrl", "labelUrl",
  "status", "shippedAt", "estimatedDelivery", "deliveredAt",
  "currentLocation", "events"
FROM "x_Shipment"
ON CONFLICT ("id") DO NOTHING;

-- =============================================================================
-- 21. Cart  (no new columns)
-- =============================================================================
INSERT INTO "Cart" ("id", "userId", "createdAt", "updatedAt")
SELECT             "id", "userId", "createdAt", "updatedAt"
FROM "x_Cart"
ON CONFLICT ("id") DO NOTHING;

-- =============================================================================
-- 22. CartItem  (no new columns)
-- =============================================================================
INSERT INTO "CartItem" ("id", "cartId", "variantId", "quantity", "addedAt")
SELECT                  "id", "cartId", "variantId", "quantity", "addedAt"
FROM "x_CartItem"
ON CONFLICT ("id") DO NOTHING;

-- =============================================================================
-- 23. Notification  (NEW: readAt)
-- =============================================================================
INSERT INTO "Notification" (
  "id", "userId", "title", "message", "type", "read", "metadata", "createdAt",
  -- new column
  "readAt"
)
SELECT
  "id", "userId", "title", "message", "type", "read", "metadata", "createdAt",
  -- new column: if already read, use createdAt as approximation; NULL otherwise
  CASE WHEN "read" = TRUE THEN "createdAt" ELSE NULL END AS "readAt"
FROM "x_Notification"
ON CONFLICT ("id") DO NOTHING;

-- =============================================================================
-- 24. OfflineSync  (NEW: processedAt)
-- =============================================================================
INSERT INTO "OfflineSync" (
  "id", "userId", "action", "entityType", "entityId", "data",
  "status", "retryCount", "errorMessage", "createdAt", "syncedAt",
  -- new column
  "processedAt"
)
SELECT
  "id", "userId", "action", "entityType", "entityId", "data",
  "status", "retryCount", "errorMessage", "createdAt", "syncedAt",
  -- new column: use syncedAt as processedAt for already-synced records
  "syncedAt" AS "processedAt"
FROM "x_OfflineSync"
ON CONFLICT ("id") DO NOTHING;

-- =============================================================================
-- 25. Report  (no new columns)
-- =============================================================================
INSERT INTO "Report" (
  "id", "type", "title", "description", "fileUrl", "data",
  "parameters", "generatedBy", "farmId", "generatedAt", "expiresAt"
)
SELECT
  "id", "type", "title", "description", "fileUrl", "data",
  "parameters", "generatedBy", "farmId", "generatedAt", "expiresAt"
FROM "x_Report"
ON CONFLICT ("id") DO NOTHING;

-- =============================================================================
-- 26. Integration  (no new columns)
-- =============================================================================
INSERT INTO "Integration" (
  "id", "adminId", "name", "type", "apiKey", "apiSecret",
  "config", "status", "lastUsed", "createdAt", "updatedAt"
)
SELECT
  "id", "adminId", "name", "type", "apiKey", "apiSecret",
  "config", "status", "lastUsed", "createdAt", "updatedAt"
FROM "x_Integration"
ON CONFLICT ("id") DO NOTHING;

-- ── Re-enable triggers ────────────────────────────────────────────────────────
SET session_replication_role = 'origin';

COMMIT;

\echo ''
\echo '✅  06_insert_old_data_into_updated_database_tables.sql — Data migration complete.'
\echo '    Verify row counts, then run 07_delete_old_tables.sql to remove x_ backups.'
\echo ''
\echo 'Quick verification queries:'
\echo '  SELECT COUNT(*) FROM "Admin"           vs SELECT COUNT(*) FROM "x_Admin";'
\echo '  SELECT COUNT(*) FROM "Users"            vs SELECT COUNT(*) FROM "x_Users";'
\echo '  SELECT COUNT(*) FROM "Farm"            vs SELECT COUNT(*) FROM "x_Farm";'
\echo '  SELECT COUNT(*) FROM "WasteRecord"     vs SELECT COUNT(*) FROM "x_WasteRecord";'
\echo '  SELECT COUNT(*) FROM "Order"           vs SELECT COUNT(*) FROM "x_Order";'
