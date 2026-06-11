# BioDigital BSF Farm — Database Setup Guide

This document is the single authoritative reference for setting up and maintaining the PostgreSQL database. Follow the correct path based on your situation.

---

## Prerequisites

| Requirement | Version | Notes |
|---|---|---|
| PostgreSQL | 14 or higher | 16+ recommended |
| Node.js | 18 or higher | |
| pnpm | 8 or higher | |
| psql CLI | matches PG version | used to run SQL scripts |

---

## Path A — Fresh Installation (new machine / new environment)

Run scripts **in order**. Each script is idempotent within a clean environment.

```bash
# 1. Create database, extensions, and all ENUM types
PGPASSWORD=postgres psql -U postgres -f scripts/sql/01_create_database.sql

# 2. Create all application tables (clean slate)
PGPASSWORD=postgres psql -U postgres -d biodigital -f scripts/sql/02_create_tables.sql

# 3. Insert default seed data (system settings, roles, etc.)
PGPASSWORD=postgres psql -U postgres -d biodigital -f scripts/sql/03_insert_default_data.sql

# 4. Rename original tables to x_ prefix (migration step)
PGPASSWORD=postgres psql -U postgres -d biodigital -f scripts/sql/04_rename_database_tables.sql

# 5. Create improved table versions (adds all current columns)
PGPASSWORD=postgres psql -U postgres -d biodigital -f scripts/sql/05_update_database_tables.sql

# 6. Copy data from x_ tables into new tables
PGPASSWORD=postgres psql -U postgres -d biodigital -f scripts/sql/06_insert_old_data_into_updated_database_tables.sql

# 7. Drop the old x_ tables
PGPASSWORD=postgres psql -U postgres -d biodigital -f scripts/sql/07_delete_old_tables.sql

# 8. Add performance indexes and system settings
PGPASSWORD=postgres psql -U postgres -d biodigital -f scripts/sql/08_dashboard_indexes_and_settings.sql

# 9. Generate Prisma client (no DB changes — reads schema only)
cd /path/to/biodigital_bsf_backend
npx prisma generate
```

> ⚠️ **Never run `prisma migrate dev` or `prisma db push`.** Schema changes are applied exclusively via numbered SQL scripts.

---

## Path B — Existing Database (sync to latest schema)

Use this when the database already exists and you need to bring it up to date after pulling new code.

```bash
# Run the idempotent sync script — safe to run multiple times
PGPASSWORD=postgres psql -U postgres -d biodigital -f scripts/sql/10_sync_schema.sql

# Regenerate Prisma client after any schema change
cd /path/to/biodigital_bsf_backend
npx prisma generate
```

---

## Path C — Making a Schema Change

When the Prisma schema (`prisma/schema.prisma`) changes, follow this sequence:

1. **Update `prisma/schema.prisma`** with the new model/field/enum.
2. **Update `10_sync_schema.sql`** — add an idempotent `ALTER TABLE … ADD COLUMN IF NOT EXISTS` (or `ALTER TYPE … ADD VALUE IF NOT EXISTS`) block.
3. **Update `05_update_database_tables.sql`** — add the new column/table to the fresh-install DDL so new environments get the right schema from scratch.
4. **Update `01_create_database.sql`** if a new ENUM type is added.
5. **Apply to your local DB:**
   ```bash
   PGPASSWORD=postgres psql -U postgres -d biodigital -f scripts/sql/10_sync_schema.sql
   ```
6. **Regenerate Prisma client:**
   ```bash
   npx prisma generate
   ```

---

## SQL Script Reference

| Script | Purpose | Run as |
|---|---|---|
| `01_create_database.sql` | Create DB, extensions, all ENUM types | `postgres` superuser |
| `02_create_tables.sql` | Create initial table versions | `biodigital` user or `postgres` |
| `03_insert_default_data.sql` | Seed system settings and default rows | |
| `04_rename_database_tables.sql` | Prefix old tables with `x_` | |
| `05_update_database_tables.sql` | Create current table versions (full schema) | |
| `06_insert_old_data_into_updated_database_tables.sql` | Migrate data from `x_` tables | |
| `07_delete_old_tables.sql` | Drop `x_` prefix tables | |
| `08_dashboard_indexes_and_settings.sql` | Performance indexes + dashboard settings | |
| `09_drop_database.sql` | ⚠️ Destroy the entire database (dev only) | |
| `10_sync_schema.sql` | **Idempotent sync for existing databases** | Run after pulling schema changes |

---

## Environment Variables

Copy `.env.example` to `.env` and fill in all values:

```bash
cp .env.example .env
```

Key variables:

| Variable | Example | Notes |
|---|---|---|
| `DATABASE_URL` | `postgresql://biodigital:biodigital123@localhost:5432/biodigital` | Must match the DB created by script 01 |
| `JWT_SECRET` | random 64-char string | Change in production |
| `JWT_REFRESH_SECRET` | random 64-char string | Change in production |
| `GOOGLE_CLIENT_ID` | `484345082412-…apps.googleusercontent.com` | Must match Google Cloud Console |
| `GOOGLE_CLIENT_SECRET` | from GCP | |
| `FCM_SERVER_KEY` | from Firebase Console | Push notifications |

---

## Google OAuth — Authorised Origins (required)

`Error 401: invalid_client / no registered origin` means your app's origin is not whitelisted.

1. Open [Google Cloud Console → Credentials](https://console.cloud.google.com/apis/credentials)
2. Click OAuth 2.0 Client ID `484345082412-4v6sr55etf3mmcclvh8ksi8ht59hrf0d`
3. **Authorised JavaScript origins** — add:
   - `http://localhost:5173` (web admin dev)
   - `http://localhost:3000` (if used)
   - Your production domain
4. **Authorised redirect URIs** — add the same origins
5. Save and wait ~5 minutes

---

## Starting the Backend

```bash
cd biodigital_bsf_backend
pnpm install
npx prisma generate
pnpm dev          # or: node server.js
```

Server runs on `http://localhost:3000` by default.

---

## Common Errors

| Error | Cause | Fix |
|---|---|---|
| `column "googleId" does not exist` | DB predates the Google OAuth columns | Run `10_sync_schema.sql` |
| `invalid input value for enum "NotificationType": "SUPPORT"` | Enum not patched | Run `10_sync_schema.sql` |
| `relation "SupportTicket" does not exist` | Table not yet created | Run `10_sync_schema.sql` |
| `relation "PayoutRequest" does not exist` | Table not yet created | Run `10_sync_schema.sql` |
| `null value in column "email" violates not-null constraint` | Old schema had `email NOT NULL` | Run `10_sync_schema.sql` |
| `Error 401: invalid_client` (Google login) | Origin not in GCP allowlist | See Google OAuth section above |
| Prisma client out of sync | Schema changed but client not regenerated | `npx prisma generate` |
