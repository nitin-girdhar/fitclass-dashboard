BEGIN;

/*
  ══════════════════════════════════════════════════════════════
  SERVICE LOGIN ROLES
  ══════════════════════════════════════════════════════════════

  Each microservice connects with its own login role. No two services
  share credentials. Services activate group privileges per transaction:

    BEGIN;
    SET LOCAL ROLE app_user;                     -- activates RLS + table grants
    SET LOCAL app.current_org_id    = '<uuid>';
    SET LOCAL app.current_user_id   = '<uuid>';
    COMMIT;

  ┌─────────────────┬───────────────────────────────────────────────────┐
  │ Login Role      │ Purpose                              Group         │
  ├─────────────────┼───────────────────────────────────────────────────┤
  │ lead_svc        │ Lead management API                  app_user      │
  │ campaign_svc    │ Campaign management API               app_user      │
  │ user_mgmt_svc   │ User / org / hierarchy API            app_user      │
  │ notif_svc       │ Follow-up notification service        app_user      │
  │ intake_svc      │ Inbound webhook receiver              app_user      │
  │ tenant_dash_svc │ Tenant dashboard API                  tenant_admin  │
  │ analytics_svc   │ Reporting — READ REPLICA only         BYPASSRLS     │
  └─────────────────┴───────────────────────────────────────────────────┘

  analytics_svc: BYPASSRLS + SELECT only — background batch job that needs
  cross-tenant visibility. Connects to the read replica, never the primary.
  No SET LOCAL ROLE needed; no INSERT/UPDATE/DELETE path exists.

  intake_svc: receives external webhooks — rotate credentials immediately
  on any suspected exposure, without waiting for a scheduled rotation cycle.

  PGBOUNCER (transaction mode required for SET LOCAL):

    [databases]
    crm_lead        = host=pg-primary.internal dbname=crm_db user=lead_svc
    crm_campaign    = host=pg-primary.internal dbname=crm_db user=campaign_svc
    crm_user_mgmt   = host=pg-primary.internal dbname=crm_db user=user_mgmt_svc
    crm_notif       = host=pg-primary.internal dbname=crm_db user=notif_svc
    crm_intake      = host=pg-primary.internal dbname=crm_db user=intake_svc
    crm_tenant_dash = host=pg-primary.internal dbname=crm_db user=tenant_dash_svc
    crm_analytics   = host=pg-replica.internal  dbname=crm_db user=analytics_svc

    [pgbouncer]
    pool_mode = transaction
    ; Suggested pool sizes: lead_svc=15, intake_svc=20, notif_svc=8,
    ;   campaign/user_mgmt=10, tenant_dash/analytics=5

  PASSWORD ROTATION — rotate before first deploy:
    ALTER ROLE lead_svc        WITH PASSWORD :'LEAD_SVC_PWD';
    ALTER ROLE campaign_svc    WITH PASSWORD :'CAMPAIGN_SVC_PWD';
    ALTER ROLE user_mgmt_svc   WITH PASSWORD :'USER_MGMT_PWD';
    ALTER ROLE notif_svc       WITH PASSWORD :'NOTIF_SVC_PWD';
    ALTER ROLE intake_svc      WITH PASSWORD :'INTAKE_SVC_PWD';
    ALTER ROLE tenant_dash_svc WITH PASSWORD :'TENANT_DASH_PWD';
    ALTER ROLE analytics_svc   WITH PASSWORD :'ANALYTICS_SVC_PWD';
*/

-- ============================================================
-- lead_svc — Lead management API
-- ============================================================
DO $$
BEGIN
    IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'lead_svc') THEN
        CREATE ROLE lead_svc WITH LOGIN PASSWORD 'replace_in_env' NOINHERIT;
    ELSE
        ALTER ROLE lead_svc WITH LOGIN NOINHERIT;
    END IF;
END;
$$;
GRANT app_user TO lead_svc;

-- ============================================================
-- campaign_svc — Ad campaign management API
-- ============================================================
DO $$
BEGIN
    IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'campaign_svc') THEN
        CREATE ROLE campaign_svc WITH LOGIN PASSWORD 'replace_in_env' NOINHERIT;
    ELSE
        ALTER ROLE campaign_svc WITH LOGIN NOINHERIT;
    END IF;
END;
$$;
GRANT app_user TO campaign_svc;

-- ============================================================
-- user_mgmt_svc — User / org / hierarchy management API
-- ============================================================
DO $$
BEGIN
    IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'user_mgmt_svc') THEN
        CREATE ROLE user_mgmt_svc WITH LOGIN PASSWORD 'replace_in_env' NOINHERIT;
    ELSE
        ALTER ROLE user_mgmt_svc WITH LOGIN NOINHERIT;
    END IF;
END;
$$;
GRANT app_user TO user_mgmt_svc;

-- ============================================================
-- notif_svc — Follow-up notification and reminder service
-- Reads follow-ups and lead contact details; updates follow-up status.
-- ============================================================
DO $$
BEGIN
    IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'notif_svc') THEN
        CREATE ROLE notif_svc WITH LOGIN PASSWORD 'replace_in_env' NOINHERIT;
    ELSE
        ALTER ROLE notif_svc WITH LOGIN NOINHERIT;
    END IF;
END;
$$;
GRANT app_user TO notif_svc;

-- ============================================================
-- intake_svc — Inbound webhook receiver
-- Receives leads from Facebook Lead Ads, Google Lead Forms, WhatsApp.
-- Faces the public internet — rotate on any suspected credential exposure.
-- ============================================================
DO $$
BEGIN
    IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'intake_svc') THEN
        CREATE ROLE intake_svc WITH LOGIN PASSWORD 'replace_in_env' NOINHERIT;
    ELSE
        ALTER ROLE intake_svc WITH LOGIN NOINHERIT;
    END IF;
END;
$$;
GRANT app_user TO intake_svc;

-- ============================================================
-- tenant_dash_svc — Tenant admin dashboard API
-- Uses tenant_admin group for cross-org reporting (tenant-scoped RLS).
-- Transaction pattern: SET LOCAL ROLE tenant_admin + app.current_tenant_id.
-- ============================================================
DO $$
BEGIN
    IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'tenant_dash_svc') THEN
        CREATE ROLE tenant_dash_svc WITH LOGIN PASSWORD 'replace_in_env' NOINHERIT;
    ELSE
        ALTER ROLE tenant_dash_svc WITH LOGIN NOINHERIT;
    END IF;
END;
$$;
GRANT tenant_admin TO tenant_dash_svc;

-- ============================================================
-- analytics_svc — Reporting / analytics (READ REPLICA only)
-- BYPASSRLS for cross-tenant aggregate visibility. SELECT only.
-- Future tables added by migrations inherit SELECT automatically.
-- ============================================================
DO $$
BEGIN
    IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'analytics_svc') THEN
        CREATE ROLE analytics_svc WITH LOGIN PASSWORD 'replace_in_env' BYPASSRLS NOINHERIT;
    ELSE
        ALTER ROLE analytics_svc WITH LOGIN BYPASSRLS NOINHERIT;
    END IF;
END;
$$;
GRANT SELECT ON ALL TABLES IN SCHEMA public TO analytics_svc;
REVOKE INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public FROM analytics_svc;
ALTER DEFAULT PRIVILEGES IN SCHEMA public
    GRANT SELECT ON TABLES TO analytics_svc;

-- ============================================================
-- SCHEMA USAGE + DATABASE CONNECT — ALL SERVICE ROLES
-- ============================================================
GRANT USAGE ON SCHEMA public TO
    lead_svc, campaign_svc, user_mgmt_svc,
    notif_svc, intake_svc, tenant_dash_svc,
    analytics_svc;

DO $$
DECLARE v_db TEXT := current_database();
BEGIN
    EXECUTE format('GRANT CONNECT ON DATABASE %I TO lead_svc',        v_db);
    EXECUTE format('GRANT CONNECT ON DATABASE %I TO campaign_svc',    v_db);
    EXECUTE format('GRANT CONNECT ON DATABASE %I TO user_mgmt_svc',   v_db);
    EXECUTE format('GRANT CONNECT ON DATABASE %I TO notif_svc',       v_db);
    EXECUTE format('GRANT CONNECT ON DATABASE %I TO intake_svc',      v_db);
    EXECUTE format('GRANT CONNECT ON DATABASE %I TO tenant_dash_svc', v_db);
    EXECUTE format('GRANT CONNECT ON DATABASE %I TO analytics_svc',   v_db);
END;
$$;

COMMIT;
