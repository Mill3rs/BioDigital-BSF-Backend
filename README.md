# BioDigital BSF Backend System - Complete Tutorial & Flow Guide

## 📚 Table of Contents
1. [System Overview](#system-overview)
2. [Database Setup](#database-setup)
3. [User Roles & Permissions](#user-roles--permissions)
4. [Authentication Flow](#authentication-flow)
5. [Farm Management Flow](#farm-management-flow)
6. [Waste Management Flow](#waste-management-flow)
7. [Processing Batch Flow](#processing-batch-flow)
8. [Product Management Flow](#product-management-flow)
9. [Order & Delivery Flow](#order--delivery-flow)
10. [Offline Sync Flow](#offline-sync-flow)
11. [Real-time Updates](#real-time-updates)
12. [Complete User Journey Examples](#complete-user-journey-examples)

---

## System Overview

### What is BioDigital BSF?

BioDigital BSF is a comprehensive farm management system for Black Soldier Fly (BSF) farming operations. It helps manage:
- **Waste collection** from various sources
- **BSF processing batches** for waste conversion
- **Product management** (fertilizer, protein feed, insect oil)
- **Order fulfillment** and delivery tracking
- **Driver management** for logistics
- **Carbon savings tracking** for environmental impact

### System Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                      Clients                                 │
├──────────────┬──────────────┬──────────────┬────────────────┤
│  Mobile App  │   Web App    │   Postman    │  WebSocket    │
│  (Drivers,   │  (Admins,    │   (API       │  (Real-time)  │
│   Suppliers, │   Managers)  │   Testing)   │               │
│   Buyers)    │              │              │               │
└──────────────┴──────────────┴──────────────┴────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────┐
│                    REST API (Express.js)                     │
│  ┌──────────┐ ┌──────────┐ ┌──────────┐ ┌──────────┐       │
│  │ Routes   │→│Middleware│→│Controllers│→│ Services │       │
│  └──────────┘ └──────────┘ └──────────┘ └──────────┘       │
└─────────────────────────────────────────────────────────────┘
                              │
              ┌───────────────┼───────────────┐
              ▼               ▼               ▼
      ┌─────────────┐  ┌─────────────┐  ┌─────────────┐
      │ PostgreSQL  │  │    Redis    │  │    AWS S3   │
      │ (Database)  │  │  (Cache/    │  │  (File     │
      │             │  │   Queue)    │  │   Storage)  │
      └─────────────┘  └─────────────┘  └─────────────┘
```

---

## Database Setup

Two approaches are available: **Prisma** (code-first, recommended for development) and **raw SQL scripts** (for production provisioning or manual control).

### Prerequisites

- PostgreSQL 14+ running locally (MAMP, Homebrew, or Docker)
- `.env` file in the backend root with:

```env
DATABASE_URL="postgresql://biodigital:your_password@localhost:5432/biodigital"
```

---

### Option A — Prisma (recommended for development)

Prisma reads `prisma/schema.prisma` and manages migrations via a `_prisma_migrations` table.

#### First-time setup

```bash
# 1. Install dependencies
pnpm install

# 2. Generate the Prisma client from schema.prisma
pnpm prisma:generate
# or: npx prisma generate

# 3. Create the database and apply all migrations
pnpm prisma:migrate
# or: npx prisma migrate dev
# Prompts for a migration name on first run — enter anything, e.g. "init"

# 4. Seed default data (super-admin, system settings, etc.)
pnpm prisma:seed
# or: node prisma/seed.js
```

#### After changing schema.prisma

```bash
# Create a new migration and apply it
npx prisma migrate dev --name <describe_the_change>
# e.g.: npx prisma migrate dev --name add_crops_to_supplier_profile

# Regenerate the client to pick up new types
pnpm prisma:generate
```

#### Production deploy (no interactive prompts)

```bash
# Applies all pending migrations without creating new ones
pnpm prisma:migrate:prod
# or: npx prisma migrate deploy
```

#### Useful Prisma commands

| Command | Purpose |
|---|---|
| `npx prisma studio` | Browser-based DB explorer at http://localhost:5555 |
| `npx prisma migrate status` | Show which migrations have/haven't been applied |
| `npx prisma migrate diff ...` | Show diff between schema and live DB |
| `npx prisma db pull` | Introspect live DB and update schema.prisma |
| `npx prisma db push` | Push schema changes directly without a migration file (dev only) |

---

### Option B — Raw SQL scripts

Scripts live in `scripts/sql/` and must be run **in numeric order**. They are grouped into two workflows: **fresh install** and **schema migration**.

#### Workflow 1 — Fresh install (empty database)

Run these three scripts once on a new machine or clean environment.

```bash
# Step 1 — Create the database, extensions, and all ENUM types
#          Run as the postgres superuser
psql -U postgres -f scripts/sql/01_create_database.sql

# Step 2 — Create all 26 application tables, indexes, and triggers
#          Run as the application user (biodigital)
psql -U biodigital -d biodigital -f scripts/sql/02_create_tables.sql

# Step 3 — Insert mandatory seed data (system settings, default roles, etc.)
psql -U biodigital -d biodigital -f scripts/sql/03_insert_default_data.sql
```

#### Workflow 2 — Schema migration (existing live database)

Use this workflow when the table structure changes and you need to preserve existing data.

```bash
# Step 4 — Rename all current tables to x_<table> backups
psql -U biodigital -d biodigital -f scripts/sql/04_rename_database_tables.sql

# Step 5 — Create the improved/updated table definitions
psql -U biodigital -d biodigital -f scripts/sql/05_update_database_tables.sql

# Step 6 — Copy data from the x_ backup tables into the new tables
psql -U biodigital -d biodigital -f scripts/sql/06_insert_old_data_into_updated_database_tables.sql

# Step 7 — Drop the x_ backup tables once data is verified
psql -U biodigital -d biodigital -f scripts/sql/07_delete_old_tables.sql

# Step 8 — Apply dashboard indexes and performance settings
psql -U biodigital -d biodigital -f scripts/sql/08_dashboard_indexes_and_settings.sql
```

#### Nuclear option — drop everything

```bash
# Terminates all connections and drops the biodigital database entirely.
# IRREVERSIBLE — only use on dev/staging.
psql -U postgres -f scripts/sql/09_drop_database.sql
```

#### Granting permissions after table creation

If tables were created by a different PostgreSQL user (e.g. `postgres`), the `biodigital` app user needs explicit grants:

```bash
psql -U postgres -d biodigital -c "
GRANT ALL PRIVILEGES ON ALL TABLES IN SCHEMA public TO biodigital;
GRANT ALL PRIVILEGES ON ALL SEQUENCES IN SCHEMA public TO biodigital;
GRANT USAGE ON SCHEMA public TO biodigital;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON TABLES TO biodigital;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON SEQUENCES TO biodigital;
"
```

---

### SQL script reference

| Script | Run as | Purpose |
|---|---|---|
| `01_create_database.sql` | `postgres` | Create DB, enable extensions, define all ENUM types |
| `02_create_tables.sql` | `biodigital` | Create all 26 tables with constraints, indexes, triggers |
| `03_insert_default_data.sql` | `biodigital` | Seed mandatory default records |
| `04_rename_database_tables.sql` | `biodigital` | Backup live tables to `x_` prefix before a migration |
| `05_update_database_tables.sql` | `biodigital` | Create the updated table definitions |
| `06_insert_old_data_into_updated_database_tables.sql` | `biodigital` | Migrate data from `x_` backups into new tables |
| `07_delete_old_tables.sql` | `biodigital` | Drop `x_` backup tables after data is verified |
| `08_dashboard_indexes_and_settings.sql` | `biodigital` | Apply performance indexes and DB settings |
| `09_drop_database.sql` | `postgres` | Drop the entire database (irreversible) |

---

## User Roles & Permissions

### Role Hierarchy

```
                    ┌─────────────────┐
                    │  SUPER_ADMIN    │
                    │ (System Owner)  │
                    └────────┬────────┘
                             │
                    ┌────────▼────────┐
                    │     ADMIN       │
                    │ (Company Owner) │
                    └────────┬────────┘
                             │
                    ┌────────▼────────┐
                    │    MANAGER      │
                    │ (Farm Manager)  │
                    └─────────────────┘
```

### Mobile App Users

```
┌─────────────┐  ┌─────────────┐  ┌─────────────┐
│   DRIVER    │  │  SUPPLIER   │  │   BUYER     │
│ (Delivery)  │  │ (Waste      │  │ (Product    │
│             │  │  Supplier)  │  │  Customer)  │
└─────────────┘  └─────────────┘  └─────────────┘
```

### Permission Matrix

| Action | Super Admin | Admin | Manager | Driver | Supplier | Buyer |
|--------|-------------|-------|---------|--------|----------|-------|
| Create Admin | ✅ | ❌ | ❌ | ❌ | ❌ | ❌ |
| Manage Farms | ✅ | ✅ | ✅ (own) | ❌ | ❌ | ❌ |
| Record Waste | ✅ | ✅ | ✅ | ❌ | ✅ | ❌ |
| Create Batches | ✅ | ✅ | ✅ | ❌ | ❌ | ❌ |
| Manage Products | ✅ | ✅ | ✅ | ❌ | ❌ | ❌ |
| Place Orders | ✅ | ✅ | ❌ | ❌ | ❌ | ✅ |
| Accept Deliveries | ✅ | ✅ | ❌ | ✅ | ❌ | ❌ |
| View Reports | ✅ | ✅ | ✅ | ❌ | ✅ | ✅ |

---

## Authentication Flow

### 1. User Registration

**Flow Diagram:**
```
User → POST /api/auth/register → Server → Validate Input → Hash Password → Create User → Generate JWT → Return Token
```

**Step-by-Step:**

```bash
# 1. Register a new Driver
curl -X POST http://localhost:3000/api/auth/register \
  -H "Content-Type: application/json" \
  -d '{
    "email": "driver@example.com",
    "password": "Driver123!",
    "fullName": "John Driver",
    "phoneNumber": "+233201234567",
    "role": "DRIVER"
  }'
```

**What happens behind the scenes:**
1. Email is validated (must be unique)
2. Password is hashed using bcrypt (10 rounds)
3. User record created in database
4. Role-specific profile created (DriverProfile, BuyerProfile, or SupplierProfile)
5. JWT token generated (expires in 7 days)
6. Welcome email sent (if configured)

### 2. User Login

```bash
# 2. Login
curl -X POST http://localhost:3000/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{
    "email": "driver@example.com",
    "password": "Driver123!"
  }'
```

**Response:**
```json
{
  "success": true,
  "data": {
    "token": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...",
    "refreshToken": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...",
    "user": {
      "id": "user_123",
      "email": "driver@example.com",
      "fullName": "John Driver",
      "role": "DRIVER"
    }
  }
}
```

### 3. Using the JWT Token

**All subsequent requests must include the token:**
```bash
curl -X GET http://localhost:3000/api/users/profile \
  -H "Authorization: Bearer YOUR_TOKEN_HERE"
```

### 4. Token Refresh (When token expires)

```bash
curl -X POST http://localhost:3000/api/auth/refresh-token \
  -H "Content-Type: application/json" \
  -d '{"refreshToken": "YOUR_REFRESH_TOKEN"}'
```

---

## Farm Management Flow

### Creating a Farm (Admin/Manager)

**Flow:**
```
Admin → POST /api/farms → Validate Data → Create Farm → Assign Manager → Return Farm
```

```bash
# 1. Create a farm
curl -X POST http://localhost:3000/api/farms \
  -H "Authorization: Bearer YOUR_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "name": "Green Valley Farm",
    "type": "FAMILY_FARM",
    "area": 100.5,
    "country": "Ghana",
    "region": "Greater Accra",
    "city": "Accra",
    "location": {
      "lat": 5.6037,
      "lng": -0.1870
    }
  }'
```

### Assigning a Manager

```bash
# 2. Assign manager to farm
curl -X POST http://localhost:3000/api/farms/{farmId}/assign-manager \
  -H "Authorization: Bearer YOUR_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"managerId": "manager_user_id"}'
```

### Viewing Farm Dashboard

```bash
# 3. Get farm statistics
curl -X GET http://localhost:3000/api/farms/{farmId}/stats \
  -H "Authorization: Bearer YOUR_TOKEN"
```

**What you see:**
- Total waste collected (kg)
- Total carbon saved (kg CO2e)
- Active processing batches
- Total revenue generated
- Monthly trends

---

## Waste Management Flow

### Complete Waste Management Lifecycle

```
Supplier Records Waste → Admin Schedules Collection → Driver Collects → Processing Batch → Final Products
```

### 1. Recording Waste (Supplier/Manager)

```bash
# Supplier records waste available for collection
curl -X POST http://localhost:3000/api/waste \
  -H "Authorization: Bearer YOUR_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "sourceName": "Central Market Waste",
    "sourceType": "MARKET_WASTE",
    "quantity": 500,
    "unit": "kg",
    "date": "2024-01-15T10:00:00Z",
    "location": {
      "lat": 5.6037,
      "lng": -0.1870,
      "address": "Central Market, Accra"
    },
    "farmId": "farm_id_here"
  }'
```

**System Response:**
- Waste record created with status "PENDING"
- Carbon savings calculated automatically
- Notification sent to farm manager
- Farm's total waste count updated

### 2. Viewing Waste Records

```bash
# Get all waste records with filters
curl -X GET "http://localhost:3000/api/waste?status=PENDING&page=1&limit=20" \
  -H "Authorization: Bearer YOUR_TOKEN"
```

### 3. Assigning Driver (Admin/Manager)

```bash
# Assign a driver to collect the waste
curl -X PATCH http://localhost:3000/api/waste/{wasteId}/assign-driver \
  -H "Authorization: Bearer YOUR_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"driverId": "driver_user_id"}'
```

**What happens:**
- Waste status changes to "SCHEDULED"
- Driver receives push notification
- Collection appears in driver's app

### 4. Driver Collects Waste

```bash
# Driver marks waste as collected
curl -X PATCH http://localhost:3000/api/waste/{wasteId}/collect \
  -H "Authorization: Bearer YOUR_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "notes": "Waste collected successfully",
    "images": ["https://example.com/collection.jpg"],
    "quantity": 480
  }'
```

**System updates:**
- Status changes to "COLLECTED"
- Actual collected quantity recorded
- Driver location tracked (if WebSocket connected)
- Farm notified of collection

### 5. Waste Statistics

```bash
# Get waste analytics
curl -X GET http://localhost:3000/api/waste/summary/stats \
  -H "Authorization: Bearer YOUR_TOKEN"
```

**Returns:**
- Total waste collected (by source type)
- Carbon savings breakdown
- Collection efficiency metrics
- Daily/weekly/monthly trends

---

## Processing Batch Flow

### BSF Processing Lifecycle

```
Waste Received → Batch Created → Active Processing → Quality Checks → Output Recorded → Products Created
```

### 1. Creating a Processing Batch

```bash
# Manager creates a new processing batch
curl -X POST http://localhost:3000/api/processing/batches \
  -H "Authorization: Bearer YOUR_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "name": "January Batch 2024",
    "processType": "BSF_LARVAE_PROCESSING",
    "quantity": 1000,
    "startDate": "2024-01-01T08:00:00Z",
    "temperature": 28.5,
    "materialLevel": 75,
    "moistureContent": 60
  }'
```

### 2. Adding Waste to Batch

```bash
# Add collected waste records to the batch
curl -X POST http://localhost:3000/api/processing/batches/{batchId}/add-waste \
  -H "Authorization: Bearer YOUR_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "wasteRecordIds": ["waste_id_1", "waste_id_2", "waste_id_3"]
  }'
```

### 3. Monitoring Batch (Real-time via WebSocket)

```javascript
// Socket.io connection for real-time monitoring
const socket = io('http://localhost:3000', {
  auth: { token: 'YOUR_TOKEN' }
});

// Join batch room
socket.emit('batch:join', 'batch_id_here');

// Listen for parameter updates
socket.on('batch:parameters', (data) => {
  console.log('Temperature:', data.parameters.temperature);
  console.log('Moisture:', data.parameters.moistureContent);
});

// Update parameters in real-time
socket.emit('batch:update-parameters', {
  batchId: 'batch_id_here',
  temperature: 30.2,
  moistureContent: 65
});
```

### 4. Quality Control Checks

```bash
# Add quality check during processing
curl -X POST http://localhost:3000/api/processing/batches/{batchId}/quality-check \
  -H "Authorization: Bearer YOUR_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "checkType": "TEMPERATURE",
    "parameter": "Core Temperature",
    "value": 65.5,
    "unit": "°C",
    "minThreshold": 55,
    "maxThreshold": 70,
    "notes": "Temperature within optimal range"
  }'
```

### 5. Recording Batch Output

```bash
# Record final output when batch completes
curl -X POST http://localhost:3000/api/processing/batches/{batchId}/record-output \
  -H "Authorization: Bearer YOUR_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "liquidOutput": 300,
    "fertilizerOutput": 450,
    "gasOutput": 75,
    "conversionRate": 85.5,
    "processingEfficiency": 90.2
  }'
```

**System automatically:**
- Marks batch as "COMPLETED"
- Updates waste records to "PROCESSED"
- Calculates carbon savings
- Creates products from outputs
- Notifies farm manager

### 6. Viewing Batch Activity

```bash
# Get batch activity logs
curl -X GET http://localhost:3000/api/processing/batches/{batchId}/activity-logs?limit=50 \
  -H "Authorization: Bearer YOUR_TOKEN"
```

---

## Product Management Flow

### From Batch Output to Market Products

```
Batch Output → Create Products → Set Variants → Publish → Customer Orders
```

### 1. Creating Products from Batch Output

```bash
# Create a product from fertilizer output
curl -X POST http://localhost:3000/api/products \
  -H "Authorization: Bearer YOUR_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "name": "Premium Organic BSF Fertilizer",
    "description": "High-quality organic fertilizer from BSF larvae",
    "category": "ORGANIC_FERTILIZER",
    "images": ["https://example.com/product.jpg"],
    "tags": ["organic", "fertilizer", "bsf"],
    "variants": [
      {
        "name": "25kg Bag",
        "quantity": 100,
        "price": 35.00,
        "unitType": "bag",
        "unitValue": 25,
        "minOrderQuantity": 2
      },
      {
        "name": "50kg Bag",
        "quantity": 50,
        "price": 65.00,
        "unitType": "bag",
        "unitValue": 50,
        "minOrderQuantity": 1
      }
    ]
  }'
```

### 2. Viewing Available Products (Buyer)

```bash
# Browse products with filters
curl -X GET "http://localhost:3000/api/products?category=ORGANIC_FERTILIZER&minPrice=10&maxPrice=100" \
  -H "Authorization: Bearer YOUR_TOKEN"
```

### 3. Adding Product Reviews

```bash
# Customer adds review
curl -X POST http://localhost:3000/api/products/{productId}/reviews \
  -H "Authorization: Bearer YOUR_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "rating": 5,
    "title": "Excellent product!",
    "comment": "This fertilizer greatly improved my crop yield",
    "images": ["https://example.com/review.jpg"]
  }`
```

---

## Order & Delivery Flow

### Complete E-commerce Flow

```
Customer Browses → Adds to Cart → Places Order → Admin Assigns Driver → Driver Delivers → Customer Receives
```

### 1. Shopping Cart Operations

```bash
# Add to cart
curl -X POST http://localhost:3000/api/cart/add \
  -H "Authorization: Bearer YOUR_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "variantId": "variant_id_here",
    "quantity": 2
  }'

# View cart
curl -X GET http://localhost:3000/api/cart \
  -H "Authorization: Bearer YOUR_TOKEN"

# Update quantity
curl -X PUT http://localhost:3000/api/cart/update/{itemId} \
  -H "Authorization: Bearer YOUR_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"quantity": 3}'

# Remove item
curl -X DELETE http://localhost:3000/api/cart/remove/{itemId} \
  -H "Authorization: Bearer YOUR_TOKEN"
```

### 2. Placing an Order

```bash
# Create order from cart
curl -X POST http://localhost:3000/api/orders \
  -H "Authorization: Bearer YOUR_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "items": [
      {"variantId": "variant_1", "quantity": 2},
      {"variantId": "variant_2", "quantity": 1}
    ],
    "deliveryAddress": {
      "street": "123 Liberation Road",
      "city": "Accra",
      "region": "Greater Accra",
      "country": "Ghana",
      "postalCode": "GA-123",
      "phone": "+233201234567"
    },
    "paymentMethod": "MOBILE_MONEY",
    "specialInstructions": "Call before delivery"
  }`
```

**What happens automatically:**
- Order number generated (e.g., ORD-1705305600000-ABC123)
- Stock quantities reduced
- Cart cleared
- Order confirmation sent via email/SMS
- Notification sent to farm admin

### 3. Admin Assigns Driver

```bash
# Admin assigns driver to order
curl -X POST http://localhost:3000/api/orders/{orderId}/assign-driver \
  -H "Authorization: Bearer YOUR_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"driverId": "driver_user_id"}'
```

**Driver receives:**
- Push notification
- Order details in their app
- Customer address and contact
- Optimized delivery route

### 4. Real-time Order Tracking (WebSocket)

```javascript
// Customer tracks order
socket.emit('order:join', 'order_id_here');

// Listen for status updates
socket.on('order:status', (data) => {
  console.log(`Order status: ${data.status}`);
  console.log(`Updated by: ${data.updatedBy}`);
  console.log(`Time: ${data.timestamp}`);
});

// Driver updates location
socket.emit('driver:location', {
  orderId: 'order_id_here',
  lat: 5.6037,
  lng: -0.1870,
  heading: 180,
  speed: 45
});

// Customer sees driver on map
socket.on('driver:location', (data) => {
  updateMapMarker(data.location);
});
```

### 5. Driver Updates Delivery Status

```bash
# Driver marks as out for delivery
curl -X POST http://localhost:3000/api/orders/{orderId}/update-status \
  -H "Authorization: Bearer YOUR_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "status": "OUT_FOR_DELIVERY",
    "location": {"lat": 5.6037, "lng": -0.1870}
  }'

# Driver marks as delivered
curl -X POST http://localhost:3000/api/orders/{orderId}/update-status \
  -H "Authorization: Bearer YOUR_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "status": "DELIVERED",
    "notes": "Order delivered successfully"
  }'
```

### 6. Order Statistics

```bash
# Get order analytics
curl -X GET http://localhost:3000/api/orders/stats/summary \
  -H "Authorization: Bearer YOUR_TOKEN"
```

**Returns:**
- Total orders (by status)
- Total revenue
- Average order value
- Monthly trends
- Top products

---

## Offline Sync Flow

### For Mobile App Users (Drivers, Suppliers)

```
Offline Operation → Store Locally → Internet Detected → Sync to Server → Conflict Resolution
```

### 1. Mobile App Offline Architecture

```javascript
// Mobile app database (SQLite)
class OfflineService {
  // Save waste record when offline
  async saveWasteOffline(wasteData) {
    // Store locally with PENDING status
    await db.save('pending_operations', {
      id: uuid(),
      action: 'CREATE_WASTE',
      data: wasteData,
      timestamp: Date.now()
    });
    
    // Show success to user immediately
    return { success: true, synced: false };
  }
  
  // Sync when online
  async syncToServer() {
    const pendingOps = await db.getPendingOperations();
    
    const response = await fetch('/api/sync/sync', {
      method: 'POST',
      body: JSON.stringify({ pendingOperations: pendingOps }),
      headers: { 'Authorization': `Bearer ${token}` }
    });
    
    const result = await response.json();
    
    // Handle conflicts
    for (const conflict of result.conflicts) {
      await this.resolveConflict(conflict);
    }
    
    // Mark as synced
    await db.markSynced(result.successfulOps);
  }
}
```

### 2. Server Sync Endpoint

```bash
# Sync offline data to server
curl -X POST http://localhost:3000/api/sync/sync \
  -H "Authorization: Bearer YOUR_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "pendingOperations": [
      {
        "id": "local_op_1",
        "action": "CREATE_WASTE",
        "entityType": "waste",
        "data": {
          "sourceName": "Offline Waste",
          "sourceType": "FOOD_WASTE",
          "quantity": 100,
          "date": "2024-01-15T10:00:00Z"
        }
      }
    ]
  }`
```

### 3. Getting Offline Data Package

```bash
# Download data for offline use
curl -X GET http://localhost:3000/api/sync/offline-data \
  -H "Authorization: Bearer YOUR_TOKEN"
```

**Returns:**
- User profile
- Assigned orders (for drivers)
- Farm data (for managers)
- Product catalog (for buyers)
- Pending operations status

### 4. Sync Status Check

```bash
# Check if sync needed
curl -X GET http://localhost:3000/api/sync/status \
  -H "Authorization: Bearer YOUR_TOKEN"
```

**Response:**
```json
{
  "success": true,
  "data": {
    "pendingCount": 3,
    "failedCount": 0,
    "lastSync": "2024-01-15T08:30:00Z",
    "needsSync": true
  }
}
```

---

## Real-time Updates (WebSocket)

### Connection Setup

```javascript
// Client-side WebSocket connection
import { io } from 'socket.io-client';

const socket = io('http://localhost:3000', {
  auth: { token: 'YOUR_JWT_TOKEN' },
  transports: ['websocket']
});

socket.on('connect', () => {
  console.log('Connected to real-time server');
});

socket.on('connected', (data) => {
  console.log(`Socket ID: ${data.socketId}`);
  console.log(`User ID: ${data.userId}`);
});
```

### Event Listeners by Role

#### For Farm Managers:
```javascript
// Listen for new waste records
socket.on('waste:new', (data) => {
  addToDashboard(data.wasteRecord);
  showNotification(`New waste: ${data.wasteRecord.quantity}kg`);
});

// Listen for batch updates
socket.on('batch:status', (data) => {
  updateBatchStatus(data.batchId, data.status);
});

// Listen for orders
socket.on('order:new', (data) => {
  showOrderAlert(data.order);
});
```

#### For Drivers:
```javascript
// Listen for new assignments
socket.on('delivery:assigned', (data) => {
  addToRoute(data.order);
  showNotification(`New delivery: ${data.order.orderNumber}`);
});

// Update location continuously
setInterval(() => {
  socket.emit('driver:location', {
    lat: currentLat,
    lng: currentLng,
    heading: currentHeading,
    orderId: activeOrderId
  });
}, 5000);

// Listen for customer messages
socket.on('customer:message', (data) => {
  showMessage(data.message);
});
```

#### For Customers:
```javascript
// Track order
socket.emit('order:track', orderId);

// Listen for status updates
socket.on('order:status', (data) => {
  updateOrderStatus(data.status);
  if (data.status === 'SHIPPED') {
    showTrackingMap();
  }
});

// Listen for driver location
socket.on('driver:location', (data) => {
  updateDriverMarker(data.location);
  updateETA(data.estimatedArrival);
});

// Listen for delivery completion
socket.on('order:delivered', (data) => {
  showThankYou();
  requestReview();
});
```

---

## Complete User Journey Examples

### Journey 1: Waste Supplier

```bash
# 1. Register as Supplier
curl -X POST http://localhost:3000/api/auth/register \
  -d '{"email":"supplier@example.com","password":"Pass123!","fullName":"Market Supplier","role":"SUPPLIER"}'

# 2. Login
curl -X POST http://localhost:3000/api/auth/login \
  -d '{"email":"supplier@example.com","password":"Pass123!"}'

# 3. Record waste (offline capable)
curl -X POST http://localhost:3000/api/waste \
  -H "Authorization: Bearer TOKEN" \
  -d '{"sourceName":"Daily Market Waste","sourceType":"MARKET_WASTE","quantity":300,"date":"2024-01-15"}'

# 4. Check earnings
curl -X GET http://localhost:3000/api/waste/summary/stats \
  -H "Authorization: Bearer TOKEN"

# 5. View collection history
curl -X GET "http://localhost:3000/api/waste?status=COLLECTED" \
  -H "Authorization: Bearer TOKEN"
```

### Journey 2: Farm Manager

```bash
# 1. Login as Manager
curl -X POST http://localhost:3000/api/auth/login \
  -d '{"email":"manager@farm.com","password":"Manager123!"}'

# 2. View dashboard
curl -X GET http://localhost:3000/api/farms/{farmId}/stats \
  -H "Authorization: Bearer TOKEN"

# 3. Create processing batch
curl -X POST http://localhost:3000/api/processing/batches \
  -H "Authorization: Bearer TOKEN" \
  -d '{"processType":"BSF_LARVAE_PROCESSING","quantity":500,"startDate":"2024-01-15"}'

# 4. Monitor batch via WebSocket
# (Connect with Socket.IO as shown above)

# 5. Record batch output
curl -X POST http://localhost:3000/api/processing/batches/{batchId}/record-output \
  -H "Authorization: Bearer TOKEN" \
  -d '{"fertilizerOutput":250,"liquidOutput":150,"conversionRate":80}'

# 6. Create products
curl -X POST http://localhost:3000/api/products \
  -H "Authorization: Bearer TOKEN" \
  -d '{"name":"Organic Fertilizer","category":"ORGANIC_FERTILIZER","variants":[{"name":"25kg","price":35,"quantity":100}]}'

# 7. Generate report
curl -X POST http://localhost:3000/api/reports/generate \
  -H "Authorization: Bearer TOKEN" \
  -d '{"type":"WASTE_SUMMARY","format":"PDF","dateRange":{"start":"2024-01-01","end":"2024-01-31"}}'
```

### Journey 3: Customer/Buyer

```bash
# 1. Register as Buyer
curl -X POST http://localhost:3000/api/auth/register \
  -d '{"email":"buyer@example.com","password":"Buyer123!","fullName":"Jane Buyer","role":"BUYER"}'

# 2. Browse products
curl -X GET "http://localhost:3000/api/products?category=ORGANIC_FERTILIZER" \
  -H "Authorization: Bearer TOKEN"

# 3. Add to cart
curl -X POST http://localhost:3000/api/cart/add \
  -H "Authorization: Bearer TOKEN" \
  -d '{"variantId":"variant_123","quantity":2}'

# 4. Place order
curl -X POST http://localhost:3000/api/orders \
  -H "Authorization: Bearer TOKEN" \
  -d '{
    "items":[{"variantId":"variant_123","quantity":2}],
    "deliveryAddress":{"street":"123 Main St","city":"Accra","country":"Ghana"},
    "paymentMethod":"MOBILE_MONEY"
  }'

# 5. Track order via WebSocket
# (Connect with Socket.IO)

# 6. Add review after delivery
curl -X POST http://localhost:3000/api/products/{productId}/reviews \
  -H "Authorization: Bearer TOKEN" \
  -d '{"rating":5,"title":"Great product!","comment":"Excellent quality"}'
```

### Journey 4: Driver

```bash
# 1. Register as Driver
curl -X POST http://localhost:3000/api/auth/register \
  -d '{"email":"driver@example.com","password":"Driver123!","fullName":"John Driver","role":"DRIVER"}'

# 2. Update profile with vehicle info
curl -X PUT http://localhost:3000/api/driver/profile \
  -H "Authorization: Bearer TOKEN" \
  -d '{"vehicleType":"Pickup","vehiclePlateNumber":"GR-1234-20"}'

# 3. Get assigned deliveries
curl -X GET http://localhost:3000/api/driver/deliveries?status=PENDING \
  -H "Authorization: Bearer TOKEN"

# 4. Accept delivery (via WebSocket)
socket.emit('driver:accept', { orderId: 'order_123' });

# 5. Update location (real-time)
socket.emit('driver:location', {
  orderId: 'order_123',
  lat: 5.6037,
  lng: -0.1870
});

# 6. Mark as delivered
curl -X PATCH http://localhost:3000/api/driver/deliveries/{orderId}/status \
  -H "Authorization: Bearer TOKEN" \
  -d '{"status":"DELIVERED","notes":"Customer received"}'

# 7. View earnings
curl -X GET http://localhost:3000/api/driver/stats \
  -H "Authorization: Bearer TOKEN"
```

---

## Summary: System Flow Diagram

```
┌─────────────────────────────────────────────────────────────────────────┐
│                           DAILY OPERATIONS                               │
├─────────────────────────────────────────────────────────────────────────┤
│                                                                          │
│  ┌──────────┐    ┌──────────┐    ┌──────────┐    ┌──────────┐          │
│  │ Supplier │───▶│  Waste   │───▶│ Manager  │───▶│  Batch   │          │
│  │ Records  │    │ Queue    │    │ Assigns  │    │ Creates  │          │
│  │  Waste   │    │ (Pending)│    │  Driver  │    │ Process  │          │
│  └──────────┘    └──────────┘    └──────────┘    └──────────┘          │
│       │               │               │               │                 │
│       ▼               ▼               ▼               ▼                 │
│  ┌──────────┐    ┌──────────┐    ┌──────────┐    ┌──────────┐          │
│  │ Driver   │───▶│  Waste   │───▶│  Batch   │───▶│ Quality  │          │
│  │ Collects │    │ Arrives │    │ Processes│    │  Checks  │          │
│  │  Waste   │    │ at Farm  │    │  Waste   │    │  Passed  │          │
│  └──────────┘    └──────────┘    └──────────┘    └──────────┘          │
│       │               │               │               │                 │
│       ▼               ▼               ▼               ▼                 │
│  ┌──────────┐    ┌──────────┐    ┌──────────┐    ┌──────────┐          │
│  │ Output   │───▶│ Products │───▶│ Customer │───▶│  Driver  │          │
│  │ Recorded │    │ Created  │    │  Orders  │    │ Delivers │          │
│  └──────────┘    └──────────┘    └──────────┘    └──────────┘          │
│                                                                          │
└─────────────────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────────────────┐
│                         SUPPORTING SYSTEMS                               │
├─────────────────────────────────────────────────────────────────────────┤
│                                                                          │
│  ┌──────────┐    ┌──────────┐    ┌──────────┐    ┌──────────┐          │
│  │ Offline  │    │  Email/  │    │  Carbon  │    │ Reports  │          │
│  │   Sync   │    │   SMS    │    │ Savings  │    │ & Export │          │
│  │ Queue    │    │ Queue    │    │ Calcul-  │    │          │          │
│  │          │    │          │    │  ation   │    │          │          │
│  └──────────┘    └──────────┘    └──────────┘    └──────────┘          │
│                                                                          │
└─────────────────────────────────────────────────────────────────────────┘
```

---

## Key Takeaways

1. **Role-based Access**: Every user has specific permissions
2. **Offline-first**: Mobile apps work without internet
3. **Real-time Updates**: WebSocket for live tracking
4. **Automated Calculations**: Carbon savings, pricing, inventory
5. **End-to-end Tracking**: From waste to final product
6. **Analytics Ready**: Comprehensive reporting
7. **Scalable**: Queue-based background jobs
8. **Secure**: JWT authentication, encrypted data

This system is designed to handle the complete lifecycle of BSF farming operations, from waste collection to product sales, with full offline support for field workers and real-time tracking for all stakeholders.



## Database Setup

### Fresh install (run once, in order)

```bash
# 1. Create the database + extensions + ENUM types
psql -U nassifdauda -d postgres -f scripts/sql/01_create_database.sql

# 2. Create all original tables
psql -U nassifdauda -d biodigital -f scripts/sql/02_create_tables.sql

# 3. Seed default system settings, super-admin, company and vehicles
psql -U nassifdauda -d biodigital -f scripts/sql/03_insert_default_data.sql

# 4. Rename existing tables to x_ prefix (backs them up before schema update)
psql -U nassifdauda -d biodigital -f scripts/sql/04_rename_database_tables.sql

# 5. Create updated tables (new columns added to User, Farm, Order, etc.)
psql -U nassifdauda -d biodigital -f scripts/sql/05_update_database_tables.sql

# 6. Copy data from x_ backup tables into the new updated tables
psql -U nassifdauda -d biodigital -f scripts/sql/06_insert_old_data_into_updated_database_tables.sql

# 7. Drop the x_ backup tables (only after verifying row counts)
psql -U nassifdauda -d biodigital -f scripts/sql/07_delete_old_tables.sql

# 8. Add performance indexes and dashboard system settings
psql -U nassifdauda -d biodigital -f scripts/sql/08_dashboard_indexes_and_settings.sql
```

### Reset / start over

```bash
# Drop the entire database
psql -U nassifdauda -d postgres -f scripts/sql/09_drop_database.sql
```# BioDigital-BSF-Backend
