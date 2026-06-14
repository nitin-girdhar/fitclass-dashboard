
BEGIN;

/*
  ══════════════════════════════════════════════════════════════
  USER HIERARCHY — DESIGN DECISION
  ══════════════════════════════════════════════════════════════

  MODEL CHOICE: Adjacency List + Recursive CTE
  ─────────────────────────────────────────────
  Three common models for n-level hierarchy in SQL:

  ┌──────────────────┬─────────────────────────────┬─────────────────────────────┐
  │ Model            │ Read (subtree query)         │ Write (manager change)      │
  ├──────────────────┼─────────────────────────────┼─────────────────────────────┤
  │ Adjacency List   │ WITH RECURSIVE — O(depth)    │ UPDATE 1 row — O(1)         │
  │ (chosen)         │ PostgreSQL handles well       │ Trigger detects cycles      │
  ├──────────────────┼─────────────────────────────┼─────────────────────────────┤
  │ Closure Table    │ JOIN — O(1)                   │ Rebuild subtree — complex   │
  │                  │ Best for very deep trees      │ Error-prone triggers        │
  ├──────────────────┼─────────────────────────────┼─────────────────────────────┤
  │ Nested Sets      │ BETWEEN — O(1)               │ Renumber entire table       │
  │                  │ Great for read-heavy trees    │ Locks full table on write   │
  └──────────────────┴─────────────────────────────┴─────────────────────────────┘

  WHY Adjacency List for this schema:
    • Org sizes in this CRM: 3–50 users per org, depth rarely exceeds 5 levels.
      WITH RECURSIVE on 50 rows is sub-millisecond.
    • Manager changes happen frequently (promotions, restructuring).
      Adjacency List handles these with a single UPDATE.
    • PostgreSQL's WITH RECURSIVE is mature, index-aware, and cycle-safe with
      the CYCLE clause (PG 14+) or manual visited-array guard.
    • No separate maintenance triggers = no trigger bugs.

  HIERARCHY SHAPE — n-level, multiple managers per org fully supported:

    org_admin                          (level 0)
      ├── org_manager_A                (level 1)  ─┐
      │     ├── senior_sales_exec_1    (level 2)   │ Multiple org_managers
      │     │     ├── sales_representative_1      (level 3)   │ in same org, each with
      │     │     └── sales_representative_2      (level 3)   │ their own subtree.
      │     └── senior_sales_exec_2    (level 2)   │
      │           └── sales_representative_3      (level 3)  ─┘
      └── org_manager_B                (level 1)
            └── senior_sales_exec_3    (level 2)
                  ├── sales_representative_4      (level 3)
                  └── sales_representative_5      (level 3)

  The hierarchy depth is unlimited. Adding more levels (e.g. a "team lead"
  between senior_sales_executive and sales_representative) requires only:
    1. INSERT a new role into user_roles (one SQL row)
    2. Set manager_id correctly when creating users
    3. Optionally add the role to can_assign_to() if it should have subtree authority
  No schema migration. No table changes. No trigger changes.

  ASSIGNMENT AUTHORITY RULES:
    org_admin / tenant_admin     → can assign any lead to any user in the org
    org_sr_manager               → can assign to their entire subtree (all levels below)
    org_manager                  → can assign to their entire subtree (all levels below)
    senior_sales_executive       → can assign only to users within their own subtree
    sales_representative / read_only        → can only self-assign (claim from unassigned pool)

  HOW THE CONSOLE WORKS (Node.js API):
    1. GET /api/hierarchy/team?userId=<uuid>
         → queries vw_user_team_members WHERE manager_id = $userId
         → returns the list of users this person can assign leads to

    2. PATCH /api/leads/:id/assign { assignedTo: <uuid> }
         → calls can_assign_to(orgId, currentUserId, targetUserId)
         → if TRUE: UPDATE marketing_leads SET assigned_user_id = $target
         → trigger auto-logs to lead_assignment_log
*/

-- ============================================================
-- STEP 1: CYCLE DETECTION TRIGGER
-- manager_id column and chk_user_not_own_manager constraint are
-- defined in 03_core_tables.sql. This trigger adds cycle detection.
-- Prevents the hierarchy from becoming circular when manager_id
-- is set or updated. Walks the chain upward from the proposed
-- manager to verify the current user does not already appear.
-- ============================================================
CREATE OR REPLACE FUNCTION check_user_hierarchy_no_cycle()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
DECLARE
    v_cursor_id UUID;
    v_visited   UUID[] := ARRAY[NEW.id];
BEGIN
    IF NEW.manager_id IS NULL THEN
        RETURN NEW;
    END IF;

    v_cursor_id := NEW.manager_id;

    -- Walk upward through the chain. Stop at root (manager_id IS NULL)
    -- or if we detect the user's own id — which would be a cycle.
    LOOP
        IF v_cursor_id = ANY(v_visited) THEN
            -- v_cursor_id appeared twice → cycle detected
            RAISE EXCEPTION
                'Circular reporting chain detected: setting manager_id = % '
                'on user % would create a cycle. Reporting chain visited: %',
                NEW.manager_id, NEW.id, v_visited;
        END IF;

        v_visited := v_visited || v_cursor_id;

        -- Move one level up
        SELECT manager_id INTO v_cursor_id
        FROM users
        WHERE id = v_cursor_id;

        EXIT WHEN v_cursor_id IS NULL;
    END LOOP;

    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_user_hierarchy_no_cycle ON users;
CREATE TRIGGER trg_user_hierarchy_no_cycle
    BEFORE INSERT OR UPDATE OF manager_id ON users
    FOR EACH ROW EXECUTE FUNCTION check_user_hierarchy_no_cycle();

-- ============================================================
-- STEP 2: LEAD ASSIGNMENT LOG
-- marketing_leads.assigned_user_id tracks only the CURRENT assignee.
-- This table provides the full chronological assignment history for
-- a lead — who passed it to whom, and when.
-- Populated automatically via trigger on marketing_leads (see Step 3).
-- ============================================================
CREATE TABLE IF NOT EXISTS lead_assignment_log (
    id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    -- ON DELETE RESTRICT: assignment history must outlive org deletion attempts
    org_id          UUID        NOT NULL REFERENCES organizations(id) ON DELETE RESTRICT,
    -- ON DELETE CASCADE: assignment history belongs to the lead
    lead_id         UUID        NOT NULL REFERENCES marketing_leads(id) ON DELETE CASCADE,
    -- ON DELETE SET NULL: preserve log even if the assigning user is deleted
    assigned_by_id  UUID        REFERENCES users(id) ON DELETE SET NULL,
    -- ON DELETE SET NULL: preserve log even if target user is deleted
    assigned_to_id  UUID        REFERENCES users(id) ON DELETE SET NULL,
    -- NULL means "returned to unassigned pool"
    assigned_at     TIMESTAMPTZ NOT NULL DEFAULT CLOCK_TIMESTAMP(),
    action          TEXT        NOT NULL DEFAULT 'reassigned'
                    CONSTRAINT chk_assignment_action CHECK (
                        action IN ('initial','reassigned','unassigned','self_assigned','bulk_assigned')
                    ),
    note            TEXT,
    -- previous assignee for diff/audit context
    previous_assignee_id UUID   REFERENCES users(id) ON DELETE SET NULL
);

-- Timeline view: latest assignment first per lead
CREATE INDEX IF NOT EXISTS idx_lead_assignment_log_lead
    ON lead_assignment_log (org_id, lead_id, assigned_at DESC);

-- "All leads assigned by this manager" view
CREATE INDEX IF NOT EXISTS idx_lead_assignment_log_assigned_by
    ON lead_assignment_log (org_id, assigned_by_id, assigned_at DESC);

-- "All leads ever assigned to this rep"
CREATE INDEX IF NOT EXISTS idx_lead_assignment_log_assigned_to
    ON lead_assignment_log (org_id, assigned_to_id, assigned_at DESC);

-- Non-partial index for FK CASCADE DELETE from marketing_leads.
-- The composite indexes above lead with org_id, so the FK engine cannot use them
-- when scanning by lead_id alone during a physical purge by service_role.
CREATE INDEX IF NOT EXISTS idx_lead_assignment_log_lead_id_full
    ON lead_assignment_log (lead_id);

-- RLS: app_user sees assignment log for their org; tenant_admin for their tenant
ALTER TABLE lead_assignment_log ENABLE ROW LEVEL SECURITY;
ALTER TABLE lead_assignment_log FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS org_isolation_policy    ON lead_assignment_log;
DROP POLICY IF EXISTS tenant_isolation_policy ON lead_assignment_log;

CREATE POLICY org_isolation_policy ON lead_assignment_log
    AS PERMISSIVE FOR ALL TO app_user
    USING (org_id = current_setting('app.current_org_id', true)::uuid)
    WITH CHECK (org_id = current_setting('app.current_org_id', true)::uuid);

CREATE POLICY tenant_isolation_policy ON lead_assignment_log
    AS PERMISSIVE FOR ALL TO tenant_admin
    USING (
        org_id IN (
            SELECT id FROM organizations
            WHERE tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid
              AND NOT is_deleted
        )
    );

-- ============================================================
-- STEP 3: AUTO-LOG TRIGGER on marketing_leads
-- Every time assigned_user_id changes, write a row to lead_assignment_log.
-- The application NEVER needs to call lead_assignment_log directly —
-- just UPDATE marketing_leads SET assigned_user_id = $x and the log
-- is captured automatically.
-- ============================================================
-- SECURITY DEFINER: runs as the function owner (schema owner with INSERT on lead_assignment_log).
-- Required because app_user only has SELECT on lead_assignment_log.
-- Without SECURITY DEFINER, every assigned_user_id change by app_user would raise
-- "permission denied for table lead_assignment_log".
CREATE OR REPLACE FUNCTION log_lead_assignment()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
    v_actor UUID;
    v_action TEXT;
BEGIN
    -- Only fire when assigned_user_id truly changes
    IF NEW.assigned_user_id IS NOT DISTINCT FROM OLD.assigned_user_id THEN
        RETURN NEW;
    END IF;

    BEGIN
        v_actor := NULLIF(current_setting('app.current_user_id', true), '')::uuid;
    EXCEPTION WHEN OTHERS THEN
        v_actor := NULL;
    END;

    -- Classify the action for the console's activity feed
    v_action := CASE
        WHEN OLD.assigned_user_id IS NULL AND NEW.assigned_user_id IS NOT NULL
            THEN 'initial'                               -- taken from unassigned pool
        WHEN OLD.assigned_user_id IS NOT NULL AND NEW.assigned_user_id IS NULL
            THEN 'unassigned'                            -- returned to pool
        WHEN v_actor = NEW.assigned_user_id
            THEN 'self_assigned'                         -- rep claimed the lead
        ELSE 'reassigned'                                -- manager moved the lead
    END;

    INSERT INTO lead_assignment_log
        (org_id, lead_id, assigned_by_id, assigned_to_id, action, previous_assignee_id)
    VALUES
        (NEW.org_id, NEW.id, v_actor, NEW.assigned_user_id, v_action, OLD.assigned_user_id);

    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_lead_assignment_log ON marketing_leads;
CREATE TRIGGER trg_lead_assignment_log
    AFTER UPDATE OF assigned_user_id ON marketing_leads
    FOR EACH ROW EXECUTE FUNCTION log_lead_assignment();

-- ============================================================
-- STEP 4: ASSIGNMENT AUTHORITY FUNCTION
-- Called by the API before any lead assignment action.
-- Returns TRUE if the acting user has authority to assign a lead
-- to the target user, FALSE otherwise.
--
-- Usage in Node.js:
--   const { rows } = await tx.query(
--       `SELECT can_assign_to($1, $2, $3) AS allowed`,
--       [orgId, actingUserId, targetUserId]
--   );
--   if (!rows[0].allowed) throw new ForbiddenError();
--
-- SECURITY DEFINER: runs with schema-owner privileges so it can
-- read users and vw_user_team_members regardless of calling role.
-- ============================================================
CREATE OR REPLACE FUNCTION can_assign_to(
    p_org_id         UUID,
    p_acting_user_id UUID,
    p_target_user_id UUID
) RETURNS BOOLEAN LANGUAGE plpgsql STABLE SECURITY DEFINER AS $$
DECLARE
    v_role     TEXT;
    v_in_scope BOOLEAN;
BEGIN
    -- Self-assign: always allowed
    IF p_acting_user_id = p_target_user_id THEN
        RETURN TRUE;
    END IF;

    -- Resolve acting user's role within the org
    SELECT ur.name INTO v_role
    FROM users u
    JOIN user_roles ur ON ur.id = u.role_id
    WHERE u.id = p_acting_user_id
      AND u.org_id = p_org_id
      AND NOT u.is_deleted
      AND u.is_active;

    IF v_role IS NULL THEN
        RETURN FALSE; -- acting user not found or inactive in this org
    END IF;

    -- Unrestricted roles: can assign to anyone in the org
    IF v_role IN ('super_admin', 'tenant_admin', 'org_admin') THEN
        RETURN TRUE;
    END IF;

    -- Subtree-scoped roles: can assign only to users within their own reporting subtree.
    -- Adding a new middle-management role only requires adding its name to this IN() list.
    IF v_role IN ('org_manager', 'org_sr_manager', 'senior_sales_executive') THEN
        SELECT COUNT(*) > 0 INTO v_in_scope
        FROM vw_user_team_members
        WHERE manager_id = p_acting_user_id
          AND member_id  = p_target_user_id
          AND org_id     = p_org_id;
        RETURN COALESCE(v_in_scope, FALSE);
    END IF;

    -- sales_representative / read_only: cannot assign to others
    RETURN FALSE;
END;
$$;

-- ============================================================
-- STEP 5: VIEW — vw_user_org_chart
-- The org chart tree for the assignment console.
-- Returns every user in an org with their position in the hierarchy,
-- their manager's name, and the full reporting path as a breadcrumb.
--
-- Usage:
--   SELECT * FROM vw_user_org_chart WHERE org_id = $1
--   ORDER BY hierarchy_level, full_name;
--
-- RLS on users enforces org isolation — safe for app_user and tenant_admin.
-- ============================================================
CREATE OR REPLACE VIEW vw_user_org_chart AS
WITH RECURSIVE tree AS (
    -- Root: users with no manager in this org (top of hierarchy)
    SELECT
        u.id,
        u.org_id,
        u.first_name,
        u.middle_name,
        u.last_name,
        u.full_name,
        u.email,
        ur.name                     AS role_name,
        u.manager_id,
        NULL::UUID                  AS manager_id_resolved,
        NULL::TEXT                  AS manager_full_name,
        0                           AS hierarchy_level,
        ARRAY[u.id]                 AS ancestor_ids,   -- used for cycle guard
        ARRAY[u.full_name]::TEXT[]  AS path_names
    FROM  users u
    JOIN  user_roles ur ON ur.id = u.role_id
    WHERE u.manager_id IS NULL
      AND NOT u.is_deleted

    UNION ALL

    -- Recursive: each user who reports to someone already in the tree
    SELECT
        u.id,
        u.org_id,
        u.first_name,
        u.middle_name,
        u.last_name,
        u.full_name,
        u.email,
        ur.name                     AS role_name,
        u.manager_id,
        t.id                        AS manager_id_resolved,
        t.full_name                 AS manager_full_name,
        t.hierarchy_level + 1       AS hierarchy_level,
        t.ancestor_ids || u.id      AS ancestor_ids,
        t.path_names   || u.full_name AS path_names
    FROM  users u
    JOIN  user_roles ur ON ur.id  = u.role_id
    JOIN  tree       t  ON t.id   = u.manager_id
    WHERE NOT u.is_deleted
      AND NOT (u.id = ANY(t.ancestor_ids))  -- cycle safety guard
)
SELECT
    id                          AS user_id,
    org_id,
    first_name,
    middle_name,
    last_name,
    full_name,
    email,
    role_name,
    manager_id,
    manager_full_name,
    hierarchy_level,
    -- Breadcrumb path: "org_admin > org_manager > sales_representative"
    array_to_string(path_names, ' > ') AS reporting_path,
    ancestor_ids
FROM tree;

-- ============================================================
-- STEP 6: VIEW — vw_user_team_members
-- For a given manager (user), lists every direct and indirect report
-- with their depth (1 = direct, 2 = one level below direct, etc.).
--
-- Usage (assignment dropdown):
--   SELECT member_id, member_full_name, member_role, depth
--   FROM vw_user_team_members
--   WHERE manager_id = $acting_user_id
--     AND org_id     = $org_id
--     AND is_active  = TRUE
--   ORDER BY depth, member_full_name;
--
-- Returns ONLY subordinates (depth > 0) — not the manager themselves.
-- ============================================================
CREATE OR REPLACE VIEW vw_user_team_members AS
WITH RECURSIVE subtree AS (
    -- Anchor: each user is the root of their own subtree
    SELECT
        u.id            AS manager_id,
        u.org_id,
        u.id            AS member_id,
        u.full_name     AS member_full_name,
        u.email         AS member_email,
        ur.name         AS member_role,
        u.manager_id    AS direct_manager_id,
        0               AS depth,
        u.is_active,
        ARRAY[u.id]     AS visited   -- cycle guard
    FROM  users u
    JOIN  user_roles ur ON ur.id = u.role_id
    WHERE NOT u.is_deleted

    UNION ALL

    -- Recurse: each direct report of a member in the subtree
    SELECT
        s.manager_id,
        u.org_id,
        u.id            AS member_id,
        u.full_name     AS member_full_name,
        u.email         AS member_email,
        ur.name         AS member_role,
        u.manager_id    AS direct_manager_id,
        s.depth + 1     AS depth,
        u.is_active,
        s.visited || u.id
    FROM  users u
    JOIN  user_roles ur ON ur.id  = u.role_id
    JOIN  subtree    s  ON s.member_id = u.manager_id
    WHERE NOT u.is_deleted
      AND NOT (u.id = ANY(s.visited))  -- cycle safety
)
SELECT
    manager_id,
    org_id,
    member_id,
    member_full_name,
    member_email,
    member_role,
    direct_manager_id,
    depth,
    is_active
FROM subtree
WHERE depth > 0;   -- exclude self-rows (the manager themselves)

-- ============================================================
-- STEP 7: VIEW — vw_lead_assignment_timeline
-- For the lead detail panel in the console — shows who owned
-- this lead and for how long.
-- ============================================================
CREATE OR REPLACE VIEW vw_lead_assignment_timeline AS
SELECT
    l.id                            AS log_id,
    l.org_id,
    l.lead_id,
    ml.full_name                    AS lead_full_name,
    actor.full_name                 AS assigned_by_name,
    actor.email                     AS assigned_by_email,
    target.full_name                AS assigned_to_name,
    target.email                    AS assigned_to_email,
    prev.full_name                  AS previous_assignee_name,
    l.action,
    l.note,
    l.assigned_at,
    -- How long this assignment lasted before the next change
    LEAD(l.assigned_at) OVER (
        PARTITION BY l.lead_id
        ORDER BY l.assigned_at
    ) - l.assigned_at               AS held_for
-- ORDER BY belongs in the caller's query, not here.
FROM  lead_assignment_log   l
JOIN  marketing_leads        ml    ON ml.id    = l.lead_id
LEFT JOIN users              actor ON actor.id = l.assigned_by_id
LEFT JOIN users              target ON target.id = l.assigned_to_id
LEFT JOIN users              prev  ON prev.id  = l.previous_assignee_id;

-- ============================================================
-- GRANTS — hierarchy objects
-- Roles are guaranteed to exist: 08_grants.sql runs before this file.
-- All other table grants live in 07. These cover objects created in this file only.
-- ============================================================
GRANT SELECT ON lead_assignment_log         TO app_user;
GRANT SELECT ON vw_user_org_chart           TO app_user;
GRANT SELECT ON vw_user_team_members        TO app_user;
GRANT SELECT ON vw_lead_assignment_timeline TO app_user;
GRANT EXECUTE ON FUNCTION can_assign_to(UUID, UUID, UUID) TO app_user;

GRANT SELECT ON lead_assignment_log         TO tenant_admin;
GRANT SELECT ON vw_user_org_chart           TO tenant_admin;
GRANT SELECT ON vw_user_team_members        TO tenant_admin;
GRANT SELECT ON vw_lead_assignment_timeline TO tenant_admin;
GRANT EXECUTE ON FUNCTION can_assign_to(UUID, UUID, UUID) TO tenant_admin;

GRANT ALL ON lead_assignment_log            TO service_role;
GRANT ALL ON ALL SEQUENCES IN SCHEMA public TO service_role;

-- manager_id seed data (manager relationships) are set in 09_seed_data.sql.

COMMIT;
