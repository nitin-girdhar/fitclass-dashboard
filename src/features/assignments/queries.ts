/**
 * Assignment READ layer. SERVER-ONLY.
 *
 * In the current schema, assignments are represented by
 * marketing_leads.assigned_user_id — there is no separate `assignments`
 * table. All exported functions query marketing_leads and return the
 * AssignmentRowWithAssignee shape that the rest of the app consumes.
 *
 * The "assignment id" == marketing_lead.id (id and lead_id are always the
 * same value). Serialisers and client components remain unchanged.
 */
import { withServiceTx } from '@/src/lib/db/transaction';
import type { Assignment } from '@/src/types/database';
import type { AssignmentRowWithAssignee } from './serializers';

// ── Shared SQL ────────────────────────────────────────────────────────────────

const ASSIGNED_LEADS_SELECT = `
  SELECT
    ml.id                                          AS id,
    ml.id                                          AS lead_id,
    ml.full_name                                   AS lead_name,
    ml.phone                                       AS lead_phone,
    COALESCE(o.name, '')                           AS branch,
    ml.assigned_user_id::text                     AS assigned_to,
    ''                                             AS assigned_by,
    COALESCE(ml.updated_at, ml.created_at)::text  AS assigned_at,
    NULL::text                                     AS notes,
    u.full_name                                    AS assignee_name,
    u.email                                        AS assignee_email,
    ur.label                                       AS assignee_role,
    ml.duplicate_lead_id::text                    AS duplicate_lead_id,
    dup_mp.label                                  AS duplicate_lead_platform
  FROM marketing_leads ml
  JOIN users u ON u.id = ml.assigned_user_id
  LEFT JOIN user_roles ur ON ur.id = u.role_id
  LEFT JOIN organizations o ON o.id = ml.org_id
  LEFT JOIN marketing_leads dup_ml ON dup_ml.id = ml.duplicate_lead_id
  LEFT JOIN ad_campaigns dup_ac ON dup_ac.id = dup_ml.campaign_id
  LEFT JOIN marketing_platforms dup_mp ON dup_mp.id = dup_ac.platform_id
  WHERE ml.assigned_user_id IS NOT NULL
    AND NOT ml.is_deleted
`;

function mapRow(r: any): AssignmentRowWithAssignee {
  return {
    id:          r.id          as string,
    lead_id:     r.lead_id     as string,
    lead_name:   (r.lead_name  ?? null) as string | null,
    lead_phone:  (r.lead_phone ?? null) as string | null,
    branch:      r.branch      as string,
    assigned_to: r.assigned_to as string,
    assigned_by: r.assigned_by as string,
    assigned_at: String(r.assigned_at ?? ''),
    notes:       null,
    assignee_role:           (r.assignee_role           ?? null) as string | null,
    duplicate_lead_id:       (r.duplicate_lead_id       ?? null) as string | null,
    duplicate_lead_platform: (r.duplicate_lead_platform ?? null) as string | null,
    assignee: {
      name:  (r.assignee_name  ?? null) as string | null,
      email: (r.assignee_email ?? '')   as string,
    },
  };
}

/**
 * Run the shared assigned-leads query with an additional WHERE clause and
 * an optional row limit.
 */
async function queryAssignedLeads(
  whereClause: string,
  params: unknown[],
  limit = 1000,
): Promise<AssignmentRowWithAssignee[]> {
  return withServiceTx(async (tx) => {
    const rows = await tx.unsafe(
      `${ASSIGNED_LEADS_SELECT}
       ${whereClause}
       ORDER BY ml.updated_at DESC
       LIMIT ${Number(limit)}`,
      params,
    );
    return (rows as any[]).map(mapRow);
  });
}

// ── Public API ────────────────────────────────────────────────────────────────

/** Single assignment by lead. Null when the lead has no current owner. */
export async function getLeadAssignment(
  leadId: string,
): Promise<AssignmentRowWithAssignee | null> {
  const rows = await queryAssignedLeads('AND ml.id = $1::uuid', [leadId], 1);
  return rows[0] ?? null;
}

/** Single assignment by primary key (= lead id in current schema). */
export async function getAssignmentById(
  id: string,
): Promise<AssignmentRowWithAssignee | null> {
  const rows = await queryAssignedLeads('AND ml.id = $1::uuid', [id], 1);
  return rows[0] ?? null;
}

/**
 * Batch fetch by lead ids. Returns a Map<lead_id, row>.
 * Empty input returns an empty map immediately.
 */
export async function getAssignmentsByLeadIds(
  leadIds: readonly string[],
): Promise<Map<string, AssignmentRowWithAssignee>> {
  if (leadIds.length === 0) return new Map();
  const rows = await queryAssignedLeads('AND ml.id = ANY($1::uuid[])', [[...leadIds]]);
  const map = new Map<string, AssignmentRowWithAssignee>();
  for (const row of rows) map.set(row.lead_id, row);
  return map;
}

/** All assignments currently owned by a given user (newest first). */
export async function getAssignmentsForUser(
  userId: string,
): Promise<AssignmentRowWithAssignee[]> {
  return queryAssignedLeads('AND ml.assigned_user_id = $1::uuid', [userId]);
}

/**
 * Distinct branches (org names) in which a user holds at least one
 * assignment. Powers the sales_executive branch-tab list.
 */
export async function getDistinctBranchesForUser(userId: string): Promise<string[]> {
  return withServiceTx(async (tx) => {
    const rows = await tx.unsafe(
      `SELECT DISTINCT COALESCE(o.name, '') AS branch
       FROM marketing_leads ml
       LEFT JOIN organizations o ON o.id = ml.org_id
       WHERE ml.assigned_user_id = $1::uuid AND NOT ml.is_deleted`,
      [userId],
    );
    return (rows as any[])
      .map((r) => r.branch as string)
      .filter(Boolean)
      .sort((a, b) => a.localeCompare(b));
  });
}

/**
 * All assignments for a specific user — "My Leads" page.
 */
export async function listMyAssignments(
  userId: string,
): Promise<AssignmentRowWithAssignee[]> {
  return queryAssignedLeads('AND ml.assigned_user_id = $1::uuid', [userId]);
}

/**
 * All assignments, optionally scoped to a set of org IDs.
 *   null / undefined → no filter (super_admin sees all)
 *   []               → empty result
 *   [uuid, ...]      → restrict to those orgs
 */
export async function listAllAssignments(
  orgIds?: string[] | null,
): Promise<AssignmentRowWithAssignee[]> {
  if (orgIds && orgIds.length === 0) return [];
  if (orgIds) {
    return queryAssignedLeads('AND ml.org_id = ANY($1::uuid[])', [orgIds]);
  }
  return queryAssignedLeads('', []);
}

export type { Assignment };
