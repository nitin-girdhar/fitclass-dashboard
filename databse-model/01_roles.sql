-- Active: 1780601615258@@127.0.0.1@5433@crm@public

/*
  ══════════════════════════════════════════════════════════════
  ROLE BOOTSTRAP
  ══════════════════════════════════════════════════════════════

  Creates the three group/admin roles that every subsequent script
  depends on. Must run before 04_rls_policies.sql and
  06_audit_triggers.sql, which attach policies to these roles.
  Grants are handled in 08_grants.sql after all tables and views exist.

  ┌──────────────┬───────────────────────────────────────────────────────────────┐
  │ Role         │ Purpose                                                       │
  ├──────────────┼───────────────────────────────────────────────────────────────┤
  │ app_user     │ NOLOGIN group role — holds all table grants for CRM services. │
  │ tenant_admin │ NOLOGIN group role — holds grants for cross-org reporting.    │
  │ service_role │ Backend admin: migrations, seeds. BYPASSRLS + LOGIN.          │
  └──────────────┴───────────────────────────────────────────────────────────────┘

  All three blocks are idempotent — safe to re-run on existing databases.
*/

DO $$
BEGIN
    IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'app_user') THEN
        CREATE ROLE app_user NOLOGIN NOINHERIT;
    ELSE
        ALTER ROLE app_user NOLOGIN NOINHERIT;
    END IF;
END;
$$;

DO $$
BEGIN
    IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'tenant_admin') THEN
        CREATE ROLE tenant_admin NOLOGIN NOINHERIT;
    ELSE
        ALTER ROLE tenant_admin NOLOGIN NOINHERIT;
    END IF;
END;
$$;

DO $$
BEGIN
    IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'service_role') THEN
        CREATE ROLE service_role WITH LOGIN PASSWORD 'replace_in_env' BYPASSRLS;
    ELSE
        ALTER ROLE service_role WITH LOGIN BYPASSRLS;
    END IF;
END;
$$;
