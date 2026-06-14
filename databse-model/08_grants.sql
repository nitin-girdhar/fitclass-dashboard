BEGIN;

/*
  ══════════════════════════════════════════════════════════════
  ROLE ARCHITECTURE & PERMISSION MODEL
  ══════════════════════════════════════════════════════════════

  ┌──────────────┬───────────────────────────────────────────────────────────────┐
  │ Role         │ Purpose                                                       │
  ├──────────────┼───────────────────────────────────────────────────────────────┤
  │ app_user     │ NOLOGIN group role — holds all table grants for CRM services. │
  │              │ Per-service login roles are members of this group.           │
  │              │ Services call SET LOCAL ROLE app_user each transaction so    │
  │              │ RLS policies (written TO app_user) fire correctly.           │
  │              │ Per-service login credentials → 11_service_logins.sql       │
  ├──────────────┼───────────────────────────────────────────────────────────────┤
  │ tenant_admin │ NOLOGIN group role — holds grants for cross-org reporting.    │
  │              │ Per-service login roles call SET LOCAL ROLE tenant_admin.    │
  │              │ Per-service login credentials → 11_service_logins.sql       │
  ├──────────────┼───────────────────────────────────────────────────────────────┤
  │ service_role │ Backend admin: migrations, seed scripts, tenant onboarding.   │
  │              │ BYPASSRLS + LOGIN — never exposed to any API layer.           │
  └──────────────┴───────────────────────────────────────────────────────────────┘

  WHY NOLOGIN GROUP ROLES
  ════════════════════════
  Group roles (NOLOGIN) hold privilege definitions. Per-service login roles
  join the group and call SET LOCAL ROLE to activate those privileges for
  each transaction. This separates authentication identity from access scope:

    session_user  = service login role  (visible in pg_stat_activity, audit logs)
    current_user  = group role           (RLS policies fire on this value)

  PASSWORD ROTATION
  ══════════════════
  app_user and tenant_admin are NOLOGIN — no passwords to rotate.
  Rotate per-service login passwords (defined in 11_service_logins.sql):
      ALTER ROLE lead_svc        WITH PASSWORD :'LEAD_SVC_PWD';
      ALTER ROLE campaign_svc    WITH PASSWORD :'CAMPAIGN_SVC_PWD';
      ALTER ROLE user_mgmt_svc   WITH PASSWORD :'USER_MGMT_PWD';
      ALTER ROLE notif_svc       WITH PASSWORD :'NOTIF_SVC_PWD';
      ALTER ROLE intake_svc      WITH PASSWORD :'INTAKE_SVC_PWD';
      ALTER ROLE tenant_dash_svc WITH PASSWORD :'TENANT_DASH_PWD';
      ALTER ROLE service_role    WITH PASSWORD :'SERVICE_ROLE_PWD';

  TRANSACTION PATTERN FOR EVERY APP-TIER REQUEST
  ════════════════════════════════════════════════
  BEGIN;
  SET LOCAL ROLE app_user;                     -- activates group grants + RLS
  SET LOCAL app.current_org_id    = '<uuid>';  -- org isolation (RLS USING clause)
  SET LOCAL app.current_user_id   = '<uuid>';  -- audit trigger + created_by
  SET LOCAL app.current_tenant_id = '<uuid>';  -- tenant-admin scope if needed
  -- DML here
  COMMIT;
  -- PgBouncer transaction mode resets all SET LOCAL state after COMMIT
*/

-- Prevent any authenticated role from creating objects in public schema
REVOKE CREATE ON SCHEMA public FROM PUBLIC;
REVOKE ALL    ON SCHEMA public FROM PUBLIC;
GRANT  USAGE  ON SCHEMA public TO PUBLIC;

-- ============================================================
-- ROLE: app_user  (NOLOGIN group role)
-- Per-service login roles live in 11_service_logins.sql
-- ============================================================
DO $$
BEGIN
    IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'app_user') THEN
        CREATE ROLE app_user NOLOGIN NOINHERIT;
    ELSE
        ALTER ROLE app_user NOLOGIN NOINHERIT;
    END IF;
END;
$$;

-- ============================================================
-- ROLE: tenant_admin  (NOLOGIN group role)
-- Per-service login roles live in 11_service_logins.sql
-- ============================================================
DO $$
BEGIN
    IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'tenant_admin') THEN
        CREATE ROLE tenant_admin NOLOGIN NOINHERIT;
    ELSE
        ALTER ROLE tenant_admin NOLOGIN NOINHERIT;
    END IF;
END;
$$;

-- ============================================================
-- ROLE: service_role  (LOGIN + BYPASSRLS)
-- Password NOT reset on re-run to avoid overwriting rotated credentials.
-- ============================================================
DO $$
BEGIN
    IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'service_role') THEN
        CREATE ROLE service_role WITH LOGIN PASSWORD 'replace_in_env' BYPASSRLS;
    ELSE
        ALTER ROLE service_role WITH LOGIN BYPASSRLS;
    END IF;
END;
$$;

-- ============================================================
-- DATABASE & SCHEMA ACCESS
-- app_user and tenant_admin are NOLOGIN — CONNECT is not applicable.
-- Per-service login roles receive GRANT CONNECT in 11_service_logins.sql.
-- ============================================================
DO $$
BEGIN
    EXECUTE format('GRANT CONNECT ON DATABASE %I TO service_role', current_database());
END;
$$;

GRANT USAGE ON SCHEMA public TO app_user;
GRANT USAGE ON SCHEMA public TO tenant_admin;
GRANT USAGE ON SCHEMA public TO service_role;

-- ============================================================
-- GRANTS: app_user
-- Explicit per-table grants — blanket GRANT ON ALL TABLES is avoided
-- to prevent unintended access to admin tables like tenants.
-- ============================================================

GRANT SELECT, INSERT, UPDATE ON TABLE
    users, ad_campaigns, marketing_leads,
    lead_interactions, lead_follow_ups
TO app_user;

-- Physical DELETE is revoked — soft delete via UPDATE is_deleted=TRUE is the only path
REVOKE DELETE ON TABLE
    users, ad_campaigns, marketing_leads,
    lead_interactions, lead_follow_ups
FROM app_user;

GRANT SELECT ON TABLE
    tenant_domains, tenant_plan_types, org_types, user_roles,
    marketing_platforms, campaign_statuses, lead_stage,
    lead_stage_outcome, interaction_types, follow_up_statuses
TO app_user;

GRANT SELECT ON TABLE countries, states, cities TO app_user;
GRANT SELECT ON TABLE organizations              TO app_user;

-- Audit tables: SELECT only — INSERTs are via SECURITY DEFINER trigger functions
GRANT SELECT ON TABLE marketing_leads_history TO app_user;
REVOKE INSERT, UPDATE, DELETE ON TABLE marketing_leads_history FROM app_user;

GRANT SELECT ON TABLE audit_log TO app_user;
REVOKE INSERT, UPDATE, DELETE ON TABLE audit_log FROM app_user;

GRANT SELECT ON TABLE lead_status_log TO app_user;
REVOKE INSERT, UPDATE, DELETE ON TABLE lead_status_log FROM app_user;

GRANT SELECT ON TABLE
    vw_dashboard_leads,
    vw_sales_follow_up_pipeline,
    vw_org_performance_snapshot,
    vw_lead_followup_timeline,
    vw_followup_pipeline_enriched
TO app_user;

-- ============================================================
-- GRANTS: tenant_admin
-- ============================================================

GRANT SELECT, INSERT, UPDATE ON TABLE
    users, ad_campaigns, marketing_leads,
    lead_interactions, lead_follow_ups
TO tenant_admin;

REVOKE DELETE ON TABLE
    users, ad_campaigns, marketing_leads,
    lead_interactions, lead_follow_ups
FROM tenant_admin;

GRANT SELECT ON TABLE organizations TO tenant_admin;

GRANT SELECT ON TABLE
    tenant_domains, tenant_plan_types, org_types, user_roles,
    marketing_platforms, campaign_statuses, lead_stage,
    lead_stage_outcome, interaction_types, follow_up_statuses,
    countries, states, cities
TO tenant_admin;

GRANT SELECT ON TABLE marketing_leads_history TO tenant_admin;

GRANT SELECT ON TABLE audit_log TO tenant_admin;
REVOKE INSERT, UPDATE, DELETE ON TABLE audit_log FROM tenant_admin;

GRANT SELECT ON TABLE lead_status_log TO tenant_admin;
REVOKE INSERT, UPDATE, DELETE ON TABLE lead_status_log FROM tenant_admin;

-- Grants for hierarchy objects (lead_assignment_log, vw_user_*, can_assign_to)
-- live in 10_user_hierarchy.sql — those objects do not exist when this file runs.

GRANT SELECT ON TABLE
    vw_dashboard_leads,
    vw_sales_follow_up_pipeline,
    vw_tenant_campaign_summary,
    vw_tenant_full_dashboard,
    vw_org_performance_snapshot,
    vw_lead_followup_timeline,
    vw_followup_pipeline_enriched
TO tenant_admin;

-- ============================================================
-- GRANTS: service_role
-- ============================================================
GRANT ALL PRIVILEGES ON ALL TABLES    IN SCHEMA public TO service_role;
GRANT ALL PRIVILEGES ON ALL SEQUENCES IN SCHEMA public TO service_role;

-- Future tables and sequences created by migrations inherit these grants automatically
ALTER DEFAULT PRIVILEGES IN SCHEMA public
    GRANT ALL PRIVILEGES ON TABLES    TO service_role;
ALTER DEFAULT PRIVILEGES IN SCHEMA public
    GRANT ALL PRIVILEGES ON SEQUENCES TO service_role;

ALTER DEFAULT PRIVILEGES IN SCHEMA public
    GRANT SELECT ON TABLES TO app_user;
ALTER DEFAULT PRIVILEGES IN SCHEMA public
    GRANT SELECT ON TABLES TO tenant_admin;

COMMIT;

