BEGIN;

/*
  ══════════════════════════════════════════════════════════════
  THREE-TIER PERMISSION MODEL
  ══════════════════════════════════════════════════════════════

  ┌──────────────┬──────────────────────────────┬────────────────────────────────┐
  │ Role         │ Session vars required         │ Data scope                     │
  ├──────────────┼──────────────────────────────┼────────────────────────────────┤
  │ app_user     │ app.current_org_id            │ Single org — enforced by RLS   │
  │              │ app.current_user_id           │                                │
  ├──────────────┼──────────────────────────────┼────────────────────────────────┤
  │ tenant_admin │ app.current_tenant_id         │ All orgs under one tenant      │
  │              │ app.current_user_id           │ enforced by RLS                │
  ├──────────────┼──────────────────────────────┼────────────────────────────────┤
  │ service_role │ none (BYPASSRLS)              │ Entire database                │
  └──────────────┴──────────────────────────────┴────────────────────────────────┘

  CONNECTION POOL PATTERN (PgBouncer transaction mode):
  ─────────────────────────────────────────────────────
  The Node.js API maintains TWO pools:

    Pool A — app_user (single-org CRM operations):
      await sql.begin(async tx => {
          await tx`SET LOCAL app.current_org_id  = ${orgId}`;
          await tx`SET LOCAL app.current_user_id = ${userId}`;
          // ... operational queries ...
      });

    Pool B — tenant_admin (cross-org tenant dashboard):
      await sql.begin(async tx => {
          await tx`SET LOCAL app.current_tenant_id = ${tenantId}`;
          await tx`SET LOCAL app.current_user_id   = ${userId}`;
          // ... reporting queries across all orgs for this tenant ...
      });

  SET LOCAL scopes every GUC to the current transaction only.
  PgBouncer recycles connections after COMMIT/ROLLBACK — no bleed-over.

  SOFT DELETE: All RLS USING clauses include `AND NOT is_deleted` so that
  logically-deleted rows are invisible to both app_user and tenant_admin.
  service_role sees all rows (BYPASSRLS).
*/

-- ============================================================
-- PRE-CREATE ROLES (needed before CREATE POLICY ... TO <role>)
-- PG15 lacks CREATE ROLE IF NOT EXISTS — use DO blocks.
-- Full attributes and grants are configured in 08_grants.sql.
-- ============================================================
DO $$
BEGIN
    IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'app_user') THEN
        CREATE ROLE app_user NOINHERIT;
    END IF;
END;
$$;

DO $$
BEGIN
    IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'tenant_admin') THEN
        CREATE ROLE tenant_admin NOINHERIT;
    END IF;
END;
$$;

-- ============================================================
-- HELPER: resolve tenant-scoped org set for tenant_admin policy
-- Inlined as a subquery in each policy rather than a function
-- so the planner can push the predicate into index scans.
-- ============================================================

-- ── USERS ────────────────────────────────────────────────────
ALTER TABLE users ENABLE ROW LEVEL SECURITY;
ALTER TABLE users FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS org_isolation_policy    ON users;
DROP POLICY IF EXISTS tenant_isolation_policy ON users;

-- app_user: single-org scope + exclude soft-deleted rows
CREATE POLICY org_isolation_policy ON users
    AS PERMISSIVE FOR ALL TO app_user
    USING (
        org_id = NULLIF(current_setting('app.current_org_id', true), '')::uuid
        AND NOT is_deleted
    )
    WITH CHECK (
        org_id = NULLIF(current_setting('app.current_org_id', true), '')::uuid
        AND NOT is_deleted
    );

-- tenant_admin: all orgs belonging to current tenant + exclude soft-deleted
CREATE POLICY tenant_isolation_policy ON users
    AS PERMISSIVE FOR ALL TO tenant_admin
    USING (
        org_id IN (
            SELECT id FROM organizations
            WHERE tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid
              AND NOT is_deleted
        )
        AND NOT is_deleted
    )
    WITH CHECK (
        org_id IN (
            SELECT id FROM organizations
            WHERE tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid
              AND NOT is_deleted
        )
        AND NOT is_deleted
    );

-- ── AD_CAMPAIGNS ─────────────────────────────────────────────
ALTER TABLE ad_campaigns ENABLE ROW LEVEL SECURITY;
ALTER TABLE ad_campaigns FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS org_isolation_policy    ON ad_campaigns;
DROP POLICY IF EXISTS tenant_isolation_policy ON ad_campaigns;

CREATE POLICY org_isolation_policy ON ad_campaigns
    AS PERMISSIVE FOR ALL TO app_user
    USING     (org_id = NULLIF(current_setting('app.current_org_id', true), '')::uuid AND NOT is_deleted)
    WITH CHECK (org_id = NULLIF(current_setting('app.current_org_id', true), '')::uuid AND NOT is_deleted);

CREATE POLICY tenant_isolation_policy ON ad_campaigns
    AS PERMISSIVE FOR ALL TO tenant_admin
    USING (
        org_id IN (
            SELECT id FROM organizations
            WHERE tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid
              AND NOT is_deleted
        )
        AND NOT is_deleted
    )
    WITH CHECK (
        org_id IN (
            SELECT id FROM organizations
            WHERE tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid
              AND NOT is_deleted
        )
        AND NOT is_deleted
    );

-- ── MARKETING_LEADS ──────────────────────────────────────────
ALTER TABLE marketing_leads ENABLE ROW LEVEL SECURITY;
ALTER TABLE marketing_leads FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS org_isolation_policy    ON marketing_leads;
DROP POLICY IF EXISTS tenant_isolation_policy ON marketing_leads;

CREATE POLICY org_isolation_policy ON marketing_leads
    AS PERMISSIVE FOR ALL TO app_user
    USING     (org_id = NULLIF(current_setting('app.current_org_id', true), '')::uuid AND NOT is_deleted)
    WITH CHECK (org_id = NULLIF(current_setting('app.current_org_id', true), '')::uuid AND NOT is_deleted);

CREATE POLICY tenant_isolation_policy ON marketing_leads
    AS PERMISSIVE FOR ALL TO tenant_admin
    USING (
        org_id IN (
            SELECT id FROM organizations
            WHERE tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid
              AND NOT is_deleted
        )
        AND NOT is_deleted
    )
    WITH CHECK (
        org_id IN (
            SELECT id FROM organizations
            WHERE tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid
              AND NOT is_deleted
        )
        AND NOT is_deleted
    );

-- ── LEAD_INTERACTIONS ────────────────────────────────────────
ALTER TABLE lead_interactions ENABLE ROW LEVEL SECURITY;
ALTER TABLE lead_interactions FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS org_isolation_policy    ON lead_interactions;
DROP POLICY IF EXISTS tenant_isolation_policy ON lead_interactions;

CREATE POLICY org_isolation_policy ON lead_interactions
    AS PERMISSIVE FOR ALL TO app_user
    USING     (org_id = NULLIF(current_setting('app.current_org_id', true), '')::uuid AND NOT is_deleted)
    WITH CHECK (org_id = NULLIF(current_setting('app.current_org_id', true), '')::uuid AND NOT is_deleted);

CREATE POLICY tenant_isolation_policy ON lead_interactions
    AS PERMISSIVE FOR ALL TO tenant_admin
    USING (
        org_id IN (
            SELECT id FROM organizations
            WHERE tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid
              AND NOT is_deleted
        )
        AND NOT is_deleted
    )
    WITH CHECK (
        org_id IN (
            SELECT id FROM organizations
            WHERE tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid
              AND NOT is_deleted
        )
        AND NOT is_deleted
    );

-- ── LEAD_FOLLOW_UPS ──────────────────────────────────────────
ALTER TABLE lead_follow_ups ENABLE ROW LEVEL SECURITY;
ALTER TABLE lead_follow_ups FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS org_isolation_policy    ON lead_follow_ups;
DROP POLICY IF EXISTS tenant_isolation_policy ON lead_follow_ups;

CREATE POLICY org_isolation_policy ON lead_follow_ups
    AS PERMISSIVE FOR ALL TO app_user
    USING     (org_id = NULLIF(current_setting('app.current_org_id', true), '')::uuid AND NOT is_deleted)
    WITH CHECK (org_id = NULLIF(current_setting('app.current_org_id', true), '')::uuid AND NOT is_deleted);

CREATE POLICY tenant_isolation_policy ON lead_follow_ups
    AS PERMISSIVE FOR ALL TO tenant_admin
    USING (
        org_id IN (
            SELECT id FROM organizations
            WHERE tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid
              AND NOT is_deleted
        )
        AND NOT is_deleted
    )
    WITH CHECK (
        org_id IN (
            SELECT id FROM organizations
            WHERE tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid
              AND NOT is_deleted
        )
        AND NOT is_deleted
    );

-- ============================================================
-- set_org_id() — auto-populate org_id on INSERT
-- ============================================================
CREATE OR REPLACE FUNCTION set_org_id()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
DECLARE
    v_org_id_text TEXT;
BEGIN
    IF NEW.org_id IS NULL THEN
        v_org_id_text := current_setting('app.current_org_id', true);
        IF v_org_id_text IS NULL OR v_org_id_text = '' THEN
            RAISE EXCEPTION
                'org_id is NULL and app.current_org_id session variable is not set. '
                'Execute SET LOCAL app.current_org_id = ''<uuid>'' at transaction start.';
        END IF;
        NEW.org_id := v_org_id_text::uuid;
    END IF;
    RETURN NEW;
END;
$$;

-- Triggers named trg_00_* fire before trg_[a-z]* in alphabetical order.
-- set_org_id must run before fk_scope checks so org_id is populated first.
-- Old non-prefixed names are also dropped for idempotency on re-runs.

DROP TRIGGER IF EXISTS trg_users_set_org_id ON users;
DROP TRIGGER IF EXISTS trg_00_users_set_org_id ON users;
CREATE TRIGGER trg_00_users_set_org_id
    BEFORE INSERT ON users FOR EACH ROW EXECUTE FUNCTION set_org_id();

DROP TRIGGER IF EXISTS trg_ad_campaigns_set_org_id ON ad_campaigns;
DROP TRIGGER IF EXISTS trg_00_ad_campaigns_set_org_id ON ad_campaigns;
CREATE TRIGGER trg_00_ad_campaigns_set_org_id
    BEFORE INSERT ON ad_campaigns FOR EACH ROW EXECUTE FUNCTION set_org_id();

DROP TRIGGER IF EXISTS trg_marketing_leads_set_org_id ON marketing_leads;
DROP TRIGGER IF EXISTS trg_00_marketing_leads_set_org_id ON marketing_leads;
CREATE TRIGGER trg_00_marketing_leads_set_org_id
    BEFORE INSERT ON marketing_leads FOR EACH ROW EXECUTE FUNCTION set_org_id();

DROP TRIGGER IF EXISTS trg_lead_interactions_set_org_id ON lead_interactions;
DROP TRIGGER IF EXISTS trg_00_lead_interactions_set_org_id ON lead_interactions;
CREATE TRIGGER trg_00_lead_interactions_set_org_id
    BEFORE INSERT ON lead_interactions FOR EACH ROW EXECUTE FUNCTION set_org_id();

DROP TRIGGER IF EXISTS trg_lead_follow_ups_set_org_id ON lead_follow_ups;
DROP TRIGGER IF EXISTS trg_00_lead_follow_ups_set_org_id ON lead_follow_ups;
CREATE TRIGGER trg_00_lead_follow_ups_set_org_id
    BEFORE INSERT ON lead_follow_ups FOR EACH ROW EXECUTE FUNCTION set_org_id();

-- ── LEAD_STATUS_LOG ──────────────────────────────────────────
ALTER TABLE lead_status_log ENABLE ROW LEVEL SECURITY;
ALTER TABLE lead_status_log FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS org_isolation_policy    ON lead_status_log;
DROP POLICY IF EXISTS tenant_isolation_policy ON lead_status_log;

CREATE POLICY org_isolation_policy ON lead_status_log
    AS PERMISSIVE FOR SELECT TO app_user
    USING (org_id = NULLIF(current_setting('app.current_org_id', true), '')::uuid);

CREATE POLICY tenant_isolation_policy ON lead_status_log
    AS PERMISSIVE FOR SELECT TO tenant_admin
    USING (
        org_id IN (
            SELECT id FROM organizations
            WHERE tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid
              AND NOT is_deleted
        )
    );

COMMIT;
