-- =============================================================================
-- BioDigital BSF Farm — Script 02: Create Tables
-- =============================================================================
-- Purpose : Create all 26 application tables with constraints, indexes,
--           and updatedAt triggers. Run AFTER 01_create_database.sql.
-- Usage   : psql -U biodigital -d biodigital -f 02_create_tables.sql
-- =============================================================================

\set ON_ERROR_STOP on
\connect biodigital

-- =============================================================================
-- TABLE: Admin  (no foreign-key dependencies — create first)
-- =============================================================================
CREATE TABLE IF NOT EXISTS "Admin" (
  "id"               TEXT          NOT NULL DEFAULT gen_random_uuid()::TEXT,
  "companyName"      TEXT          NOT NULL,
  "companyLogo"      TEXT,
  "taxId"            TEXT,
  "address"          TEXT,
  "city"             TEXT,
  "country"          TEXT,
  "phoneNumber"      TEXT,
  "email"            TEXT,
  "region"           TEXT,
  "landmark"         TEXT,
  "lat"              DOUBLE PRECISION,
  "lng"              DOUBLE PRECISION,
  "employeeCount"    INTEGER,
  "description"      TEXT,
  "tags"             TEXT[]        NOT NULL DEFAULT '{}',
  "profileCompleted" BOOLEAN       NOT NULL DEFAULT FALSE,
  "subscription"     "SubscriptionStatus" NOT NULL DEFAULT 'TRIAL',
  "subscriptionEnd"  TIMESTAMPTZ,
  "maxManagers"      INTEGER       NOT NULL DEFAULT 5,
  "maxFarms"         INTEGER       NOT NULL DEFAULT 10,
  "inviteCode"       TEXT          UNIQUE,
  "createdAt"        TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
  "updatedAt"        TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
  CONSTRAINT "Admin_pkey" PRIMARY KEY ("id")
);

CREATE TRIGGER "Admin_updatedAt"
  BEFORE UPDATE ON "Admin"
  FOR EACH ROW EXECUTE FUNCTION trigger_set_updated_at();

-- =============================================================================
-- TABLE: Vehicle  (no foreign-key dependencies)
-- =============================================================================
CREATE TABLE IF NOT EXISTS "Vehicle" (
  "id"          TEXT        NOT NULL DEFAULT gen_random_uuid()::TEXT,
  "plateNumber" TEXT        NOT NULL UNIQUE,
  "type"        TEXT        NOT NULL,
  "model"       TEXT,
  "color"       TEXT,
  "isActive"    BOOLEAN     NOT NULL DEFAULT TRUE,
  "createdAt"   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  "updatedAt"   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT "Vehicle_pkey" PRIMARY KEY ("id")
);

CREATE TRIGGER "Vehicle_updatedAt"
  BEFORE UPDATE ON "Vehicle"
  FOR EACH ROW EXECUTE FUNCTION trigger_set_updated_at();

-- =============================================================================
-- TABLE: SystemSetting  (no foreign-key dependencies)
-- =============================================================================
CREATE TABLE IF NOT EXISTS "SystemSetting" (
  "id"          TEXT        NOT NULL DEFAULT gen_random_uuid()::TEXT,
  "key"         TEXT        NOT NULL UNIQUE,
  "value"       JSONB       NOT NULL,
  "description" TEXT,
  "category"    TEXT        NOT NULL,
  "updatedBy"   TEXT        NOT NULL,
  "updatedAt"   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT "SystemSetting_pkey" PRIMARY KEY ("id")
);

CREATE TRIGGER "SystemSetting_updatedAt"
  BEFORE UPDATE ON "SystemSetting"
  FOR EACH ROW EXECUTE FUNCTION trigger_set_updated_at();

-- =============================================================================
-- TABLE: Users  (depends on: Admin)
-- =============================================================================
CREATE TABLE IF NOT EXISTS "Users" (
  "id"             TEXT             NOT NULL DEFAULT gen_random_uuid()::TEXT,
  "email"          TEXT             NOT NULL UNIQUE,
  "password"       TEXT             NOT NULL,
  "fullName"       TEXT             NOT NULL,
  "phoneNumber"    TEXT,
  "profileImage"   TEXT,
  "role"           "UserRole"       NOT NULL DEFAULT 'USER',
  "status"         "UserStatus"     NOT NULL DEFAULT 'ACTIVE',
  "onboardingStep" "OnboardingStep" NOT NULL DEFAULT 'COMPLETE',
  "emailVerified"  BOOLEAN          NOT NULL DEFAULT FALSE,
  "phoneVerified"  BOOLEAN          NOT NULL DEFAULT FALSE,
  "lastLogin"      TIMESTAMPTZ,
  "managedById"    TEXT,
  "createdAt"      TIMESTAMPTZ      NOT NULL DEFAULT NOW(),
  "updatedAt"      TIMESTAMPTZ      NOT NULL DEFAULT NOW(),
  CONSTRAINT "Users_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "Users_managedById_fkey"
    FOREIGN KEY ("managedById") REFERENCES "Admin"("id")
    ON DELETE SET NULL ON UPDATE CASCADE
);

CREATE INDEX IF NOT EXISTS "Users_email_idx"      ON "Users" ("email");
CREATE INDEX IF NOT EXISTS "Users_role_idx"        ON "Users" ("role");
CREATE INDEX IF NOT EXISTS "Users_status_idx"      ON "Users" ("status");
CREATE INDEX IF NOT EXISTS "Users_managedById_idx" ON "Users" ("managedById");

CREATE TRIGGER "Users_updatedAt"
  BEFORE UPDATE ON "Users"
  FOR EACH ROW EXECUTE FUNCTION trigger_set_updated_at();

-- =============================================================================
-- TABLE: Farm  (depends on: Admin, User)
-- =============================================================================
CREATE TABLE IF NOT EXISTS "Farm" (
  "id"                  TEXT         NOT NULL DEFAULT gen_random_uuid()::TEXT,
  "name"                TEXT         NOT NULL,
  "type"                "FarmType"   NOT NULL,
  "description"         TEXT,
  "area"                DOUBLE PRECISION,
  "areaUnit"            TEXT         DEFAULT 'hectares',
  "income"              DOUBLE PRECISION,
  "equipment"           INTEGER,
  "labor"               INTEGER,
  "output"              DOUBLE PRECISION,
  "expenses"            DOUBLE PRECISION,
  "profit"              DOUBLE PRECISION,
  "status"              "FarmStatus" NOT NULL DEFAULT 'ACTIVE',
  "location"            JSONB,
  "country"             TEXT,
  "region"              TEXT,
  "city"                TEXT,
  "postalCode"          TEXT,
  "totalWasteCollected" DOUBLE PRECISION NOT NULL DEFAULT 0,
  "totalWasteProcessed" DOUBLE PRECISION NOT NULL DEFAULT 0,
  "totalCarbonSaved"    DOUBLE PRECISION NOT NULL DEFAULT 0,
  "totalRevenue"        DOUBLE PRECISION NOT NULL DEFAULT 0,
  "totalProductsSold"   INTEGER          NOT NULL DEFAULT 0,
  "adminId"             TEXT,
  "managerId"           TEXT         UNIQUE,
  "createdAt"           TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  "updatedAt"           TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  CONSTRAINT "Farm_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "Farm_adminId_fkey"
    FOREIGN KEY ("adminId") REFERENCES "Admin"("id")
    ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT "Farm_managerId_fkey"
    FOREIGN KEY ("managerId") REFERENCES "Users"("id")
    ON DELETE SET NULL ON UPDATE CASCADE
);

CREATE INDEX IF NOT EXISTS "Farm_adminId_idx"   ON "Farm" ("adminId");
CREATE INDEX IF NOT EXISTS "Farm_status_idx"     ON "Farm" ("status");

CREATE TRIGGER "Farm_updatedAt"
  BEFORE UPDATE ON "Farm"
  FOR EACH ROW EXECUTE FUNCTION trigger_set_updated_at();

-- =============================================================================
-- TABLE: DriverProfile  (depends on: User, Admin)
-- =============================================================================
CREATE TABLE IF NOT EXISTS "DriverProfile" (
  "id"                   TEXT           NOT NULL DEFAULT gen_random_uuid()::TEXT,
  "userId"               TEXT           NOT NULL UNIQUE,
  "licenseNumber"        TEXT,
  "licenseDocument"      TEXT,
  "licenseExpiry"        TIMESTAMPTZ,
  "idCardNumber"         TEXT,
  "idCardDocument"       TEXT,
  "passportNumber"       TEXT,
  "passportDocument"     TEXT,
  "vehicleType"          TEXT,
  "vehicleModel"         TEXT,
  "vehiclePlateNumber"   TEXT,
  "vehicleRegistration"  TEXT,
  "vehicleDocument"      TEXT,
  "baseLocation"         JSONB,
  "currentLocation"      JSONB,
  "rating"               DOUBLE PRECISION NOT NULL DEFAULT 5.0,
  "totalDeliveries"      INTEGER          NOT NULL DEFAULT 0,
  "status"               "DriverStatus"   NOT NULL DEFAULT 'PENDING',
  "verifiedAt"           TIMESTAMPTZ,
  "adminId"              TEXT,
  "createdAt"            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  "updatedAt"            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT "DriverProfile_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "DriverProfile_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "Users"("id")
    ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "DriverProfile_adminId_fkey"
    FOREIGN KEY ("adminId") REFERENCES "Admin"("id")
    ON DELETE SET NULL ON UPDATE CASCADE
);

CREATE INDEX IF NOT EXISTS "DriverProfile_adminId_idx"  ON "DriverProfile" ("adminId");
CREATE INDEX IF NOT EXISTS "DriverProfile_status_idx"   ON "DriverProfile" ("status");

CREATE TRIGGER "DriverProfile_updatedAt"
  BEFORE UPDATE ON "DriverProfile"
  FOR EACH ROW EXECUTE FUNCTION trigger_set_updated_at();

-- =============================================================================
-- TABLE: BuyerProfile  (depends on: User)
-- =============================================================================
CREATE TABLE IF NOT EXISTS "BuyerProfile" (
  "id"                     TEXT          NOT NULL DEFAULT gen_random_uuid()::TEXT,
  "userId"                 TEXT          NOT NULL UNIQUE,
  "companyName"            TEXT,
  "businessType"           TEXT,
  "taxId"                  TEXT,
  "taxDocument"            TEXT,
  "businessAddress"        TEXT,
  "deliveryAddress"        JSONB,
  "preferredPaymentMethod" TEXT,
  "totalPurchases"         DOUBLE PRECISION NOT NULL DEFAULT 0,
  "orderCount"             INTEGER          NOT NULL DEFAULT 0,
  "status"                 "BuyerStatus"    NOT NULL DEFAULT 'ACTIVE',
  "verifiedAt"             TIMESTAMPTZ,
  "createdAt"              TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  "updatedAt"              TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT "BuyerProfile_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "BuyerProfile_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "Users"("id")
    ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE TRIGGER "BuyerProfile_updatedAt"
  BEFORE UPDATE ON "BuyerProfile"
  FOR EACH ROW EXECUTE FUNCTION trigger_set_updated_at();

-- =============================================================================
-- TABLE: SupplierProfile  (depends on: User, Admin)
-- =============================================================================
CREATE TABLE IF NOT EXISTS "SupplierProfile" (
  "id"                      TEXT             NOT NULL DEFAULT gen_random_uuid()::TEXT,
  "userId"                  TEXT             NOT NULL UNIQUE,
  "supplierType"            TEXT             DEFAULT 'FARMER',
  "organizationName"        TEXT,
  "farmName"                TEXT,
  "farmType"                TEXT,
  "farmSize"                DOUBLE PRECISION,
  "farmSizeRange"           TEXT,
  "primaryProducts"         TEXT[]           NOT NULL DEFAULT '{}',
  "wasteTypes"              TEXT[]           NOT NULL DEFAULT '{}',
  "crops"                   TEXT[]           NOT NULL DEFAULT '{}',
  "weeklyWasteAmount"       DOUBLE PRECISION,
  "weeklyWasteAmountRange"  TEXT,
  "collectionAddress"       JSONB,
  "preferredPickupTime"     TEXT,
  "totalWasteSupplied"      DOUBLE PRECISION NOT NULL DEFAULT 0,
  "totalEarnings"           DOUBLE PRECISION NOT NULL DEFAULT 0,
  "pointsBalance"           INTEGER          NOT NULL DEFAULT 0,
  "pointsEarned"            INTEGER          NOT NULL DEFAULT 0,
  "rating"                  DOUBLE PRECISION NOT NULL DEFAULT 5.0,
  "status"                  "SupplierStatus" NOT NULL DEFAULT 'PENDING',
  "verifiedAt"              TIMESTAMPTZ,
  "adminId"                 TEXT,
  "createdAt"               TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  "updatedAt"               TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT "SupplierProfile_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "SupplierProfile_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "Users"("id")
    ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "SupplierProfile_adminId_fkey"
    FOREIGN KEY ("adminId") REFERENCES "Admin"("id")
    ON DELETE SET NULL ON UPDATE CASCADE
);

CREATE INDEX IF NOT EXISTS "SupplierProfile_adminId_idx" ON "SupplierProfile" ("adminId");
CREATE INDEX IF NOT EXISTS "SupplierProfile_status_idx"  ON "SupplierProfile" ("status");

CREATE TRIGGER "SupplierProfile_updatedAt"
  BEFORE UPDATE ON "SupplierProfile"
  FOR EACH ROW EXECUTE FUNCTION trigger_set_updated_at();

-- =============================================================================
-- TABLE: ProcessingBatch  (depends on: Farm, User)
-- =============================================================================
CREATE TABLE IF NOT EXISTS "ProcessingBatch" (
  "id"                   TEXT          NOT NULL DEFAULT gen_random_uuid()::TEXT,
  "batchNumber"          TEXT          NOT NULL UNIQUE,
  "name"                 TEXT,
  "startDate"            TIMESTAMPTZ   NOT NULL,
  "endDate"              TIMESTAMPTZ,
  "processType"          "ProcessType" NOT NULL,
  "quantity"             DOUBLE PRECISION NOT NULL,
  "status"               "BatchStatus" NOT NULL DEFAULT 'PENDING',
  "temperature"          DOUBLE PRECISION,
  "materialLevel"        DOUBLE PRECISION,
  "moistureContent"      DOUBLE PRECISION,
  "phLevel"              DOUBLE PRECISION,
  "c02Level"             DOUBLE PRECISION,
  "liquidOutput"         DOUBLE PRECISION,
  "liquidOutputUnit"     TEXT          DEFAULT 'liters',
  "larvaeOutput"         DOUBLE PRECISION,
  "larvaeOutputUnit"     TEXT          DEFAULT 'kg',
  "fertilizerOutput"     DOUBLE PRECISION,
  "fertilizerOutputUnit" TEXT          DEFAULT 'kg',
  "gasOutput"            DOUBLE PRECISION,
  "gasOutputUnit"        TEXT          DEFAULT 'm³',
  "conversionRate"       DOUBLE PRECISION,
  "processingEfficiency" DOUBLE PRECISION,
  "qualityScore"         DOUBLE PRECISION,
  "notes"                TEXT,
  "images"               TEXT[]        NOT NULL DEFAULT '{}',
  "farmId"               TEXT,
  "createdById"          TEXT          NOT NULL,
  "createdAt"            TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
  "updatedAt"            TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
  "completedAt"          TIMESTAMPTZ,
  CONSTRAINT "ProcessingBatch_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "ProcessingBatch_farmId_fkey"
    FOREIGN KEY ("farmId") REFERENCES "Farm"("id")
    ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT "ProcessingBatch_createdById_fkey"
    FOREIGN KEY ("createdById") REFERENCES "Users"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE INDEX IF NOT EXISTS "ProcessingBatch_farmId_idx"  ON "ProcessingBatch" ("farmId");
CREATE INDEX IF NOT EXISTS "ProcessingBatch_status_idx"  ON "ProcessingBatch" ("status");

CREATE TRIGGER "ProcessingBatch_updatedAt"
  BEFORE UPDATE ON "ProcessingBatch"
  FOR EACH ROW EXECUTE FUNCTION trigger_set_updated_at();

-- =============================================================================
-- TABLE: WasteRecord  (depends on: Farm, User x3, ProcessingBatch, Vehicle)
-- =============================================================================
CREATE TABLE IF NOT EXISTS "WasteRecord" (
  "id"                TEXT              NOT NULL DEFAULT gen_random_uuid()::TEXT,
  "sourceName"        TEXT              NOT NULL,
  "sourceType"        "WasteSourceType" NOT NULL,
  "quantity"          DOUBLE PRECISION  NOT NULL,
  "unit"              TEXT              NOT NULL DEFAULT 'kg',
  "date"              TIMESTAMPTZ       NOT NULL,
  "status"            "WasteStatus"     NOT NULL DEFAULT 'PENDING',
  "description"       TEXT,
  "images"            TEXT[]            NOT NULL DEFAULT '{}',
  "fileUrl"           TEXT,
  "location"          JSONB,
  "processedQuantity" DOUBLE PRECISION,
  "processingDate"    TIMESTAMPTZ,
  "notes"             TEXT,
  "carbonSaved"       DOUBLE PRECISION,
  "methanePrevented"  DOUBLE PRECISION,
  "pointsAwarded"     INTEGER           NOT NULL DEFAULT 0,
  "farmId"            TEXT,
  "supplierId"        TEXT,
  "recordedById"      TEXT              NOT NULL,
  "processingBatchId" TEXT,
  "driverId"          TEXT,
  "vehicleId"         TEXT,
  "createdAt"         TIMESTAMPTZ       NOT NULL DEFAULT NOW(),
  "updatedAt"         TIMESTAMPTZ       NOT NULL DEFAULT NOW(),
  CONSTRAINT "WasteRecord_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "WasteRecord_farmId_fkey"
    FOREIGN KEY ("farmId") REFERENCES "Farm"("id")
    ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT "WasteRecord_supplierId_fkey"
    FOREIGN KEY ("supplierId") REFERENCES "Users"("id")
    ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT "WasteRecord_recordedById_fkey"
    FOREIGN KEY ("recordedById") REFERENCES "Users"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "WasteRecord_processingBatchId_fkey"
    FOREIGN KEY ("processingBatchId") REFERENCES "ProcessingBatch"("id")
    ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT "WasteRecord_driverId_fkey"
    FOREIGN KEY ("driverId") REFERENCES "Users"("id")
    ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT "WasteRecord_vehicleId_fkey"
    FOREIGN KEY ("vehicleId") REFERENCES "Vehicle"("id")
    ON DELETE SET NULL ON UPDATE CASCADE
);

CREATE INDEX IF NOT EXISTS "WasteRecord_farmId_idx"    ON "WasteRecord" ("farmId");
CREATE INDEX IF NOT EXISTS "WasteRecord_supplierId_idx" ON "WasteRecord" ("supplierId");
CREATE INDEX IF NOT EXISTS "WasteRecord_driverId_idx"  ON "WasteRecord" ("driverId");
CREATE INDEX IF NOT EXISTS "WasteRecord_status_idx"    ON "WasteRecord" ("status");
CREATE INDEX IF NOT EXISTS "WasteRecord_date_idx"      ON "WasteRecord" ("date");

CREATE TRIGGER "WasteRecord_updatedAt"
  BEFORE UPDATE ON "WasteRecord"
  FOR EACH ROW EXECUTE FUNCTION trigger_set_updated_at();

-- =============================================================================
-- TABLE: QualityCheck  (depends on: ProcessingBatch, User)
-- =============================================================================
CREATE TABLE IF NOT EXISTS "QualityCheck" (
  "id"           TEXT          NOT NULL DEFAULT gen_random_uuid()::TEXT,
  "batchId"      TEXT          NOT NULL,
  "checkType"    "QualityType" NOT NULL,
  "parameter"    TEXT          NOT NULL,
  "value"        DOUBLE PRECISION NOT NULL,
  "unit"         TEXT          NOT NULL,
  "minThreshold" DOUBLE PRECISION,
  "maxThreshold" DOUBLE PRECISION,
  "passed"       BOOLEAN       NOT NULL,
  "notes"        TEXT,
  "checkedById"  TEXT          NOT NULL,
  "checkedAt"    TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
  CONSTRAINT "QualityCheck_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "QualityCheck_batchId_fkey"
    FOREIGN KEY ("batchId") REFERENCES "ProcessingBatch"("id")
    ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "QualityCheck_checkedById_fkey"
    FOREIGN KEY ("checkedById") REFERENCES "Users"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE INDEX IF NOT EXISTS "QualityCheck_batchId_idx" ON "QualityCheck" ("batchId");

-- =============================================================================
-- TABLE: TeamAssignment  (depends on: ProcessingBatch, User)
-- =============================================================================
CREATE TABLE IF NOT EXISTS "TeamAssignment" (
  "id"           TEXT        NOT NULL DEFAULT gen_random_uuid()::TEXT,
  "batchId"      TEXT        NOT NULL,
  "teamMemberId" TEXT        NOT NULL,
  "role"         TEXT        NOT NULL,
  "shift"        TEXT,
  "assignedAt"   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  "endedAt"      TIMESTAMPTZ,
  CONSTRAINT "TeamAssignment_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "TeamAssignment_batchId_fkey"
    FOREIGN KEY ("batchId") REFERENCES "ProcessingBatch"("id")
    ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "TeamAssignment_teamMemberId_fkey"
    FOREIGN KEY ("teamMemberId") REFERENCES "Users"("id")
    ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE INDEX IF NOT EXISTS "TeamAssignment_batchId_idx" ON "TeamAssignment" ("batchId");

-- =============================================================================
-- TABLE: ActivityLog  (depends on: ProcessingBatch, User)
-- =============================================================================
CREATE TABLE IF NOT EXISTS "ActivityLog" (
  "id"            TEXT             NOT NULL DEFAULT gen_random_uuid()::TEXT,
  "batchId"       TEXT             NOT NULL,
  "action"        "ActivityAction" NOT NULL,
  "description"   TEXT,
  "metadata"      JSONB,
  "performedById" TEXT             NOT NULL,
  "timestamp"     TIMESTAMPTZ      NOT NULL DEFAULT NOW(),
  CONSTRAINT "ActivityLog_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "ActivityLog_batchId_fkey"
    FOREIGN KEY ("batchId") REFERENCES "ProcessingBatch"("id")
    ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "ActivityLog_performedById_fkey"
    FOREIGN KEY ("performedById") REFERENCES "Users"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE INDEX IF NOT EXISTS "ActivityLog_batchId_idx"   ON "ActivityLog" ("batchId");
CREATE INDEX IF NOT EXISTS "ActivityLog_timestamp_idx" ON "ActivityLog" ("timestamp");

-- =============================================================================
-- TABLE: Product  (depends on: Farm)
-- =============================================================================
CREATE TABLE IF NOT EXISTS "Product" (
  "id"               TEXT              NOT NULL DEFAULT gen_random_uuid()::TEXT,
  "name"             TEXT              NOT NULL,
  "description"      TEXT,
  "shortDescription" TEXT,
  "images"           TEXT[]            NOT NULL DEFAULT '{}',
  "category"         "ProductCategory" NOT NULL,
  "status"           "ProductStatus"   NOT NULL DEFAULT 'ACTIVE',
  "featured"         BOOLEAN           NOT NULL DEFAULT FALSE,
  "tags"             TEXT[]            NOT NULL DEFAULT '{}',
  "slug"             TEXT              NOT NULL UNIQUE,
  "metaTitle"        TEXT,
  "metaDescription"  TEXT,
  "farmId"           TEXT,
  "createdAt"        TIMESTAMPTZ       NOT NULL DEFAULT NOW(),
  "updatedAt"        TIMESTAMPTZ       NOT NULL DEFAULT NOW(),
  CONSTRAINT "Product_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "Product_farmId_fkey"
    FOREIGN KEY ("farmId") REFERENCES "Farm"("id")
    ON DELETE SET NULL ON UPDATE CASCADE
);

CREATE INDEX IF NOT EXISTS "Product_farmId_idx"   ON "Product" ("farmId");
CREATE INDEX IF NOT EXISTS "Product_category_idx" ON "Product" ("category");
CREATE INDEX IF NOT EXISTS "Product_status_idx"   ON "Product" ("status");
CREATE INDEX IF NOT EXISTS "Product_slug_idx"     ON "Product" ("slug");

CREATE TRIGGER "Product_updatedAt"
  BEFORE UPDATE ON "Product"
  FOR EACH ROW EXECUTE FUNCTION trigger_set_updated_at();

-- =============================================================================
-- TABLE: ProductVariant  (depends on: Product)
-- =============================================================================
CREATE TABLE IF NOT EXISTS "ProductVariant" (
  "id"               TEXT    NOT NULL DEFAULT gen_random_uuid()::TEXT,
  "productId"        TEXT    NOT NULL,
  "name"             TEXT    NOT NULL,
  "sku"              TEXT    NOT NULL UNIQUE,
  "quantity"         INTEGER NOT NULL,
  "price"            DOUBLE PRECISION NOT NULL,
  "comparePrice"     DOUBLE PRECISION,
  "cost"             DOUBLE PRECISION,
  "unitType"         TEXT    NOT NULL,
  "unitValue"        DOUBLE PRECISION,
  "minOrderQuantity" INTEGER NOT NULL DEFAULT 1,
  "maxOrderQuantity" INTEGER,
  "weight"           DOUBLE PRECISION,
  "dimensions"       JSONB,
  "images"           TEXT[]  NOT NULL DEFAULT '{}',
  "isActive"         BOOLEAN NOT NULL DEFAULT TRUE,
  "createdAt"        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  "updatedAt"        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT "ProductVariant_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "ProductVariant_productId_fkey"
    FOREIGN KEY ("productId") REFERENCES "Product"("id")
    ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE INDEX IF NOT EXISTS "ProductVariant_productId_idx" ON "ProductVariant" ("productId");
CREATE INDEX IF NOT EXISTS "ProductVariant_sku_idx"       ON "ProductVariant" ("sku");

CREATE TRIGGER "ProductVariant_updatedAt"
  BEFORE UPDATE ON "ProductVariant"
  FOR EACH ROW EXECUTE FUNCTION trigger_set_updated_at();

-- =============================================================================
-- TABLE: ProductReview  (depends on: Product, User)
-- =============================================================================
CREATE TABLE IF NOT EXISTS "ProductReview" (
  "id"        TEXT        NOT NULL DEFAULT gen_random_uuid()::TEXT,
  "productId" TEXT        NOT NULL,
  "userId"    TEXT        NOT NULL,
  "rating"    INTEGER     NOT NULL CHECK ("rating" BETWEEN 1 AND 5),
  "title"     TEXT,
  "comment"   TEXT,
  "images"    TEXT[]      NOT NULL DEFAULT '{}',
  "verified"  BOOLEAN     NOT NULL DEFAULT FALSE,
  "helpful"   INTEGER     NOT NULL DEFAULT 0,
  "createdAt" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT "ProductReview_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "ProductReview_productId_fkey"
    FOREIGN KEY ("productId") REFERENCES "Product"("id")
    ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "ProductReview_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "Users"("id")
    ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE INDEX IF NOT EXISTS "ProductReview_productId_idx" ON "ProductReview" ("productId");

-- =============================================================================
-- TABLE: Order  (depends on: User x2, Farm)
-- =============================================================================
CREATE TABLE IF NOT EXISTS "Order" (
  "id"                   TEXT            NOT NULL DEFAULT gen_random_uuid()::TEXT,
  "orderNumber"          TEXT            NOT NULL UNIQUE,
  "customerId"           TEXT            NOT NULL,
  "status"               "OrderStatus"   NOT NULL DEFAULT 'PENDING',
  "subtotal"             DOUBLE PRECISION NOT NULL,
  "tax"                  DOUBLE PRECISION NOT NULL DEFAULT 0,
  "shippingCost"         DOUBLE PRECISION NOT NULL DEFAULT 0,
  "discount"             DOUBLE PRECISION NOT NULL DEFAULT 0,
  "total"                DOUBLE PRECISION NOT NULL,
  "paymentMethod"        "PaymentMethod"  NOT NULL,
  "paymentStatus"        "PaymentStatus"  NOT NULL DEFAULT 'PENDING',
  "paymentDetails"       JSONB,
  "deliveryAddress"      JSONB            NOT NULL,
  "deliveryInstructions" TEXT,
  "specialInstructions"  TEXT,
  "trackingNumber"       TEXT,
  "estimatedDelivery"    TIMESTAMPTZ,
  "deliveredAt"          TIMESTAMPTZ,
  "cancelledAt"          TIMESTAMPTZ,
  "cancellationReason"   TEXT,
  "driverId"             TEXT,
  "farmId"               TEXT,
  "createdAt"            TIMESTAMPTZ      NOT NULL DEFAULT NOW(),
  "updatedAt"            TIMESTAMPTZ      NOT NULL DEFAULT NOW(),
  CONSTRAINT "Order_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "Order_customerId_fkey"
    FOREIGN KEY ("customerId") REFERENCES "Users"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "Order_driverId_fkey"
    FOREIGN KEY ("driverId") REFERENCES "Users"("id")
    ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT "Order_farmId_fkey"
    FOREIGN KEY ("farmId") REFERENCES "Farm"("id")
    ON DELETE SET NULL ON UPDATE CASCADE
);

CREATE INDEX IF NOT EXISTS "Order_customerId_idx"    ON "Order" ("customerId");
CREATE INDEX IF NOT EXISTS "Order_status_idx"        ON "Order" ("status");
CREATE INDEX IF NOT EXISTS "Order_paymentStatus_idx" ON "Order" ("paymentStatus");
CREATE INDEX IF NOT EXISTS "Order_createdAt_idx"     ON "Order" ("createdAt");

CREATE TRIGGER "Order_updatedAt"
  BEFORE UPDATE ON "Order"
  FOR EACH ROW EXECUTE FUNCTION trigger_set_updated_at();

-- =============================================================================
-- TABLE: OrderItem  (depends on: Order, ProductVariant)
-- =============================================================================
CREATE TABLE IF NOT EXISTS "OrderItem" (
  "id"        TEXT             NOT NULL DEFAULT gen_random_uuid()::TEXT,
  "orderId"   TEXT             NOT NULL,
  "variantId" TEXT             NOT NULL,
  "quantity"  INTEGER          NOT NULL,
  "price"     DOUBLE PRECISION NOT NULL,
  "subtotal"  DOUBLE PRECISION NOT NULL,
  "metadata"  JSONB,
  CONSTRAINT "OrderItem_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "OrderItem_orderId_fkey"
    FOREIGN KEY ("orderId") REFERENCES "Order"("id")
    ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "OrderItem_variantId_fkey"
    FOREIGN KEY ("variantId") REFERENCES "ProductVariant"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE INDEX IF NOT EXISTS "OrderItem_orderId_idx" ON "OrderItem" ("orderId");

-- =============================================================================
-- TABLE: Invoice  (depends on: Order)
-- =============================================================================
CREATE TABLE IF NOT EXISTS "Invoice" (
  "id"            TEXT            NOT NULL DEFAULT gen_random_uuid()::TEXT,
  "orderId"       TEXT            NOT NULL UNIQUE,
  "invoiceNumber" TEXT            NOT NULL UNIQUE,
  "issueDate"     TIMESTAMPTZ     NOT NULL DEFAULT NOW(),
  "dueDate"       TIMESTAMPTZ     NOT NULL,
  "paidAt"        TIMESTAMPTZ,
  "pdfUrl"        TEXT,
  "status"        "InvoiceStatus" NOT NULL DEFAULT 'ISSUED',
  CONSTRAINT "Invoice_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "Invoice_orderId_fkey"
    FOREIGN KEY ("orderId") REFERENCES "Order"("id")
    ON DELETE CASCADE ON UPDATE CASCADE
);

-- =============================================================================
-- TABLE: Shipment  (depends on: Order)
-- =============================================================================
CREATE TABLE IF NOT EXISTS "Shipment" (
  "id"                TEXT              NOT NULL DEFAULT gen_random_uuid()::TEXT,
  "orderId"           TEXT              NOT NULL UNIQUE,
  "carrier"           TEXT              NOT NULL,
  "trackingNumber"    TEXT              NOT NULL UNIQUE,
  "trackingUrl"       TEXT,
  "labelUrl"          TEXT,
  "status"            "ShipmentStatus"  NOT NULL DEFAULT 'PENDING',
  "shippedAt"         TIMESTAMPTZ,
  "estimatedDelivery" TIMESTAMPTZ,
  "deliveredAt"       TIMESTAMPTZ,
  "currentLocation"   JSONB,
  "events"            JSONB[]           NOT NULL DEFAULT '{}',
  CONSTRAINT "Shipment_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "Shipment_orderId_fkey"
    FOREIGN KEY ("orderId") REFERENCES "Order"("id")
    ON DELETE CASCADE ON UPDATE CASCADE
);

-- =============================================================================
-- TABLE: Cart  (depends on: User)
-- =============================================================================
CREATE TABLE IF NOT EXISTS "Cart" (
  "id"        TEXT        NOT NULL DEFAULT gen_random_uuid()::TEXT,
  "userId"    TEXT        NOT NULL UNIQUE,
  "createdAt" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  "updatedAt" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT "Cart_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "Cart_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "Users"("id")
    ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE TRIGGER "Cart_updatedAt"
  BEFORE UPDATE ON "Cart"
  FOR EACH ROW EXECUTE FUNCTION trigger_set_updated_at();

-- =============================================================================
-- TABLE: CartItem  (depends on: Cart, ProductVariant)
-- =============================================================================
CREATE TABLE IF NOT EXISTS "CartItem" (
  "id"        TEXT        NOT NULL DEFAULT gen_random_uuid()::TEXT,
  "cartId"    TEXT        NOT NULL,
  "variantId" TEXT        NOT NULL,
  "quantity"  INTEGER     NOT NULL,
  "addedAt"   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT "CartItem_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "CartItem_cartId_fkey"
    FOREIGN KEY ("cartId") REFERENCES "Cart"("id")
    ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "CartItem_variantId_fkey"
    FOREIGN KEY ("variantId") REFERENCES "ProductVariant"("id")
    ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "CartItem_cartId_variantId_key"
    UNIQUE ("cartId", "variantId")
);

-- =============================================================================
-- TABLE: Notification  (depends on: User)
-- =============================================================================
CREATE TABLE IF NOT EXISTS "Notification" (
  "id"        TEXT               NOT NULL DEFAULT gen_random_uuid()::TEXT,
  "userId"    TEXT               NOT NULL,
  "title"     TEXT               NOT NULL,
  "message"   TEXT               NOT NULL,
  "type"      "NotificationType" NOT NULL,
  "read"      BOOLEAN            NOT NULL DEFAULT FALSE,
  "metadata"  JSONB,
  "createdAt" TIMESTAMPTZ        NOT NULL DEFAULT NOW(),
  CONSTRAINT "Notification_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "Notification_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "Users"("id")
    ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE INDEX IF NOT EXISTS "Notification_userId_idx"    ON "Notification" ("userId");
CREATE INDEX IF NOT EXISTS "Notification_read_idx"      ON "Notification" ("read");
CREATE INDEX IF NOT EXISTS "Notification_createdAt_idx" ON "Notification" ("createdAt");

-- =============================================================================
-- TABLE: OfflineSync  (depends on: User)
-- =============================================================================
CREATE TABLE IF NOT EXISTS "OfflineSync" (
  "id"           TEXT         NOT NULL DEFAULT gen_random_uuid()::TEXT,
  "userId"       TEXT         NOT NULL,
  "action"       TEXT         NOT NULL,
  "entityType"   TEXT         NOT NULL,
  "entityId"     TEXT,
  "data"         JSONB        NOT NULL,
  "status"       "SyncStatus" NOT NULL DEFAULT 'PENDING',
  "retryCount"   INTEGER      NOT NULL DEFAULT 0,
  "errorMessage" TEXT,
  "createdAt"    TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  "syncedAt"     TIMESTAMPTZ,
  CONSTRAINT "OfflineSync_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "OfflineSync_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "Users"("id")
    ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE INDEX IF NOT EXISTS "OfflineSync_userId_idx" ON "OfflineSync" ("userId");
CREATE INDEX IF NOT EXISTS "OfflineSync_status_idx" ON "OfflineSync" ("status");

-- =============================================================================
-- TABLE: Report  (depends on: User, Farm)
-- =============================================================================
CREATE TABLE IF NOT EXISTS "Report" (
  "id"          TEXT         NOT NULL DEFAULT gen_random_uuid()::TEXT,
  "type"        "ReportType" NOT NULL,
  "title"       TEXT         NOT NULL,
  "description" TEXT,
  "fileUrl"     TEXT,
  "data"        JSONB        NOT NULL,
  "parameters"  JSONB,
  "generatedBy" TEXT         NOT NULL,
  "farmId"      TEXT,
  "generatedAt" TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  "expiresAt"   TIMESTAMPTZ,
  CONSTRAINT "Report_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "Report_generatedBy_fkey"
    FOREIGN KEY ("generatedBy") REFERENCES "Users"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "Report_farmId_fkey"
    FOREIGN KEY ("farmId") REFERENCES "Farm"("id")
    ON DELETE SET NULL ON UPDATE CASCADE
);

CREATE INDEX IF NOT EXISTS "Report_generatedBy_idx" ON "Report" ("generatedBy");
CREATE INDEX IF NOT EXISTS "Report_type_idx"         ON "Report" ("type");

-- =============================================================================
-- TABLE: Integration  (depends on: Admin)
-- =============================================================================
CREATE TABLE IF NOT EXISTS "Integration" (
  "id"        TEXT                NOT NULL DEFAULT gen_random_uuid()::TEXT,
  "adminId"   TEXT                NOT NULL,
  "name"      TEXT                NOT NULL,
  "type"      "IntegrationType"   NOT NULL,
  "apiKey"    TEXT                NOT NULL UNIQUE,
  "apiSecret" TEXT,
  "config"    JSONB,
  "status"    "IntegrationStatus" NOT NULL DEFAULT 'ACTIVE',
  "lastUsed"  TIMESTAMPTZ,
  "createdAt" TIMESTAMPTZ         NOT NULL DEFAULT NOW(),
  "updatedAt" TIMESTAMPTZ         NOT NULL DEFAULT NOW(),
  CONSTRAINT "Integration_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "Integration_adminId_fkey"
    FOREIGN KEY ("adminId") REFERENCES "Admin"("id")
    ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE INDEX IF NOT EXISTS "Integration_adminId_idx" ON "Integration" ("adminId");

CREATE TRIGGER "Integration_updatedAt"
  BEFORE UPDATE ON "Integration"
  FOR EACH ROW EXECUTE FUNCTION trigger_set_updated_at();

-- =============================================================================

\echo ''
\echo '✅  02_create_tables.sql — All 26 tables created successfully.'
