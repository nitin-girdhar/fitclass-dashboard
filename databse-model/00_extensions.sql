
-- Active: 1780601615258@@127.0.0.1@5433@crm@public
BEGIN;

-- ============================================================
-- SCHEMA VERSION TRACKING
-- Single-row-per-version log for deployment tracking.
-- Run: SELECT * FROM schema_versions ORDER BY applied_at;
-- ============================================================
CREATE TABLE IF NOT EXISTS schema_versions (
    version     TEXT        PRIMARY KEY,
    description TEXT,
    applied_at  TIMESTAMPTZ NOT NULL DEFAULT CLOCK_TIMESTAMP()
);
INSERT INTO schema_versions (version, description) VALUES
    ('1.0.0', 'CRM multi-tenant schema: core tables, RLS, audit, hierarchy, service logins')
ON CONFLICT (version) DO NOTHING;

-- ============================================================
-- EXTENSIONS
-- uuid-ossp and pgcrypto are NOT required for PostgreSQL 15+.
--   gen_random_uuid() is built-in since PG 13.
--   pgcrypto was only needed for PG ≤12 compatibility.
-- Both are commented out to avoid unnecessary extension load.
-- Uncomment ONLY if legacy application code calls uuid_generate_v4()
-- or pgcrypto functions directly.
-- ============================================================

-- CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
-- CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- pg_trgm: trigram GIN indexes for sub-linear ILIKE / similarity search
CREATE EXTENSION IF NOT EXISTS "pg_trgm";

-- btree_gin: composite GIN indexes mixing scalar + JSONB/array columns
CREATE EXTENSION IF NOT EXISTS "btree_gin";

COMMIT;

-- vector extension is isolated from the main transaction.
-- If pgvector is not installed on this host, this block raises a WARNING
-- and continues — all dependent columns and indexes remain commented out
-- in 03_core_tables.sql and 05_indexes.sql.
DO $$
BEGIN
    EXECUTE 'CREATE EXTENSION IF NOT EXISTS "vector"';
    RAISE NOTICE 'pgvector extension enabled. Uncomment embedding column in 03_core_tables.sql to activate AI features.';
EXCEPTION WHEN OTHERS THEN
    RAISE WARNING 'pgvector not available on this host (%). AI embedding features will be unavailable until the extension is installed.', SQLERRM;
END;
$$;
