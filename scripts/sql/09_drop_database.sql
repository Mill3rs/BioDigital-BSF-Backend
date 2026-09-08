-- =============================================================================
-- BioDigital BSF Farm — Script 04: Drop Database
-- =============================================================================
-- Purpose : Terminate all active connections to the biodigital database and
--           drop it entirely. Use with caution — this is irreversible.
-- Run as  : PostgreSQL superuser (postgres)
-- Usage   : psql -U postgres -f 04_drop_database.sql
-- =============================================================================

\set ON_ERROR_STOP on

-- ── Terminate all active connections to the target database ──────────────────
SELECT pg_terminate_backend(pid)
FROM   pg_stat_activity
WHERE  datname = 'biodigital'
  AND  pid <> pg_backend_pid();

-- ── Drop the database ────────────────────────────────────────────────────────
DROP DATABASE IF EXISTS biodigital;
