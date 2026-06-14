BEGIN;

-- All partial indexes use WHERE NOT is_deleted to stay small and cache-hot.
-- Non-partial companion indexes (suffix _full) exist solely for FK CASCADE DELETE
-- by service_role, which scans by FK column without knowing org_id.

-- ============================================================
-- MARKETING_LEADS
-- ============================================================

-- Stage-filtered paginated lead list: WHERE org_id=$1 AND stage_id=$2 AND NOT is_deleted ORDER BY created_at DESC
CREATE INDEX IF NOT EXISTS idx_marketing_leads_org_stage_created
    ON marketing_leads (org_id, stage_id, created_at DESC)
    WHERE NOT is_deleted;

-- Reject-reason analytics: WHERE org_id=$1 AND outcome_id IS NOT NULL AND NOT is_deleted
CREATE INDEX IF NOT EXISTS idx_marketing_leads_org_outcome
    ON marketing_leads (org_id, outcome_id)
    WHERE outcome_id IS NOT NULL AND NOT is_deleted;

-- All-status paginated lead list: WHERE org_id=$1 AND NOT is_deleted ORDER BY created_at DESC
CREATE INDEX IF NOT EXISTS idx_marketing_leads_org_created
    ON marketing_leads (org_id, created_at DESC)
    WHERE NOT is_deleted;

-- Sales rep "my leads": WHERE org_id=$1 AND assigned_user_id=$2 AND NOT is_deleted
CREATE INDEX IF NOT EXISTS idx_marketing_leads_org_assigned_user
    ON marketing_leads (org_id, assigned_user_id, created_at DESC)
    WHERE NOT is_deleted;

-- Campaign attribution: WHERE org_id=$1 AND campaign_id=$2 AND NOT is_deleted
CREATE INDEX IF NOT EXISTS idx_marketing_leads_org_campaign
    ON marketing_leads (org_id, campaign_id)
    WHERE campaign_id IS NOT NULL AND NOT is_deleted;

-- Phone deduplication check before inserting a new lead
CREATE INDEX IF NOT EXISTS idx_marketing_leads_org_phone
    ON marketing_leads (org_id, phone)
    WHERE phone IS NOT NULL AND NOT is_deleted;

-- Email deduplication check before inserting a new lead
CREATE INDEX IF NOT EXISTS idx_marketing_leads_org_email
    ON marketing_leads (org_id, email)
    WHERE email IS NOT NULL AND NOT is_deleted;

-- Full-name fuzzy search: WHERE full_name ILIKE '%sharma%'
-- GENERATED ALWAYS AS STORED columns are indexable like regular columns.
CREATE INDEX IF NOT EXISTS idx_marketing_leads_fullname_trgm
    ON marketing_leads USING GIN (full_name gin_trgm_ops)
    WHERE NOT is_deleted;

-- Webhook JSONB containment: WHERE raw_webhook_data @> '{"form_id":"..."}'
-- jsonb_path_ops is 2-3× faster and 30-40% smaller than default jsonb_ops for @>
-- Trade-off: does NOT support ? (key-exists) operators — acceptable here.
CREATE INDEX IF NOT EXISTS idx_marketing_leads_webhook_gin
    ON marketing_leads USING GIN (raw_webhook_data jsonb_path_ops);

-- Metadata JSONB containment: WHERE metadata @> '{"goal":"weight_loss"}'
CREATE INDEX IF NOT EXISTS idx_marketing_leads_metadata_gin
    ON marketing_leads USING GIN (metadata jsonb_path_ops);

-- Tags array: WHERE tags @> ARRAY['high_value'] or WHERE tags && ARRAY['vip','trial']
CREATE INDEX IF NOT EXISTS idx_marketing_leads_tags_gin
    ON marketing_leads USING GIN (tags);

-- ============================================================
-- LEAD_INTERACTIONS
-- ============================================================

-- Chronological interaction log per lead: WHERE org_id=$1 AND lead_id=$2 AND NOT is_deleted ORDER BY occurred_at DESC
CREATE INDEX IF NOT EXISTS idx_lead_interactions_org_lead_occurred
    ON lead_interactions (org_id, lead_id, occurred_at DESC)
    WHERE NOT is_deleted;

-- Trigger-context and FK constraint lookups by lead_id alone (no org_id prefix)
CREATE INDEX IF NOT EXISTS idx_lead_interactions_lead_id
    ON lead_interactions (lead_id)
    WHERE NOT is_deleted;

CREATE INDEX IF NOT EXISTS idx_lead_interactions_lead_id_full
    ON lead_interactions (lead_id);

-- ============================================================
-- LEAD_FOLLOW_UPS
-- ============================================================

-- Deadline scanning: WHERE org_id=$1 AND assigned_user_id=$2 AND status_id IN (pending,missed) ORDER BY scheduled_at ASC
CREATE INDEX IF NOT EXISTS idx_lead_follow_ups_org_user_scheduled
    ON lead_follow_ups (org_id, assigned_user_id, scheduled_at ASC, status_id)
    WHERE NOT is_deleted;

-- Trigger-context and FK constraint lookups by lead_id alone
CREATE INDEX IF NOT EXISTS idx_lead_follow_ups_lead_id
    ON lead_follow_ups (lead_id)
    WHERE NOT is_deleted;

CREATE INDEX IF NOT EXISTS idx_lead_follow_ups_lead_id_full
    ON lead_follow_ups (lead_id);

-- ============================================================
-- AD_CAMPAIGNS
-- ============================================================

-- Campaign list by platform: WHERE org_id=$1 AND platform_id=$2 AND NOT is_deleted
CREATE INDEX IF NOT EXISTS idx_ad_campaigns_org_platform
    ON ad_campaigns (org_id, platform_id)
    WHERE NOT is_deleted;

-- Active campaigns dropdown (common query): WHERE org_id=$1 AND status_id=<active> AND NOT is_deleted
-- The integer literal 2 corresponds to 'active' per 02_lookup_tables.sql seed order.
-- A DO block below warns at deploy time if the seed order has shifted.
DO $$
DECLARE v_active_id SMALLINT;
BEGIN
    SELECT id INTO v_active_id FROM campaign_statuses WHERE name = 'active';
    IF v_active_id IS NULL THEN
        RAISE WARNING 'idx_ad_campaigns_org_active: "active" row not found in campaign_statuses. Run 02_lookup_tables.sql first.';
    ELSIF v_active_id <> 2 THEN
        RAISE WARNING 'idx_ad_campaigns_org_active: expected status_id=2 for "active", got %. Drop and recreate the index with WHERE status_id = %.',
            v_active_id, v_active_id;
    END IF;
END;
$$;

CREATE INDEX IF NOT EXISTS idx_ad_campaigns_org_active
    ON ad_campaigns (org_id)
    WHERE status_id = 2 AND NOT is_deleted;

-- ============================================================
-- ORGANIZATIONS
-- ============================================================

-- Tenant dashboard and tenant-scoped RLS subquery: WHERE tenant_id=$1 AND NOT is_deleted
CREATE INDEX IF NOT EXISTS idx_organizations_tenant_id
    ON organizations (tenant_id)
    WHERE NOT is_deleted;

-- ============================================================
-- USERS
-- ============================================================

-- Role-filtered user list (e.g. assignment dropdowns): WHERE org_id=$1 AND role_id=$2 AND NOT is_deleted
CREATE INDEX IF NOT EXISTS idx_users_org_role
    ON users (org_id, role_id)
    WHERE NOT is_deleted;

-- Login resolution and within-org email deduplication
CREATE INDEX IF NOT EXISTS idx_users_org_email
    ON users (org_id, email)
    WHERE NOT is_deleted;

-- Fuzzy email search: WHERE email ILIKE '%@velvet%'
CREATE INDEX IF NOT EXISTS idx_users_email_trgm
    ON users USING GIN (email gin_trgm_ops)
    WHERE NOT is_deleted;

-- ============================================================
-- VECTOR SIMILARITY (stub — activate after pgvector confirmed)
-- Steps: 1) ensure pgvector extension loaded (00_extensions.sql)
--        2) uncomment embedding column in 03_core_tables.sql
--        3) uncomment this index once the table has >10K rows
-- lists=100 is tuned for ~1M rows; use SQRT(row_count) as a guideline.
-- ============================================================
-- CREATE INDEX IF NOT EXISTS idx_marketing_leads_embedding_ivfflat
--     ON marketing_leads USING ivfflat (embedding vector_cosine_ops) WITH (lists = 100);

COMMIT;
