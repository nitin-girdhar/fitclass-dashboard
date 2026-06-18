BEGIN;
SET search_path TO public, pg_catalog;

/*
  ══════════════════════════════════════════════════════════════
  USER_ORG_ACCESS — MULTI-ORG USER ACCESS TABLE
  ══════════════════════════════════════════════════════════════

  Replaces the single org_id + role_id on users for access control.
  A user can belong to multiple orgs, each with a different role.

  SOURCE OF TRUTH for:
    - Which orgs a user can access
    - What role (and therefore rank) they hold in each org

  users.org_id  remains as the user's PRIMARY / home org (used as
                fallback when no org is selected and for FK integrity).
  users.role_id remains as the user's DEFAULT role (mirrors the home
                org row here; kept for backward-compat during transition).

  AUTO-GRANT TRIGGERS (defined below):
    1. When a new org is added to a tenant → all existing tenant_admins
       in that tenant automatically receive a row for the new org.
    2. When a user is first granted tenant_admin in an org → they
       automatically receive rows for all existing orgs in that tenant.

  RLS: app_user and tenant_admin see only rows for their own user.
       crm_service sees all rows (BYPASSRLS + explicit policy for FORCE RLS).
*/

-- ============================================================
-- TABLE
-- ============================================================
CREATE TABLE IF NOT EXISTS user_org_access (
    user_id    uuid     NOT NULL REFERENCES users(id)        ON DELETE CASCADE,
    org_id     uuid     NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    role_id    smallint NOT NULL REFERENCES user_roles(id)   ON DELETE RESTRICT,
    is_active  boolean  NOT NULL DEFAULT true,
    granted_by uuid     REFERENCES users(id)                 ON DELETE SET NULL,
    granted_at timestamptz NOT NULL DEFAULT CLOCK_TIMESTAMP(),
    PRIMARY KEY (user_id, org_id)
);

-- ============================================================
-- INDEXES
-- ============================================================

-- Primary lookup: all orgs a user can access (used in RLS policy)
CREATE INDEX IF NOT EXISTS idx_user_org_access_user_active
    ON user_org_access (user_id)
    WHERE is_active;

-- Reverse lookup: all users in an org (used in auto-grant triggers)
CREATE INDEX IF NOT EXISTS idx_user_org_access_org_active
    ON user_org_access (org_id)
    WHERE is_active;

-- Role-based lookups (find all tenant_admins in a tenant's orgs)
CREATE INDEX IF NOT EXISTS idx_user_org_access_role
    ON user_org_access (role_id, org_id)
    WHERE is_active;

-- ============================================================
-- UPDATED_AT trigger (access rows track when they were last modified)
-- ============================================================
ALTER TABLE user_org_access ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT CLOCK_TIMESTAMP();

DROP TRIGGER IF EXISTS trg_user_org_access_updated_at ON user_org_access;
CREATE TRIGGER trg_user_org_access_updated_at
    BEFORE UPDATE ON user_org_access
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ============================================================
-- ROW LEVEL SECURITY
-- ============================================================
ALTER TABLE user_org_access ENABLE ROW LEVEL SECURITY;
ALTER TABLE user_org_access FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS crm_service_policy  ON user_org_access;
DROP POLICY IF EXISTS app_user_policy     ON user_org_access;
DROP POLICY IF EXISTS tenant_admin_policy ON user_org_access;

-- crm_service: full access (migrations, seed scripts, auto-grant triggers use SECURITY DEFINER)
CREATE POLICY crm_service_policy ON user_org_access
    AS PERMISSIVE FOR ALL TO crm_service
    USING (true)
    WITH CHECK (true);

-- app_user: can only see their own access rows
CREATE POLICY app_user_policy ON user_org_access
    AS PERMISSIVE FOR SELECT TO app_user
    USING (
        user_id = NULLIF(current_setting('app.current_user_id', true), '')::uuid
    );

-- tenant_admin: can see all access rows for orgs within their tenant
CREATE POLICY tenant_admin_policy ON user_org_access
    AS PERMISSIVE FOR ALL TO tenant_admin
    USING (
        org_id IN (
            SELECT id FROM organizations
            WHERE tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid
              AND NOT is_deleted
        )
    )
    WITH CHECK (
        org_id IN (
            SELECT id FROM organizations
            WHERE tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid
              AND NOT is_deleted
        )
    );

-- ============================================================
-- AUTO-GRANT TRIGGER 1:
-- When a new org is created → grant all existing tenant_admins in
-- that tenant access to the new org automatically.
-- ============================================================
CREATE OR REPLACE FUNCTION auto_grant_tenant_admins_on_new_org()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
    INSERT INTO user_org_access (user_id, org_id, role_id, granted_by)
    SELECT DISTINCT
        uoa.user_id,
        NEW.id,
        uoa.role_id,
        NULL::uuid   -- system-granted
    FROM user_org_access uoa
    JOIN organizations   o  ON o.id    = uoa.org_id
    JOIN user_roles      ur ON ur.id   = uoa.role_id
    WHERE o.tenant_id   = NEW.tenant_id
      AND ur.name       = 'tenant_admin'
      AND uoa.is_active = true
    ON CONFLICT (user_id, org_id) DO NOTHING;

    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_auto_grant_tenant_admins_on_new_org ON organizations;
CREATE TRIGGER trg_auto_grant_tenant_admins_on_new_org
    AFTER INSERT ON organizations
    FOR EACH ROW
    EXECUTE FUNCTION auto_grant_tenant_admins_on_new_org();

-- ============================================================
-- AUTO-GRANT TRIGGER 2:
-- When a user is assigned tenant_admin → grant them access to all
-- existing orgs in that tenant automatically.
-- ============================================================
CREATE OR REPLACE FUNCTION auto_grant_all_tenant_orgs_on_tenant_admin()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
    v_role_name text;
    v_tenant_id uuid;
BEGIN
    SELECT name INTO v_role_name FROM user_roles WHERE id = NEW.role_id;

    IF v_role_name <> 'tenant_admin' THEN
        RETURN NEW;
    END IF;

    SELECT tenant_id INTO v_tenant_id
    FROM organizations WHERE id = NEW.org_id AND NOT is_deleted;

    IF v_tenant_id IS NULL THEN
        RETURN NEW;
    END IF;

    INSERT INTO user_org_access (user_id, org_id, role_id, granted_by)
    SELECT
        NEW.user_id,
        o.id,
        NEW.role_id,
        NEW.granted_by
    FROM organizations o
    WHERE o.tenant_id = v_tenant_id
      AND o.id       <> NEW.org_id   -- skip the row being inserted now
      AND NOT o.is_deleted
    ON CONFLICT (user_id, org_id) DO NOTHING;

    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_auto_grant_all_orgs_on_tenant_admin ON user_org_access;
CREATE TRIGGER trg_auto_grant_all_orgs_on_tenant_admin
    AFTER INSERT ON user_org_access
    FOR EACH ROW
    EXECUTE FUNCTION auto_grant_all_tenant_orgs_on_tenant_admin();

-- ============================================================
-- GRANTS
-- ============================================================
GRANT SELECT                        ON user_org_access TO app_user;
GRANT SELECT, INSERT, UPDATE        ON user_org_access TO tenant_admin;
GRANT ALL PRIVILEGES                ON user_org_access TO crm_service;

COMMIT;
