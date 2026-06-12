BEGIN;

-- ── RLS: MARKETING_LEADS_HISTORY ─────────────────────────────
-- Trigger INSERT (from audit function) is unaffected because the audit function
-- runs as the table owner (SECURITY DEFINER), and there is no USING check on INSERT.
-- tenant_admin sees history for all leads under their tenant.
ALTER TABLE marketing_leads_history ENABLE ROW LEVEL SECURITY;
ALTER TABLE marketing_leads_history FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS history_org_isolation    ON marketing_leads_history;
DROP POLICY IF EXISTS history_tenant_isolation ON marketing_leads_history;

CREATE POLICY history_org_isolation ON marketing_leads_history
    AS PERMISSIVE FOR SELECT TO app_user
    USING (
        EXISTS (
            SELECT 1 FROM marketing_leads ml
            WHERE ml.id = marketing_leads_history.lead_id
              AND ml.org_id = NULLIF(current_setting('app.current_org_id', true), '')::uuid
        )
    );

CREATE POLICY history_tenant_isolation ON marketing_leads_history
    AS PERMISSIVE FOR SELECT TO tenant_admin
    USING (
        EXISTS (
            SELECT 1 FROM marketing_leads ml
            JOIN organizations o ON o.id = ml.org_id
            WHERE ml.id = marketing_leads_history.lead_id
              AND o.tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid
        )
    );

-- ============================================================
-- AUDIT TRIGGER — marketing_leads
-- SECURITY DEFINER: runs as the function owner so app_user (which has
-- no INSERT on marketing_leads_history) can still trigger audit writes.
--
-- System columns excluded from the diff (updated_at, created_at, id,
-- deleted_at, deleted_by, created_by) — these are infrastructure fields.
-- is_deleted IS included: transitioning a lead to soft-deleted is a
-- business event and must be logged.
-- ============================================================
CREATE OR REPLACE FUNCTION audit_marketing_leads_changes()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
    k_skip_columns CONSTANT TEXT[] := ARRAY[
        'updated_at', 'created_at', 'id',
        'deleted_at', 'deleted_by'
    ];
    v_diff       JSONB := '{}';
    v_old_json   JSONB;
    v_new_json   JSONB;
    v_key        TEXT;
    v_old_val    JSONB;
    v_new_val    JSONB;
    v_changed_by UUID;
BEGIN
    BEGIN
        v_changed_by := NULLIF(current_setting('app.current_user_id', true), '')::uuid;
    EXCEPTION WHEN OTHERS THEN
        v_changed_by := NULL;
    END;

    IF TG_OP = 'UPDATE' THEN
        v_old_json := to_jsonb(OLD);
        v_new_json := to_jsonb(NEW);

        FOR v_key, v_new_val IN
            SELECT key, value FROM jsonb_each(v_new_json)
        LOOP
            CONTINUE WHEN v_key = ANY(k_skip_columns);
            v_old_val := v_old_json -> v_key;
            IF v_new_val IS DISTINCT FROM v_old_val THEN
                v_diff := v_diff || jsonb_build_object(
                    v_key,
                    jsonb_build_object('old', v_old_val, 'new', v_new_val)
                );
            END IF;
        END LOOP;

        IF v_diff = '{}'::jsonb THEN
            RETURN NEW;
        END IF;

        INSERT INTO marketing_leads_history
            (lead_id, changed_by_user_id, operation, changed_fields)
        VALUES
            (NEW.id, v_changed_by, 'U', v_diff);

        RETURN NEW;

    ELSIF TG_OP = 'DELETE' THEN
        INSERT INTO marketing_leads_history
            (lead_id, changed_by_user_id, operation, changed_fields)
        VALUES
            (OLD.id, v_changed_by, 'D', to_jsonb(OLD));

        RETURN OLD;
    END IF;

    RETURN NULL;
END;
$$;

-- Soft deletes are captured here because soft_delete_row() converts
-- DELETE → UPDATE SET is_deleted=TRUE, which this AFTER UPDATE trigger catches.
DROP TRIGGER IF EXISTS trg_marketing_leads_audit ON marketing_leads;
CREATE TRIGGER trg_marketing_leads_audit
    AFTER UPDATE OR DELETE ON marketing_leads
    FOR EACH ROW EXECUTE FUNCTION audit_marketing_leads_changes();

-- ── RLS: AUDIT_LOG ───────────────────────────────────────────
ALTER TABLE audit_log ENABLE ROW LEVEL SECURITY;
ALTER TABLE audit_log FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS org_isolation_policy    ON audit_log;
DROP POLICY IF EXISTS tenant_isolation_policy ON audit_log;

CREATE POLICY org_isolation_policy ON audit_log
    AS PERMISSIVE FOR SELECT TO app_user
    USING (org_id = NULLIF(current_setting('app.current_org_id', true), '')::uuid);

CREATE POLICY tenant_isolation_policy ON audit_log
    AS PERMISSIVE FOR SELECT TO tenant_admin
    USING (
        org_id IN (
            SELECT id FROM organizations
            WHERE tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid
              AND NOT is_deleted
        )
    );

-- ============================================================
-- GENERIC AUDIT TRIGGER FUNCTION
-- SECURITY DEFINER: runs as the function owner so app_user can trigger
-- audit writes without holding INSERT on audit_log directly.
-- ============================================================
CREATE OR REPLACE FUNCTION audit_row_changes()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
    k_skip_columns CONSTANT TEXT[] := ARRAY[
        'updated_at', 'created_at', 'id', 'deleted_at', 'deleted_by', 'created_by'
    ];
    v_diff       JSONB := '{}';
    v_old_json   JSONB;
    v_new_json   JSONB;
    v_key        TEXT;
    v_old_val    JSONB;
    v_new_val    JSONB;
    v_changed_by UUID;
    v_record_id  UUID;
    v_org_id     UUID;
BEGIN
    BEGIN
        v_changed_by := NULLIF(current_setting('app.current_user_id', true), '')::uuid;
    EXCEPTION WHEN OTHERS THEN v_changed_by := NULL; END;

    IF TG_OP = 'UPDATE' THEN
        v_old_json := to_jsonb(OLD);
        v_new_json := to_jsonb(NEW);

        FOR v_key, v_new_val IN SELECT key, value FROM jsonb_each(v_new_json) LOOP
            CONTINUE WHEN v_key = ANY(k_skip_columns);
            v_old_val := v_old_json -> v_key;
            IF v_new_val IS DISTINCT FROM v_old_val THEN
                v_diff := v_diff || jsonb_build_object(
                    v_key, jsonb_build_object('old', v_old_val, 'new', v_new_val)
                );
            END IF;
        END LOOP;

        IF v_diff = '{}'::jsonb THEN RETURN NEW; END IF;

        v_record_id := (v_new_json ->> 'id')::uuid;
        v_org_id    := NULLIF(v_new_json ->> 'org_id', '')::uuid;

        INSERT INTO audit_log (table_name, record_id, org_id, operation, changed_by, changed_fields)
        VALUES (TG_TABLE_NAME, v_record_id, v_org_id, 'U', v_changed_by, v_diff);

        RETURN NEW;

    ELSIF TG_OP = 'DELETE' THEN
        v_old_json  := to_jsonb(OLD);
        v_record_id := (v_old_json ->> 'id')::uuid;
        v_org_id    := NULLIF(v_old_json ->> 'org_id', '')::uuid;

        INSERT INTO audit_log (table_name, record_id, org_id, operation, changed_by, changed_fields)
        VALUES (TG_TABLE_NAME, v_record_id, v_org_id, 'D', v_changed_by, to_jsonb(OLD));

        RETURN OLD;
    END IF;

    RETURN NULL;
END;
$$;

DROP TRIGGER IF EXISTS trg_users_audit ON users;
CREATE TRIGGER trg_users_audit
    AFTER UPDATE OR DELETE ON users
    FOR EACH ROW EXECUTE FUNCTION audit_row_changes();

DROP TRIGGER IF EXISTS trg_ad_campaigns_audit ON ad_campaigns;
CREATE TRIGGER trg_ad_campaigns_audit
    AFTER UPDATE OR DELETE ON ad_campaigns
    FOR EACH ROW EXECUTE FUNCTION audit_row_changes();

-- lead_interactions has no update trigger (immutable), but soft-deletes fire as UPDATE.
DROP TRIGGER IF EXISTS trg_lead_interactions_audit ON lead_interactions;
CREATE TRIGGER trg_lead_interactions_audit
    AFTER UPDATE OR DELETE ON lead_interactions
    FOR EACH ROW EXECUTE FUNCTION audit_row_changes();

DROP TRIGGER IF EXISTS trg_lead_follow_ups_audit ON lead_follow_ups;
CREATE TRIGGER trg_lead_follow_ups_audit
    AFTER UPDATE OR DELETE ON lead_follow_ups
    FOR EACH ROW EXECUTE FUNCTION audit_row_changes();

-- ============================================================
-- LEAD STATUS TRANSITION TRIGGER
-- SECURITY DEFINER: app_user has no INSERT on lead_status_log.
-- Fires on INSERT (first status assignment) and UPDATE of
-- status_id or fail_reason_id only.
-- transition_note is read from app.lead_transition_note session
-- variable set by the API before the DML.
-- ============================================================
CREATE OR REPLACE FUNCTION log_lead_status_change()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
    v_changed_by UUID;
    v_note       TEXT;
BEGIN
    IF TG_OP = 'UPDATE' THEN
        IF NEW.status_id IS NOT DISTINCT FROM OLD.status_id
           AND NEW.fail_reason_id IS NOT DISTINCT FROM OLD.fail_reason_id THEN
            RETURN NEW;
        END IF;
    END IF;

    BEGIN
        v_changed_by := NULLIF(current_setting('app.current_user_id', true), '')::uuid;
    EXCEPTION WHEN OTHERS THEN v_changed_by := NULL; END;

    BEGIN
        v_note := NULLIF(current_setting('app.lead_transition_note', true), '');
    EXCEPTION WHEN OTHERS THEN v_note := NULL; END;

    INSERT INTO lead_status_log (
        org_id, lead_id,
        old_status_id, new_status_id,
        old_fail_reason_id, new_fail_reason_id,
        assigned_user_id, changed_by_id,
        transition_note
    ) VALUES (
        NEW.org_id, NEW.id,
        CASE WHEN TG_OP = 'INSERT' THEN NULL ELSE OLD.status_id END,
        NEW.status_id,
        CASE WHEN TG_OP = 'INSERT' THEN NULL ELSE OLD.fail_reason_id END,
        NEW.fail_reason_id,
        NEW.assigned_user_id,
        v_changed_by,
        v_note
    );

    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_lead_status_log ON marketing_leads;
CREATE TRIGGER trg_lead_status_log
    AFTER INSERT OR UPDATE OF status_id, fail_reason_id ON marketing_leads
    FOR EACH ROW EXECUTE FUNCTION log_lead_status_change();

COMMIT;
