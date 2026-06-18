BEGIN;
SET search_path TO public, pg_catalog;

-- ============================================================
-- UTILITY FUNCTIONS
-- ============================================================

-- All timestamps use CLOCK_TIMESTAMP() throughout this schema for consistency.
-- TIMESTAMPTZ always stores in UTC internally — timezone is never a storage concern.
-- For display in the user's local time, convert using the org's timezone column:
--   SELECT created_at AT TIME ZONE o.timezone FROM ... JOIN organizations o ...
CREATE OR REPLACE FUNCTION set_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
    NEW.updated_at = CLOCK_TIMESTAMP();
    RETURN NEW;
END;
$$;

-- Converts a physical DELETE into a soft delete (UPDATE is_deleted=TRUE).
-- Physical DELETE is only possible for crm_service (GDPR erasure / data purge).
-- The resulting UPDATE fires set_updated_at() and the audit trigger automatically.
CREATE OR REPLACE FUNCTION soft_delete_row()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
DECLARE
    v_user_id UUID;
BEGIN
    IF current_user = 'crm_service' THEN
        RETURN OLD;
    END IF;

    BEGIN
        v_user_id := NULLIF(current_setting('app.current_user_id', true), '')::uuid;
    EXCEPTION WHEN OTHERS THEN
        v_user_id := NULL;
    END;

    EXECUTE format(
        'UPDATE %I.%I SET is_deleted = TRUE, deleted_at = CLOCK_TIMESTAMP(), deleted_by = $1 WHERE id = $2',
        TG_TABLE_SCHEMA, TG_TABLE_NAME
    ) USING v_user_id, OLD.id;

    RETURN NULL;
END;
$$;

-- Auto-populates created_by from app.current_user_id on INSERT.
-- Trigger named trg_01_* so it fires after trg_00_*_set_org_id (alphabetical order).
-- NULL when no user context is present (service_role seeds and migrations).
CREATE OR REPLACE FUNCTION set_created_by()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
DECLARE v_user_id UUID;
BEGIN
    IF NEW.created_by IS NULL THEN
        BEGIN
            v_user_id := NULLIF(current_setting('app.current_user_id', true), '')::uuid;
        EXCEPTION WHEN OTHERS THEN
            v_user_id := NULL;
        END;
        NEW.created_by := v_user_id;
    END IF;
    RETURN NEW;
END;
$$;

-- ============================================================
-- TENANTS
-- Top-level billing/legal entity. No RLS — service_role access only.
-- To add a tenant: INSERT INTO tenants (name, domain_id, plan_type_id, metadata).
-- ============================================================
CREATE TABLE IF NOT EXISTS tenants (
    id           UUID     PRIMARY KEY DEFAULT gen_random_uuid(),
    name         TEXT     NOT NULL CONSTRAINT uq_tenants_name UNIQUE,
    domain_id    SMALLINT REFERENCES tenant_domains(id)    ON DELETE RESTRICT,
    plan_type_id SMALLINT REFERENCES tenant_plan_types(id) ON DELETE RESTRICT,
    metadata     JSONB    NOT NULL DEFAULT '{}',
    is_active    BOOLEAN  NOT NULL DEFAULT TRUE,
    is_deleted   BOOLEAN  NOT NULL DEFAULT FALSE,
    deleted_at   TIMESTAMPTZ,
    deleted_by   UUID,
    created_at   TIMESTAMPTZ NOT NULL DEFAULT CLOCK_TIMESTAMP(),
    updated_at   TIMESTAMPTZ NOT NULL DEFAULT CLOCK_TIMESTAMP(),
    -- A deleted entity cannot be active at the same time
    CONSTRAINT chk_tenants_active_deleted CHECK (NOT (is_active AND is_deleted))
);

DROP TRIGGER IF EXISTS trg_tenants_updated_at ON tenants;
CREATE TRIGGER trg_tenants_updated_at
    BEFORE UPDATE ON tenants FOR EACH ROW EXECUTE FUNCTION set_updated_at();

DROP TRIGGER IF EXISTS trg_tenants_soft_delete ON tenants;
CREATE TRIGGER trg_tenants_soft_delete
    BEFORE DELETE ON tenants FOR EACH ROW EXECUTE FUNCTION soft_delete_row();

-- ============================================================
-- ORGANIZATIONS
-- One org = one physical location or business unit under a tenant.
-- To add an org: INSERT with tenant_id, org_type_id, and address fields.
-- Timezone should be a valid IANA name (validate via pg_timezone_names in app).
-- ============================================================
CREATE TABLE IF NOT EXISTS organizations (
    id           UUID     PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id    UUID     NOT NULL REFERENCES tenants(id) ON DELETE RESTRICT,
    name         TEXT     NOT NULL,
    org_type_id  SMALLINT NOT NULL REFERENCES org_types(id) ON DELETE RESTRICT,
    address_line1 TEXT,
    address_line2 TEXT,
    landmark      TEXT,
    pincode       TEXT,
    city_id       INTEGER  REFERENCES cities(id)    ON DELETE RESTRICT,
    state_id      SMALLINT REFERENCES states(id)    ON DELETE RESTRICT,
    country_id    SMALLINT REFERENCES countries(id) ON DELETE RESTRICT,
    timezone     TEXT     NOT NULL DEFAULT 'UTC',
    metadata     JSONB    NOT NULL DEFAULT '{}',
    is_active    BOOLEAN  NOT NULL DEFAULT TRUE,
    is_deleted   BOOLEAN  NOT NULL DEFAULT FALSE,
    deleted_at   TIMESTAMPTZ,
    deleted_by   UUID,
    created_at   TIMESTAMPTZ NOT NULL DEFAULT CLOCK_TIMESTAMP(),
    updated_at   TIMESTAMPTZ NOT NULL DEFAULT CLOCK_TIMESTAMP(),
    CONSTRAINT uq_organizations_tenant_name UNIQUE (tenant_id, name),
    CONSTRAINT chk_organizations_active_deleted CHECK (NOT (is_active AND is_deleted))
);

DROP TRIGGER IF EXISTS trg_organizations_updated_at ON organizations;
CREATE TRIGGER trg_organizations_updated_at
    BEFORE UPDATE ON organizations FOR EACH ROW EXECUTE FUNCTION set_updated_at();

DROP TRIGGER IF EXISTS trg_organizations_soft_delete ON organizations;
CREATE TRIGGER trg_organizations_soft_delete
    BEFORE DELETE ON organizations FOR EACH ROW EXECUTE FUNCTION soft_delete_row();

-- Drop legacy timezone CHECK constraint if it exists on an older deployment.
DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chk_org_timezone') THEN
        ALTER TABLE organizations DROP CONSTRAINT chk_org_timezone;
    END IF;
END;
$$;

-- ============================================================
-- USERS
-- full_name is GENERATED ALWAYS AS STORED — never insert it directly,
-- always derived from first_name + middle_name + last_name.
-- role_id is NOT NULL — every user must have a role before they can log in.
-- is_active = FALSE: suspended (still visible to admins, reversible).
-- is_deleted = TRUE: permanently removed from all queries via RLS (irreversible in normal flow).
-- Both cannot be TRUE simultaneously (enforced by CHECK constraint).
-- ============================================================
CREATE TABLE IF NOT EXISTS users (
    id           UUID     PRIMARY KEY DEFAULT gen_random_uuid(),
    org_id       UUID     NOT NULL REFERENCES organizations(id) ON DELETE RESTRICT,
    first_name   TEXT     NOT NULL,
    middle_name  TEXT,
    last_name    TEXT,
    full_name    TEXT GENERATED ALWAYS AS (
                     TRIM(first_name
                         || COALESCE(' ' || NULLIF(middle_name, ''), '')
                         || COALESCE(' ' || NULLIF(last_name, ''), ''))
                 ) STORED,
    mobile       TEXT,
    email        TEXT     NOT NULL,
    role_id      SMALLINT NOT NULL REFERENCES user_roles(id) ON DELETE RESTRICT,
    -- Self-referential adjacency list: null = top of hierarchy
    manager_id   UUID     REFERENCES users(id) ON DELETE SET NULL,
    password_hash          TEXT,
    password_changed_at    TIMESTAMPTZ NOT NULL DEFAULT CLOCK_TIMESTAMP(),
    force_password_change  BOOLEAN     NOT NULL DEFAULT FALSE,
    is_active    BOOLEAN  NOT NULL DEFAULT TRUE,
    last_login_at TIMESTAMPTZ,
    is_deleted   BOOLEAN  NOT NULL DEFAULT FALSE,
    deleted_at   TIMESTAMPTZ,
    deleted_by   UUID,
    created_by   UUID,
    created_at   TIMESTAMPTZ NOT NULL DEFAULT CLOCK_TIMESTAMP(),
    updated_at   TIMESTAMPTZ NOT NULL DEFAULT CLOCK_TIMESTAMP(),
    CONSTRAINT uq_users_org_email UNIQUE (org_id, email),
    CONSTRAINT chk_users_active_deleted CHECK (NOT (is_active AND is_deleted)),
    CONSTRAINT chk_user_not_own_manager CHECK (manager_id IS NULL OR manager_id <> id)
);

DROP TRIGGER IF EXISTS trg_users_updated_at ON users;
CREATE TRIGGER trg_users_updated_at
    BEFORE UPDATE ON users FOR EACH ROW EXECUTE FUNCTION set_updated_at();

DROP TRIGGER IF EXISTS trg_users_soft_delete ON users;
CREATE TRIGGER trg_users_soft_delete
    BEFORE DELETE ON users FOR EACH ROW EXECUTE FUNCTION soft_delete_row();

DROP TRIGGER IF EXISTS trg_01_users_set_created_by ON users;
CREATE TRIGGER trg_01_users_set_created_by
    BEFORE INSERT ON users FOR EACH ROW EXECUTE FUNCTION set_created_by();

-- Index: finding all direct reports of a manager
CREATE INDEX IF NOT EXISTS idx_users_manager_id
    ON users (org_id, manager_id)
    WHERE manager_id IS NOT NULL AND NOT is_deleted;

-- ============================================================
-- AD_CAMPAIGNS
-- budget is nullable — may not be known at draft time.
-- status_id must be passed explicitly (SELECT id FROM campaign_statuses WHERE name='draft').
-- started_at and ended_at are both optional; if both set, ended_at must follow started_at.
-- ============================================================
CREATE TABLE IF NOT EXISTS ad_campaigns (
    id          UUID     PRIMARY KEY DEFAULT gen_random_uuid(),
    org_id      UUID     NOT NULL REFERENCES organizations(id) ON DELETE RESTRICT,
    name        TEXT     NOT NULL,
    platform_id SMALLINT NOT NULL REFERENCES marketing_platforms(id) ON DELETE RESTRICT,
    status_id   SMALLINT NOT NULL REFERENCES campaign_statuses(id)   ON DELETE RESTRICT,
    budget      NUMERIC(12,2),
    started_at  TIMESTAMPTZ,
    ended_at    TIMESTAMPTZ,
    CONSTRAINT chk_campaign_dates
        CHECK (ended_at IS NULL OR started_at IS NULL OR started_at < ended_at),
    is_deleted  BOOLEAN  NOT NULL DEFAULT FALSE,
    deleted_at  TIMESTAMPTZ,
    deleted_by  UUID,
    created_by  UUID,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT CLOCK_TIMESTAMP(),
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT CLOCK_TIMESTAMP()
);

DROP TRIGGER IF EXISTS trg_ad_campaigns_updated_at ON ad_campaigns;
CREATE TRIGGER trg_ad_campaigns_updated_at
    BEFORE UPDATE ON ad_campaigns FOR EACH ROW EXECUTE FUNCTION set_updated_at();

DROP TRIGGER IF EXISTS trg_ad_campaigns_soft_delete ON ad_campaigns;
CREATE TRIGGER trg_ad_campaigns_soft_delete
    BEFORE DELETE ON ad_campaigns FOR EACH ROW EXECUTE FUNCTION soft_delete_row();

DROP TRIGGER IF EXISTS trg_01_ad_campaigns_set_created_by ON ad_campaigns;
CREATE TRIGGER trg_01_ad_campaigns_set_created_by
    BEFORE INSERT ON ad_campaigns FOR EACH ROW EXECUTE FUNCTION set_created_by();

-- ============================================================
-- MARKETING_LEADS
-- Core CRM entity. full_name is computed — never insert it directly.
-- last_name is nullable to support single-name contacts.
-- stage_id must be passed explicitly (SELECT id FROM lead_stage WHERE name='new').
-- outcome_id must belong to the current stage (enforced by trigger check_lead_stage_outcome).
-- outcome_comment is required when the resolved outcome has requires_comment = TRUE.
-- campaign_id uses ON DELETE SET NULL — deleting a campaign never destroys leads.
-- assigned_user_id uses ON DELETE SET NULL — lead returns to unassigned pool if rep is deleted.
-- embedding column stub: uncomment after pgvector is confirmed; see 05_indexes.sql.
-- ============================================================
CREATE TABLE IF NOT EXISTS marketing_leads (
    id               UUID     PRIMARY KEY DEFAULT gen_random_uuid(),
    org_id           UUID     NOT NULL REFERENCES organizations(id) ON DELETE RESTRICT,
    first_name       TEXT     NOT NULL,
    middle_name      TEXT,
    last_name        TEXT,
    full_name        TEXT GENERATED ALWAYS AS (
                         TRIM(first_name
                             || COALESCE(' ' || NULLIF(middle_name, ''), '')
                             || COALESCE(' ' || NULLIF(last_name,   ''), ''))
                     ) STORED,
    phone            TEXT,
    email            TEXT,
    address_line1    TEXT,
    address_line2    TEXT,
    landmark         TEXT,
    pincode          TEXT,
    city_id          INTEGER  REFERENCES cities(id)    ON DELETE RESTRICT,
    state_id         SMALLINT REFERENCES states(id)    ON DELETE RESTRICT,
    country_id       SMALLINT REFERENCES countries(id) ON DELETE RESTRICT,
    campaign_id      UUID     REFERENCES ad_campaigns(id) ON DELETE SET NULL,
    stage_id         SMALLINT NOT NULL REFERENCES lead_stage(id)         ON DELETE RESTRICT,
    outcome_id       SMALLINT REFERENCES lead_stage_outcome(id)          ON DELETE RESTRICT,
    outcome_comment  TEXT,
    assigned_user_id  UUID     REFERENCES users(id) ON DELETE SET NULL,
    -- Walk-in dedup: points to the first digital (campaign-linked) lead with the
    -- same phone/email in the org. NULL for all non-walk-in leads and walk-ins
    -- that had no prior digital match.
    duplicate_lead_id UUID     REFERENCES marketing_leads(id) ON DELETE SET NULL,
    raw_webhook_data JSONB    NOT NULL DEFAULT '{}',
    metadata         JSONB    NOT NULL DEFAULT '{}',
    tags             TEXT[]   NOT NULL DEFAULT '{}',
    -- embedding vector(1536), -- uncomment after pgvector confirmed; see 05_indexes.sql
    is_deleted       BOOLEAN  NOT NULL DEFAULT FALSE,
    deleted_at       TIMESTAMPTZ,
    deleted_by       UUID,
    created_by       UUID,
    created_at       TIMESTAMPTZ NOT NULL DEFAULT CLOCK_TIMESTAMP(),
    updated_at       TIMESTAMPTZ NOT NULL DEFAULT CLOCK_TIMESTAMP()
);

DROP TRIGGER IF EXISTS trg_marketing_leads_updated_at ON marketing_leads;
CREATE TRIGGER trg_marketing_leads_updated_at
    BEFORE UPDATE ON marketing_leads FOR EACH ROW EXECUTE FUNCTION set_updated_at();

DROP TRIGGER IF EXISTS trg_marketing_leads_soft_delete ON marketing_leads;
CREATE TRIGGER trg_marketing_leads_soft_delete
    BEFORE DELETE ON marketing_leads FOR EACH ROW EXECUTE FUNCTION soft_delete_row();

DROP TRIGGER IF EXISTS trg_01_marketing_leads_set_created_by ON marketing_leads;
CREATE TRIGGER trg_01_marketing_leads_set_created_by
    BEFORE INSERT ON marketing_leads FOR EACH ROW EXECUTE FUNCTION set_created_by();

COMMENT ON COLUMN marketing_leads.duplicate_lead_id IS
    'Set on walk-in leads when an existing campaign-sourced lead with the same phone/email exists. Points to the oldest matching digital lead in the same org.';

-- ============================================================
-- LEAD_INTERACTIONS
-- Append-only log — no updated_at, no update trigger.
-- Interactions are immutable once recorded; only soft-delete is permitted.
-- duration_seconds: populated for call/video_call types; NULL for text-based types.
-- ============================================================
CREATE TABLE IF NOT EXISTS lead_interactions (
    id                  UUID     PRIMARY KEY DEFAULT gen_random_uuid(),
    org_id              UUID     NOT NULL REFERENCES organizations(id)   ON DELETE RESTRICT,
    lead_id             UUID     NOT NULL REFERENCES marketing_leads(id) ON DELETE CASCADE,
    user_id             UUID     NOT NULL REFERENCES users(id)           ON DELETE RESTRICT,
    interaction_type_id SMALLINT NOT NULL REFERENCES interaction_types(id) ON DELETE RESTRICT,
    notes               TEXT,
    duration_seconds    INT,
    occurred_at         TIMESTAMPTZ NOT NULL DEFAULT CLOCK_TIMESTAMP(),
    is_deleted          BOOLEAN  NOT NULL DEFAULT FALSE,
    deleted_at          TIMESTAMPTZ,
    deleted_by          UUID,
    created_by          UUID,
    created_at          TIMESTAMPTZ NOT NULL DEFAULT CLOCK_TIMESTAMP()
);

DROP TRIGGER IF EXISTS trg_lead_interactions_soft_delete ON lead_interactions;
CREATE TRIGGER trg_lead_interactions_soft_delete
    BEFORE DELETE ON lead_interactions FOR EACH ROW EXECUTE FUNCTION soft_delete_row();

DROP TRIGGER IF EXISTS trg_01_lead_interactions_set_created_by ON lead_interactions;
CREATE TRIGGER trg_01_lead_interactions_set_created_by
    BEFORE INSERT ON lead_interactions FOR EACH ROW EXECUTE FUNCTION set_created_by();

-- ============================================================
-- LEAD_FOLLOW_UPS
-- status_id must be passed explicitly (SELECT id FROM follow_up_statuses WHERE name='pending').
-- completed_at must be set when status='completed' and NULL otherwise (enforced by trigger).
-- ============================================================
CREATE TABLE IF NOT EXISTS lead_follow_ups (
    id               UUID     PRIMARY KEY DEFAULT gen_random_uuid(),
    org_id           UUID     NOT NULL REFERENCES organizations(id)   ON DELETE RESTRICT,
    lead_id          UUID     NOT NULL REFERENCES marketing_leads(id) ON DELETE CASCADE,
    assigned_user_id UUID     NOT NULL REFERENCES users(id)           ON DELETE RESTRICT,
    status_id        SMALLINT NOT NULL REFERENCES follow_up_statuses(id) ON DELETE RESTRICT,
    scheduled_at     TIMESTAMPTZ NOT NULL,
    completed_at     TIMESTAMPTZ,
    notes            TEXT,
    is_deleted       BOOLEAN  NOT NULL DEFAULT FALSE,
    deleted_at       TIMESTAMPTZ,
    deleted_by       UUID,
    created_by       UUID,
    created_at       TIMESTAMPTZ NOT NULL DEFAULT CLOCK_TIMESTAMP(),
    updated_at       TIMESTAMPTZ NOT NULL DEFAULT CLOCK_TIMESTAMP()
);

DROP TRIGGER IF EXISTS trg_lead_follow_ups_updated_at ON lead_follow_ups;
CREATE TRIGGER trg_lead_follow_ups_updated_at
    BEFORE UPDATE ON lead_follow_ups FOR EACH ROW EXECUTE FUNCTION set_updated_at();

DROP TRIGGER IF EXISTS trg_lead_follow_ups_soft_delete ON lead_follow_ups;
CREATE TRIGGER trg_lead_follow_ups_soft_delete
    BEFORE DELETE ON lead_follow_ups FOR EACH ROW EXECUTE FUNCTION soft_delete_row();

DROP TRIGGER IF EXISTS trg_01_lead_follow_ups_set_created_by ON lead_follow_ups;
CREATE TRIGGER trg_01_lead_follow_ups_set_created_by
    BEFORE INSERT ON lead_follow_ups FOR EACH ROW EXECUTE FUNCTION set_created_by();


-- ============================================================
-- BUSINESS RULE TRIGGERS
-- ============================================================

-- Enforces outcome_id ↔ stage_id consistency:
--   outcome_id must belong to the current stage_id.
--   On stage change: auto-null outcome_id/outcome_comment when stage has no outcomes
--                    or the supplied outcome doesn't match the new stage.
--   outcome_comment is required when outcome.requires_comment = TRUE.
--   outcome_id IS NULL → outcome_comment forced to NULL.
CREATE OR REPLACE FUNCTION check_lead_stage_outcome()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
DECLARE
    v_outcome_stage_id  SMALLINT;
    v_outcome_count     INT;
    v_requires_comment  BOOLEAN;
BEGIN
    IF TG_OP = 'UPDATE' AND NEW.stage_id IS DISTINCT FROM OLD.stage_id THEN
        -- Stage changed: auto-null outcome when new stage has no outcomes
        SELECT COUNT(*) INTO v_outcome_count
        FROM lead_stage_outcome WHERE stage_id = NEW.stage_id;

        IF v_outcome_count = 0 THEN
            NEW.outcome_id      := NULL;
            NEW.outcome_comment := NULL;
        ELSIF NEW.outcome_id IS NOT NULL THEN
            -- Outcome supplied but doesn't belong to new stage: auto-null
            IF NOT EXISTS (
                SELECT 1 FROM lead_stage_outcome
                WHERE id = NEW.outcome_id AND stage_id = NEW.stage_id
            ) THEN
                NEW.outcome_id      := NULL;
                NEW.outcome_comment := NULL;
            END IF;
        END IF;
    ELSIF NEW.outcome_id IS NOT NULL THEN
        -- INSERT or UPDATE without stage change: validate outcome belongs to stage
        SELECT stage_id INTO v_outcome_stage_id
        FROM lead_stage_outcome WHERE id = NEW.outcome_id;

        IF v_outcome_stage_id IS DISTINCT FROM NEW.stage_id THEN
            RAISE EXCEPTION
                'outcome_id % does not belong to stage_id %. '
                'Cross-stage outcome selection is not allowed.',
                NEW.outcome_id, NEW.stage_id;
        END IF;
    END IF;

    -- Validate requires_comment and force-null comment when outcome is null
    IF NEW.outcome_id IS NOT NULL THEN
        SELECT requires_comment INTO v_requires_comment
        FROM lead_stage_outcome WHERE id = NEW.outcome_id;

        IF v_requires_comment AND (NEW.outcome_comment IS NULL OR NEW.outcome_comment = '') THEN
            RAISE EXCEPTION
                'outcome_comment is required for this outcome (requires_comment = TRUE). '
                'Please provide a comment describing the reason.';
        END IF;
    ELSE
        NEW.outcome_comment := NULL;
    END IF;

    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_lead_stage_outcome_check ON marketing_leads;
CREATE TRIGGER trg_lead_stage_outcome_check
    BEFORE INSERT OR UPDATE OF stage_id, outcome_id, outcome_comment ON marketing_leads
    FOR EACH ROW EXECUTE FUNCTION check_lead_stage_outcome();

-- Enforces completed_at ↔ status='completed' invariant on follow-ups:
--   status='completed' → completed_at MUST be set
--   any other status   → completed_at MUST be NULL
CREATE OR REPLACE FUNCTION check_follow_up_completion()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
DECLARE
    v_status TEXT;
BEGIN
    SELECT name INTO v_status FROM follow_up_statuses WHERE id = NEW.status_id;
    IF v_status = 'completed' AND NEW.completed_at IS NULL THEN
        RAISE EXCEPTION
            'completed_at must be set when follow_up status is ''completed''.';
    END IF;
    IF v_status <> 'completed' AND NEW.completed_at IS NOT NULL THEN
        RAISE EXCEPTION
            'completed_at must be NULL when follow_up status is ''%'' (not ''completed'').',
            v_status;
    END IF;
    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_follow_up_completion_check ON lead_follow_ups;
CREATE TRIGGER trg_follow_up_completion_check
    BEFORE INSERT OR UPDATE OF status_id, completed_at ON lead_follow_ups
    FOR EACH ROW EXECUTE FUNCTION check_follow_up_completion();

-- Ensures campaign_id and assigned_user_id on a lead belong to the same org.
-- Prevents cross-org data leakage at the FK level.
CREATE OR REPLACE FUNCTION check_lead_fk_org_scope()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
    IF NEW.campaign_id IS NOT NULL THEN
        PERFORM 1 FROM ad_campaigns
        WHERE id = NEW.campaign_id AND org_id = NEW.org_id AND NOT is_deleted;
        IF NOT FOUND THEN
            RAISE EXCEPTION
                'campaign_id % does not belong to org % or has been deleted.',
                NEW.campaign_id, NEW.org_id;
        END IF;
    END IF;
    IF NEW.assigned_user_id IS NOT NULL THEN
        PERFORM 1 FROM user_org_access
        WHERE user_id = NEW.assigned_user_id AND org_id = NEW.org_id AND is_active;
        IF NOT FOUND THEN
            RAISE EXCEPTION
                'assigned_user_id % does not have active access to org % or does not exist.',
                NEW.assigned_user_id, NEW.org_id;
        END IF;
    END IF;
    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_marketing_leads_fk_scope ON marketing_leads;
CREATE TRIGGER trg_marketing_leads_fk_scope
    BEFORE INSERT OR UPDATE OF org_id, campaign_id, assigned_user_id ON marketing_leads
    FOR EACH ROW EXECUTE FUNCTION check_lead_fk_org_scope();

-- Ensures the lead and user referenced in an interaction share the same org.
CREATE OR REPLACE FUNCTION check_interaction_fk_org_scope()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
    PERFORM 1 FROM marketing_leads
    WHERE id = NEW.lead_id AND org_id = NEW.org_id AND NOT is_deleted;
    IF NOT FOUND THEN
        RAISE EXCEPTION
            'lead_id % does not belong to org % or has been deleted.', NEW.lead_id, NEW.org_id;
    END IF;
    PERFORM 1 FROM user_org_access
    WHERE user_id = NEW.user_id AND org_id = NEW.org_id AND is_active;
    IF NOT FOUND THEN
        RAISE EXCEPTION
            'user_id % does not have active access to org % or does not exist.', NEW.user_id, NEW.org_id;
    END IF;
    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_lead_interactions_fk_scope ON lead_interactions;
CREATE TRIGGER trg_lead_interactions_fk_scope
    BEFORE INSERT OR UPDATE OF org_id, lead_id, user_id ON lead_interactions
    FOR EACH ROW EXECUTE FUNCTION check_interaction_fk_org_scope();

-- Ensures the lead and assigned user in a follow-up share the same org.
CREATE OR REPLACE FUNCTION check_follow_up_fk_org_scope()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
    PERFORM 1 FROM marketing_leads
    WHERE id = NEW.lead_id AND org_id = NEW.org_id AND NOT is_deleted;
    IF NOT FOUND THEN
        RAISE EXCEPTION
            'lead_id % does not belong to org % or has been deleted.', NEW.lead_id, NEW.org_id;
    END IF;
    PERFORM 1 FROM user_org_access
    WHERE user_id = NEW.assigned_user_id AND org_id = NEW.org_id AND is_active;
    IF NOT FOUND THEN
        RAISE EXCEPTION
            'assigned_user_id % does not have active access to org % or does not exist.',
            NEW.assigned_user_id, NEW.org_id;
    END IF;
    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_lead_follow_ups_fk_scope ON lead_follow_ups;
CREATE TRIGGER trg_lead_follow_ups_fk_scope
    BEFORE INSERT OR UPDATE OF org_id, lead_id, assigned_user_id ON lead_follow_ups
    FOR EACH ROW EXECUTE FUNCTION check_follow_up_fk_org_scope();

-- ============================================================
-- LEAD_STATUS_LOG
-- Immutable record of every lead stage transition. Written by trigger only.
-- old_stage_id is NULL on INSERT (first stage assignment).
-- ON DELETE CASCADE on lead_id: purging a lead removes its stage log.
-- ============================================================
CREATE TABLE IF NOT EXISTS lead_status_log (
    id                  UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    org_id              UUID        NOT NULL REFERENCES organizations(id) ON DELETE RESTRICT,
    lead_id             UUID        NOT NULL REFERENCES marketing_leads(id) ON DELETE CASCADE,
    old_stage_id        SMALLINT    REFERENCES lead_stage(id) ON DELETE RESTRICT,
    new_stage_id        SMALLINT    NOT NULL REFERENCES lead_stage(id) ON DELETE RESTRICT,
    old_outcome_id      SMALLINT    REFERENCES lead_stage_outcome(id) ON DELETE RESTRICT,
    new_outcome_id      SMALLINT    REFERENCES lead_stage_outcome(id) ON DELETE RESTRICT,
    assigned_user_id    UUID        REFERENCES users(id) ON DELETE SET NULL,
    changed_by_id       UUID        REFERENCES users(id) ON DELETE SET NULL,
    transition_note     TEXT,
    changed_at          TIMESTAMPTZ NOT NULL DEFAULT CLOCK_TIMESTAMP()
);

CREATE INDEX IF NOT EXISTS idx_lead_status_log_lead_changed
    ON lead_status_log (org_id, lead_id, changed_at DESC);

CREATE INDEX IF NOT EXISTS idx_lead_status_log_org_changed
    ON lead_status_log (org_id, changed_at DESC);

CREATE INDEX IF NOT EXISTS idx_lead_status_log_changed_by
    ON lead_status_log (org_id, changed_by_id, changed_at DESC);

-- ============================================================
-- MARKETING_LEADS_HISTORY
-- Dedicated audit table for marketing_leads.
-- UPDATE: stores only changed field pairs — {"field": {"old": <v>, "new": <v>}}
-- DELETE: stores full row snapshot via to_jsonb(OLD)
--
-- ON DELETE RESTRICT: prevents purging a lead while its audit history exists.
-- GDPR erasure workflow: anonymise PII in this table first, then delete the lead.
-- changed_by_user_id ON DELETE SET NULL: audit record survives user deletion.
-- ============================================================
CREATE TABLE IF NOT EXISTS marketing_leads_history (
    id                 UUID    PRIMARY KEY DEFAULT gen_random_uuid(),
    lead_id            UUID    NOT NULL REFERENCES marketing_leads(id) ON DELETE RESTRICT,
    changed_by_user_id UUID    REFERENCES users(id) ON DELETE SET NULL,
    operation          CHAR(1) NOT NULL CHECK (operation IN ('U', 'D')),
    changed_at         TIMESTAMPTZ NOT NULL DEFAULT CLOCK_TIMESTAMP(),
    changed_fields     JSONB   NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_marketing_leads_history_lead_changed
    ON marketing_leads_history (lead_id, changed_at DESC);

-- ============================================================
-- AUDIT_LOG
-- Generic audit table for all operational tables except marketing_leads
-- (which has its own dedicated history table above).
--
-- To audit a new table, attach the trigger in 06_audit_triggers.sql:
--   DROP TRIGGER IF EXISTS trg_<table>_audit ON <table>;
--   CREATE TRIGGER trg_<table>_audit
--       AFTER UPDATE OR DELETE ON <table>
--       FOR EACH ROW EXECUTE FUNCTION audit_row_changes();
--
-- Diff format for UPDATE: {"field": {"old": <v>, "new": <v>}, ...}
-- Snapshot format for DELETE: full to_jsonb(OLD) row
-- ============================================================
CREATE TABLE IF NOT EXISTS audit_log (
    id             UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    table_name     TEXT        NOT NULL,
    record_id      UUID        NOT NULL,
    org_id         UUID,                   -- denormalized for RLS; NULL for non-org tables
    operation      CHAR(1)     NOT NULL CHECK (operation IN ('U', 'D')),
    changed_at     TIMESTAMPTZ NOT NULL DEFAULT CLOCK_TIMESTAMP(),
    changed_by     UUID,                   -- no FK: preserves history after user deletion
    changed_fields JSONB       NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_audit_log_table_record
    ON audit_log (table_name, record_id, changed_at DESC);

CREATE INDEX IF NOT EXISTS idx_audit_log_org_table
    ON audit_log (org_id, table_name, changed_at DESC)
    WHERE org_id IS NOT NULL;

COMMIT;
