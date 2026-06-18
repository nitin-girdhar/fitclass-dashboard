BEGIN;

-- ============================================================
-- VW_DASHBOARD_LEADS
-- Primary lead list for the single-org CRM dashboard.
-- RLS on marketing_leads enforces org isolation for app_user.
-- tenant_admin sees all leads across their tenant (tenant RLS policy).
-- Includes full structured name + city for the contact card.
-- Soft-deleted leads are invisible (RLS USING NOT is_deleted).
-- ============================================================
CREATE OR REPLACE VIEW vw_dashboard_leads WITH (security_invoker = true) AS
SELECT
    ml.id                       AS lead_id,
    ml.org_id,
    o.name                      AS org_name,
    -- Structured name (computed column carries the concatenation)
    ml.first_name,
    ml.middle_name,
    ml.last_name,
    ml.full_name,               -- GENERATED ALWAYS AS — always consistent
    ml.phone,
    ml.email,
    -- Address context
    ml.address_line1,
    ci.name                     AS city,
    st.name                     AS state,
    co.name                     AS country,
    -- CRM state
    ls.name                     AS stage,
    ls.label                    AS stage_label,
    ls.followup_required,
    ls.is_rejected,
    ls.is_terminated,
    lso.name                    AS outcome,
    lso.label                   AS outcome_label,
    ml.outcome_comment,
    ml.stage_id,
    ml.outcome_id,
    ac.name                     AS campaign_name,     -- NULL for organic leads
    mp.label                    AS platform,          -- NULL for organic leads
    u.full_name                 AS assigned_rep_name,
    u.email                     AS assigned_rep_email,
    ml.tags,
    ml.metadata,
    ml.created_at,
    ml.updated_at,
    -- Exposed for programmatic filtering (RLS handles is_deleted for app_user;
    -- service-role queries must filter explicitly)
    ml.is_deleted,
    ml.assigned_user_id,
    ml.campaign_id
FROM  marketing_leads        ml
JOIN  organizations           o   ON o.id    = ml.org_id
JOIN  lead_stage              ls  ON ls.id   = ml.stage_id
LEFT JOIN lead_stage_outcome  lso ON lso.id  = ml.outcome_id
LEFT JOIN ad_campaigns        ac  ON ac.id   = ml.campaign_id
LEFT JOIN marketing_platforms mp  ON mp.id   = ac.platform_id
LEFT JOIN users               u   ON u.id    = ml.assigned_user_id
LEFT JOIN cities              ci  ON ci.id   = ml.city_id
LEFT JOIN states              st  ON st.id   = ml.state_id
LEFT JOIN countries           co  ON co.id   = ml.country_id;

-- ============================================================
-- VW_SALES_FOLLOW_UP_PIPELINE
-- Sales rep's actionable task queue — pending + missed only.
-- Ordered by urgency (soonest scheduled_at first).
-- Soft-deleted follow-ups are invisible via RLS.
-- ============================================================
CREATE OR REPLACE VIEW vw_sales_follow_up_pipeline WITH (security_invoker = true) AS
SELECT
    lf.id                       AS follow_up_id,
    lf.org_id,
    o.name                      AS org_name,
    ml.full_name                AS lead_full_name,
    ml.phone                    AS lead_phone,
    ml.email                    AS lead_email,
    u.full_name                 AS assigned_rep_name,
    u.email                     AS assigned_rep_email,
    fs.name                     AS status,
    lf.scheduled_at,
    lf.completed_at,
    lf.notes
FROM  lead_follow_ups        lf
JOIN  marketing_leads         ml ON ml.id  = lf.lead_id
JOIN  users                   u  ON u.id   = lf.assigned_user_id
JOIN  follow_up_statuses      fs ON fs.id  = lf.status_id
JOIN  organizations           o  ON o.id   = lf.org_id
-- ORDER BY belongs in the caller's query, not here.
WHERE fs.name IN ('pending', 'missed');

-- ============================================================
-- VW_TENANT_CAMPAIGN_SUMMARY
-- Cross-org campaign performance view for tenant-admin reporting.
--
-- PERMISSION MODEL:
--   Query as tenant_admin role (not app_user). The tenant_admin RLS
--   policy on ad_campaigns restricts to orgs under app.current_tenant_id,
--   so this view automatically scopes to the correct tenant without
--   needing an explicit WHERE clause on tenant_id in the view itself.
--
-- USAGE:
--   -- In Node.js tenant-admin pool:
--   SET LOCAL app.current_tenant_id = '<tenant_uuid>';
--   SET LOCAL app.current_user_id   = '<admin_user_uuid>';
--   SELECT * FROM vw_tenant_campaign_summary;
--
-- If queried as app_user, results are restricted to the current org only
-- (the app_user RLS policy on ad_campaigns applies). This is correct
-- single-org behaviour and not an error.
-- ============================================================
CREATE OR REPLACE VIEW vw_tenant_campaign_summary WITH (security_invoker = true) AS
WITH campaign_lead_stats AS (
    SELECT
        sub.campaign_id,
        SUM(sub.stage_cnt)::INT                                             AS total_leads,
        COALESCE(
            SUM(sub.stage_cnt) FILTER (WHERE ls.name = 'converted'), 0
        )::INT                                                              AS converted_leads,
        jsonb_object_agg(ls.name, sub.stage_cnt)                           AS leads_by_stage
    FROM (
        SELECT campaign_id, stage_id, COUNT(*) AS stage_cnt
        FROM   marketing_leads
        WHERE  campaign_id IS NOT NULL
          AND  NOT is_deleted
        GROUP  BY campaign_id, stage_id
    ) sub
    JOIN lead_stage ls ON ls.id = sub.stage_id
    GROUP BY sub.campaign_id
)
SELECT
    o.tenant_id,
    ac.org_id,
    o.name                                                                  AS org_name,
    ac.id                                                                   AS campaign_id,
    ac.name                                                                 AS campaign_name,
    mp.label                                                                AS platform,
    cs.name                                                                 AS campaign_status,
    ac.budget,
    COALESCE(cls.total_leads, 0)::INT                                       AS total_leads,
    COALESCE(cls.leads_by_stage, '{}'::jsonb)                               AS leads_by_stage,
    CASE
        WHEN COALESCE(cls.total_leads, 0) = 0 THEN 0::NUMERIC(5,2)
        ELSE ROUND(
            COALESCE(cls.converted_leads, 0)::NUMERIC
            / cls.total_leads::NUMERIC * 100, 2
        )
    END                                                                     AS conversion_rate
FROM  ad_campaigns          ac
JOIN  organizations          o   ON o.id   = ac.org_id
JOIN  marketing_platforms    mp  ON mp.id  = ac.platform_id
JOIN  campaign_statuses      cs  ON cs.id  = ac.status_id
LEFT JOIN campaign_lead_stats cls ON cls.campaign_id = ac.id
WHERE NOT ac.is_deleted;

-- ============================================================
-- VW_TENANT_FULL_DASHBOARD  (NEW — answers the tenant dashboard question)
-- Aggregates key KPIs for every org under the authenticated tenant
-- in a single query. Intended exclusively for tenant_admin role.
--
-- PERMISSION MODEL:
--   Connect as tenant_admin, then:
--     SET LOCAL app.current_tenant_id = '<tenant_uuid>';
--   The tenant_admin RLS policies on marketing_leads, lead_interactions,
--   and lead_follow_ups scope every underlying table to the tenant's orgs.
--   organizations and tenants have no RLS — readable by all roles.
--
-- What this enables:
--   - "How is each gym / boutique location performing vs the others?"
--   - "Which org has the most missed follow-ups?"
--   - "What is my chain-wide conversion rate?"
-- ============================================================
CREATE OR REPLACE VIEW vw_tenant_full_dashboard WITH (security_invoker = true) AS
WITH org_leads AS (
    SELECT
        ml.org_id,
        COUNT(*)                                               AS total_leads,
        COUNT(*) FILTER (WHERE ls.name = 'new')               AS new_leads,
        COUNT(*) FILTER (WHERE ls.name = 'contacting')        AS contacting_leads,
        COUNT(*) FILTER (WHERE ls.name = 'qualified')         AS qualified_leads,
        COUNT(*) FILTER (WHERE ls.name = 'converted')         AS converted_leads,
        COUNT(*) FILTER (WHERE ls.name = 'unqualified')       AS unqualified_leads,
        COUNT(*) FILTER (WHERE ls.name = 'transferred_out')   AS transferred_out_leads
    FROM marketing_leads ml
    JOIN lead_stage      ls ON ls.id = ml.stage_id
    WHERE NOT ml.is_deleted
    GROUP BY ml.org_id
),
org_interactions AS (
    SELECT
        li.org_id,
        COUNT(*)                           AS total_interactions,
        COUNT(DISTINCT li.lead_id)         AS leads_touched
    FROM lead_interactions li
    WHERE NOT li.is_deleted
    GROUP BY li.org_id
),
org_follow_ups AS (
    SELECT
        lf.org_id,
        COUNT(*) FILTER (WHERE fs.name = 'pending')     AS pending_follow_ups,
        COUNT(*) FILTER (WHERE fs.name = 'missed')      AS missed_follow_ups,
        COUNT(*) FILTER (WHERE fs.name = 'completed')   AS completed_follow_ups
    FROM  lead_follow_ups    lf
    JOIN  follow_up_statuses fs ON fs.id = lf.status_id
    WHERE NOT lf.is_deleted
    GROUP BY lf.org_id
),
org_platform AS (
    -- Most-lead-generating platform per org
    SELECT org_id, most_used_platform FROM (
        SELECT
            ac.org_id,
            mp.label                                        AS most_used_platform,
            COUNT(ml.id)                                    AS lead_count,
            ROW_NUMBER() OVER (
                PARTITION BY ac.org_id
                ORDER BY COUNT(ml.id) DESC
            )                                               AS rn
        FROM  ad_campaigns       ac
        JOIN  marketing_platforms mp ON mp.id = ac.platform_id
        LEFT JOIN marketing_leads ml ON ml.campaign_id = ac.id AND NOT ml.is_deleted
        WHERE NOT ac.is_deleted
        GROUP BY ac.org_id, mp.label
    ) ranked WHERE rn = 1
)
SELECT
    o.tenant_id,
    t.name                                                  AS tenant_name,
    o.id                                                    AS org_id,
    o.name                                                  AS org_name,
    ot.name                                                 AS org_type,
    -- Address
    o.address_line1,
    ci.name                                                 AS city,
    st.name                                                 AS state,
    -- Lead funnel (on_hold_leads and nurturing_leads removed — no equivalent stages)
    COALESCE(ol.total_leads,           0)::INT              AS total_leads,
    COALESCE(ol.new_leads,             0)::INT              AS new_leads,
    COALESCE(ol.contacting_leads,      0)::INT              AS contacting_leads,
    COALESCE(ol.qualified_leads,       0)::INT              AS qualified_leads,
    COALESCE(ol.converted_leads,       0)::INT              AS converted_leads,
    COALESCE(ol.unqualified_leads,     0)::INT              AS unqualified_leads,
    COALESCE(ol.transferred_out_leads, 0)::INT              AS transferred_out_leads,
    -- Conversion rate
    CASE
        WHEN COALESCE(ol.total_leads, 0) = 0 THEN 0::NUMERIC(5,2)
        ELSE ROUND(ol.converted_leads::NUMERIC / ol.total_leads * 100, 2)
    END                                                     AS conversion_rate_pct,
    -- Interaction depth
    CASE
        WHEN COALESCE(oi.leads_touched, 0) = 0 THEN 0::NUMERIC(5,2)
        ELSE ROUND(oi.total_interactions::NUMERIC / oi.leads_touched, 2)
    END                                                     AS avg_interactions_per_lead,
    -- Follow-up hygiene
    COALESCE(ofu.pending_follow_ups,   0)::INT              AS pending_follow_ups,
    COALESCE(ofu.missed_follow_ups,    0)::INT              AS missed_follow_ups,
    COALESCE(ofu.completed_follow_ups, 0)::INT              AS completed_follow_ups,
    -- Top channel
    op.most_used_platform,
    CLOCK_TIMESTAMP()                                       AS snapshot_at
FROM  organizations     o
JOIN  tenants           t   ON t.id   = o.tenant_id
JOIN  org_types         ot  ON ot.id  = o.org_type_id
LEFT JOIN cities        ci  ON ci.id  = o.city_id
LEFT JOIN states        st  ON st.id  = o.state_id
LEFT JOIN org_leads     ol  ON ol.org_id  = o.id
LEFT JOIN org_interactions oi ON oi.org_id = o.id
LEFT JOIN org_follow_ups ofu ON ofu.org_id = o.id
LEFT JOIN org_platform   op  ON op.org_id  = o.id
WHERE NOT o.is_deleted
  AND NOT t.is_deleted;

-- ============================================================
-- VW_ORG_PERFORMANCE_SNAPSHOT
-- Per-org aggregate for AI/ML pipelines and analytics services.
-- When queried as app_user: scoped to current org via RLS.
-- When queried as tenant_admin: all orgs under the tenant.
-- When queried as service_role: all orgs in the database.
-- ============================================================
CREATE OR REPLACE VIEW vw_org_performance_snapshot WITH (security_invoker = true) AS
WITH lead_counts AS (
    SELECT
        ml.org_id,
        COUNT(*)                                               AS total_leads,
        COUNT(*) FILTER (WHERE ls.name = 'converted')         AS converted_leads,
        COUNT(*) FILTER (WHERE ls.name = 'unqualified')       AS unqualified_leads
    FROM  marketing_leads ml
    JOIN  lead_stage      ls ON ls.id = ml.stage_id
    WHERE NOT ml.is_deleted
    GROUP BY ml.org_id
),
interaction_stats AS (
    SELECT
        li.org_id,
        COUNT(*)                    AS total_interactions,
        COUNT(DISTINCT li.lead_id)  AS leads_with_interactions
    FROM lead_interactions li
    WHERE NOT li.is_deleted
    GROUP BY li.org_id
),
follow_up_counts AS (
    SELECT
        lf.org_id,
        COUNT(*) FILTER (WHERE fs.name = 'pending') AS pending_follow_ups,
        COUNT(*) FILTER (WHERE fs.name = 'missed')  AS missed_follow_ups
    FROM  lead_follow_ups    lf
    JOIN  follow_up_statuses fs ON fs.id = lf.status_id
    WHERE NOT lf.is_deleted
    GROUP BY lf.org_id
),
platform_usage AS (
    SELECT org_id, most_used_platform FROM (
        SELECT
            ac.org_id,
            mp.label                                        AS most_used_platform,
            COUNT(ml.id)                                    AS lead_count,
            ROW_NUMBER() OVER (
                PARTITION BY ac.org_id ORDER BY COUNT(ml.id) DESC
            )                                               AS rn
        FROM  ad_campaigns       ac
        JOIN  marketing_platforms mp ON mp.id = ac.platform_id
        LEFT JOIN marketing_leads ml ON ml.campaign_id = ac.id AND NOT ml.is_deleted
        WHERE NOT ac.is_deleted
        GROUP BY ac.org_id, mp.label
    ) ranked WHERE rn = 1
)
SELECT
    o.id                                                    AS org_id,
    o.name                                                  AS org_name,
    o.tenant_id,
    COALESCE(lc.total_leads,       0)::INT                  AS total_leads,
    COALESCE(lc.converted_leads,   0)::INT                  AS converted_leads,
    COALESCE(lc.unqualified_leads, 0)::INT                  AS unqualified_leads,
    CASE
        WHEN COALESCE(ist.leads_with_interactions, 0) = 0 THEN 0::NUMERIC(5,2)
        ELSE ROUND(
            ist.total_interactions::NUMERIC / ist.leads_with_interactions, 2
        )
    END                                                     AS avg_interactions_per_lead,
    COALESCE(fc.pending_follow_ups, 0)::INT                 AS pending_follow_ups,
    COALESCE(fc.missed_follow_ups,  0)::INT                 AS missed_follow_ups,
    pu.most_used_platform,
    CLOCK_TIMESTAMP()                                       AS snapshot_at
FROM  organizations          o
LEFT JOIN lead_counts         lc  ON lc.org_id  = o.id
LEFT JOIN interaction_stats   ist ON ist.org_id = o.id
LEFT JOIN follow_up_counts    fc  ON fc.org_id  = o.id
LEFT JOIN platform_usage      pu  ON pu.org_id  = o.id
WHERE NOT o.is_deleted;

-- ============================================================
-- VW_LEAD_FOLLOWUP_TIMELINE
-- Unified chronological timeline per lead: status changes, follow-up
-- entries, and logged interactions. Ordered by the caller (DESC).
-- ============================================================
CREATE OR REPLACE VIEW vw_lead_followup_timeline WITH (security_invoker = true) AS
SELECT
    lsl.id                      AS event_id,
    lsl.org_id,
    lsl.lead_id,
    'status_change'             AS event_type,
    lsl.changed_at              AS event_at,
    cb.full_name                AS actor_name,
    cb.email                    AS actor_email,
    os.name                     AS old_stage,
    os.label                    AS old_stage_label,
    ns.name                     AS new_stage,
    ns.label                    AS new_stage_label,
    ofr.name                    AS old_outcome,
    ofr.label                   AS old_outcome_label,
    nfr.name                    AS new_outcome,
    nfr.label                   AS new_outcome_label,
    au.full_name                AS assigned_to_name,
    lsl.transition_note         AS note,
    NULL::uuid                  AS followup_id,
    NULL::text                  AS followup_status,
    NULL::timestamptz           AS scheduled_at,
    NULL::timestamptz           AS completed_at,
    NULL::text                  AS interaction_type
FROM  lead_status_log           lsl
LEFT JOIN users                 cb  ON cb.id  = lsl.changed_by_id
LEFT JOIN lead_stage            os  ON os.id  = lsl.old_stage_id
JOIN  lead_stage                ns  ON ns.id  = lsl.new_stage_id
LEFT JOIN lead_stage_outcome    ofr ON ofr.id = lsl.old_outcome_id
LEFT JOIN lead_stage_outcome    nfr ON nfr.id = lsl.new_outcome_id
LEFT JOIN users                 au  ON au.id  = lsl.assigned_user_id

UNION ALL

SELECT
    lf.id                       AS event_id,
    lf.org_id,
    lf.lead_id,
    'follow_up'                 AS event_type,
    COALESCE(lf.completed_at, lf.scheduled_at) AS event_at,
    u.full_name                 AS actor_name,
    u.email                     AS actor_email,
    NULL::text                  AS old_stage,
    NULL::text                  AS old_stage_label,
    NULL::text                  AS new_stage,
    NULL::text                  AS new_stage_label,
    NULL::text                  AS old_outcome,
    NULL::text                  AS old_outcome_label,
    NULL::text                  AS new_outcome,
    NULL::text                  AS new_outcome_label,
    u.full_name                 AS assigned_to_name,
    lf.notes                    AS note,
    lf.id                       AS followup_id,
    fs.name                     AS followup_status,
    lf.scheduled_at,
    lf.completed_at,
    NULL::text                  AS interaction_type
FROM  lead_follow_ups         lf
JOIN  follow_up_statuses      fs  ON fs.id = lf.status_id
JOIN  users                   u   ON u.id  = lf.assigned_user_id
WHERE NOT lf.is_deleted

UNION ALL

SELECT
    li.id                       AS event_id,
    li.org_id,
    li.lead_id,
    'interaction'               AS event_type,
    li.occurred_at              AS event_at,
    u.full_name                 AS actor_name,
    u.email                     AS actor_email,
    NULL::text                  AS old_stage,
    NULL::text                  AS old_stage_label,
    NULL::text                  AS new_stage,
    NULL::text                  AS new_stage_label,
    NULL::text                  AS old_outcome,
    NULL::text                  AS old_outcome_label,
    NULL::text                  AS new_outcome,
    NULL::text                  AS new_outcome_label,
    NULL::text                  AS assigned_to_name,
    li.notes                    AS note,
    NULL::uuid                  AS followup_id,
    NULL::text                  AS followup_status,
    NULL::timestamptz           AS scheduled_at,
    NULL::timestamptz           AS completed_at,
    it.name                     AS interaction_type
FROM  lead_interactions         li
JOIN  interaction_types         it  ON it.id = li.interaction_type_id
JOIN  users                     u   ON u.id  = li.user_id
WHERE NOT li.is_deleted

UNION ALL

-- Assignment changes recorded by audit_marketing_leads_changes trigger
SELECT
    mlh.id                      AS event_id,
    ml.org_id,
    mlh.lead_id,
    'assignment_change'         AS event_type,
    mlh.changed_at              AS event_at,
    cu.full_name                AS actor_name,
    cu.email                    AS actor_email,
    NULL::text                  AS old_stage,
    NULL::text                  AS old_stage_label,
    NULL::text                  AS new_stage,
    NULL::text                  AS new_stage_label,
    NULL::text                  AS old_outcome,
    NULL::text                  AS old_outcome_label,
    NULL::text                  AS new_outcome,
    NULL::text                  AS new_outcome_label,
    COALESCE(new_u.full_name, 'Unassigned') AS assigned_to_name,
    CASE
        WHEN old_u.full_name IS NULL AND new_u.full_name IS NOT NULL
            THEN 'Assigned to ' || new_u.full_name
        WHEN old_u.full_name IS NOT NULL AND new_u.full_name IS NULL
            THEN 'Unassigned from ' || old_u.full_name
        WHEN old_u.full_name IS NOT NULL AND new_u.full_name IS NOT NULL
            THEN 'Reassigned from ' || old_u.full_name || ' to ' || new_u.full_name
        ELSE NULL
    END                         AS note,
    NULL::uuid                  AS followup_id,
    NULL::text                  AS followup_status,
    NULL::timestamptz           AS scheduled_at,
    NULL::timestamptz           AS completed_at,
    NULL::text                  AS interaction_type
FROM  marketing_leads_history   mlh
JOIN  marketing_leads            ml    ON ml.id  = mlh.lead_id
LEFT JOIN users                  cu    ON cu.id  = mlh.changed_by_user_id
LEFT JOIN users                  old_u ON old_u.id = (mlh.changed_fields -> 'assigned_user_id' ->> 'old')::uuid
LEFT JOIN users                  new_u ON new_u.id = (mlh.changed_fields -> 'assigned_user_id' ->> 'new')::uuid
WHERE mlh.operation = 'U'
  AND mlh.changed_fields ? 'assigned_user_id';

-- ============================================================
-- VW_FOLLOWUP_PIPELINE_ENRICHED
-- Extended follow-up pipeline with lead status, last interaction, overdue flag.
-- ============================================================
CREATE OR REPLACE VIEW vw_followup_pipeline_enriched WITH (security_invoker = true) AS
SELECT
    lf.id                           AS follow_up_id,
    lf.org_id,
    o.name                          AS org_name,
    lf.lead_id,
    ml.full_name                    AS lead_full_name,
    ml.phone                        AS lead_phone,
    ml.email                        AS lead_email,
    ls.name                         AS lead_stage,
    ls.label                        AS lead_stage_label,
    ml.tags                         AS lead_tags,
    u.id                            AS assigned_rep_id,
    u.full_name                     AS assigned_rep_name,
    u.email                         AS assigned_rep_email,
    fs.name                         AS follow_up_status,
    lf.scheduled_at,
    lf.completed_at,
    lf.notes,
    lf.created_at,
    CASE
        WHEN fs.name = 'pending' AND lf.scheduled_at < CLOCK_TIMESTAMP() THEN TRUE
        ELSE FALSE
    END                             AS is_overdue,
    CASE
        WHEN fs.name = 'pending' AND lf.scheduled_at < CLOCK_TIMESTAMP()
        THEN EXTRACT(EPOCH FROM (CLOCK_TIMESTAMP() - lf.scheduled_at)) / 60
        ELSE NULL
    END::INT                        AS minutes_overdue,
    last_ix.occurred_at             AS last_interaction_at,
    last_ix.type_name               AS last_interaction_type
FROM  lead_follow_ups             lf
JOIN  marketing_leads              ml  ON ml.id  = lf.lead_id
JOIN  lead_stage                   ls  ON ls.id  = ml.stage_id
JOIN  follow_up_statuses           fs  ON fs.id  = lf.status_id
JOIN  users                        u   ON u.id   = lf.assigned_user_id
JOIN  organizations                o   ON o.id   = lf.org_id
LEFT JOIN LATERAL (
    SELECT li.occurred_at, it.name AS type_name
    FROM   lead_interactions li
    JOIN   interaction_types it ON it.id = li.interaction_type_id
    WHERE  li.lead_id = lf.lead_id AND NOT li.is_deleted
    ORDER  BY li.occurred_at DESC
    LIMIT  1
) last_ix ON TRUE
WHERE NOT lf.is_deleted
  AND NOT ml.is_deleted
  AND fs.name IN ('pending', 'missed');

COMMIT;
