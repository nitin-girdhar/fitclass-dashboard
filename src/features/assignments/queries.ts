/**
 * Assignment READ layer. SERVER-ONLY (getSupabaseAdmin(), RLS-bypass).
 *
 * Phase 2U: every SELECT embeds the assignee user via the PostgREST
 * `users!assigned_to(name, email)` syntax — ONE SQL join, no N+1, and
 * the UI never has to fall back to displaying the raw `assigned_to`
 * UUID when an assignee isn't in the caller's candidate list.
 *
 * The batch variant `getAssignmentsByLeadIds` is the workhorse: the leads
 * route fetches rows from Google Sheets, then asks this module for the
 * matching assignments + their assignees in ONE round-trip.
 */
import { getSupabaseAdmin } from '@/src/lib/db/supabase';
import { fromPostgrestError } from '@/src/lib/db/errors';
import { withServiceTx } from '@/src/lib/db/transaction';
import type { Assignment } from '@/src/types/database';
import type { AssignmentRowWithAssignee } from './serializers';

const AUTH_PROVIDER = process.env.AUTH_PROVIDER ?? 'supabase';

// ── PostgreSQL path ───────────────────────────────────────────────────────────
// In the new DB, assignments live on marketing_leads.assigned_user_id.
// We surface them as AssignmentRowWithAssignee so the existing serialisers
// and client components can consume them unchanged.

async function queryAssignedLeadsFromDB(
  whereClause: string,
  params: unknown[],
): Promise<AssignmentRowWithAssignee[]> {
  return withServiceTx(async (tx) => {
    const rows = await tx.unsafe(
      `SELECT
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
         ml.duplicate_lead_id::text                    AS duplicate_lead_id,
         dup_mp.name                                   AS duplicate_lead_platform
       FROM marketing_leads ml
       JOIN users u ON u.id = ml.assigned_user_id
       LEFT JOIN organizations o ON o.id = ml.org_id
       LEFT JOIN marketing_leads dup_ml ON dup_ml.id = ml.duplicate_lead_id
       LEFT JOIN ad_campaigns dup_ac ON dup_ac.id = dup_ml.campaign_id
       LEFT JOIN marketing_platforms dup_mp ON dup_mp.id = dup_ac.platform_id
       WHERE ml.assigned_user_id IS NOT NULL
         AND NOT ml.is_deleted
         ${whereClause}
       ORDER BY ml.updated_at DESC
       LIMIT 1000`,
      params,
    );

    return (rows as any[]).map((r) => ({
      id:          r.id          as string,
      lead_id:     r.lead_id     as string,
      lead_name:   (r.lead_name  ?? null) as string | null,
      lead_phone:  (r.lead_phone ?? null) as string | null,
      branch:      r.branch      as string,
      assigned_to: r.assigned_to as string,
      assigned_by: r.assigned_by as string,
      assigned_at: String(r.assigned_at ?? ''),
      notes:       null,
      duplicate_lead_id:       (r.duplicate_lead_id       ?? null) as string | null,
      duplicate_lead_platform: (r.duplicate_lead_platform ?? null) as string | null,
      assignee: {
        name:  (r.assignee_name  ?? null) as string | null,
        email: (r.assignee_email ?? '')   as string,
      },
    }));
  });
}

// ── Supabase path (legacy) ────────────────────────────────────────────────────

const ASSIGNMENTS_TABLE = 'assignments';

// PostgREST embed expression. Reads as: "select all assignment columns,
// plus a nested object called `assignee` populated from the users table
// via the foreign-key column `assigned_to`, projecting only `name` and
// `email`." Supabase resolves the FK by column-name reference.
const SELECT_WITH_ASSIGNEE = '*, assignee:users!assigned_to(name, email)';

function asJoined(row: unknown): AssignmentRowWithAssignee {
  return row as AssignmentRowWithAssignee;
}
function asJoinedMany(rows: unknown): AssignmentRowWithAssignee[] {
  return (rows as AssignmentRowWithAssignee[] | null) ?? [];
}

/** Single assignment by lead. Null when the lead has no current owner. */
export async function getLeadAssignment(
  leadId: string,
): Promise<AssignmentRowWithAssignee | null> {
  const { data, error } = await getSupabaseAdmin()
    .from(ASSIGNMENTS_TABLE)
    .select(SELECT_WITH_ASSIGNEE)
    .eq('lead_id', leadId)
    .maybeSingle();

  if (error) throw fromPostgrestError(error);
  return data ? asJoined(data) : null;
}

/** Single assignment by primary key. */
export async function getAssignmentById(
  id: string,
): Promise<AssignmentRowWithAssignee | null> {
  const { data, error } = await getSupabaseAdmin()
    .from(ASSIGNMENTS_TABLE)
    .select(SELECT_WITH_ASSIGNEE)
    .eq('id', id)
    .maybeSingle();

  if (error) throw fromPostgrestError(error);
  return data ? asJoined(data) : null;
}

/**
 * Batch fetch with embedded assignee. Returns a Map<lead_id, row>.
 * `lead_ids` length is capped on the caller side; Supabase's `.in()`
 * accepts sensible sizes — a typical branch sheet (< 5k rows) is fine.
 */
export async function getAssignmentsByLeadIds(
  leadIds: readonly string[],
): Promise<Map<string, AssignmentRowWithAssignee>> {
  if (leadIds.length === 0) return new Map();

  const { data, error } = await getSupabaseAdmin()
    .from(ASSIGNMENTS_TABLE)
    .select(SELECT_WITH_ASSIGNEE)
    .in('lead_id', leadIds);

  if (error) throw fromPostgrestError(error);
  const rows = asJoinedMany(data);
  const map = new Map<string, AssignmentRowWithAssignee>();
  for (const row of rows) map.set(row.lead_id, row);
  return map;
}

/** All assignments currently owned by a given user (newest first). */
export async function getAssignmentsForUser(
  userId: string,
): Promise<AssignmentRowWithAssignee[]> {
  const { data, error } = await getSupabaseAdmin()
    .from(ASSIGNMENTS_TABLE)
    .select(SELECT_WITH_ASSIGNEE)
    .eq('assigned_to', userId)
    .order('assigned_at', { ascending: false });

  if (error) throw fromPostgrestError(error);
  return asJoinedMany(data);
}

/**
 * Distinct branches in which a user holds at least one assignment.
 *
 * Powers the sales_executive branch-tab list — for SEs, "branches they can
 * see" is derived from actual ownership, NOT from `users.allowed_branches`.
 * Single-column projection; no JOIN needed here.
 */
export async function getDistinctBranchesForUser(
  userId: string,
): Promise<string[]> {
  const { data, error } = await getSupabaseAdmin()
    .from(ASSIGNMENTS_TABLE)
    .select('branch')
    .eq('assigned_to', userId);
  if (error) throw fromPostgrestError(error);
  const rows = (data as { branch: string }[] | null) ?? [];
  const set = new Set<string>();
  for (const row of rows) set.add(row.branch);
  return Array.from(set).sort((a, b) => a.localeCompare(b));
}

/** All assignments inside a branch (manager scope). */
export async function getAssignmentsForBranch(
  branch: string,
): Promise<AssignmentRowWithAssignee[]> {
  const { data, error } = await getSupabaseAdmin()
    .from(ASSIGNMENTS_TABLE)
    .select(SELECT_WITH_ASSIGNEE)
    .eq('branch', branch)
    .order('assigned_at', { ascending: false });

  if (error) throw fromPostgrestError(error);
  return asJoinedMany(data);
}

/** All assignments across a set of branches (manager with multiple scopes). */
export async function getAssignmentsForBranches(
  branches: readonly string[],
): Promise<AssignmentRowWithAssignee[]> {
  if (branches.length === 0) return [];
  // Local-DB path: branch concept doesn't exist; return all org assignments
  if (AUTH_PROVIDER === 'local') return queryAssignedLeadsFromDB('', []);

  const { data, error } = await getSupabaseAdmin()
    .from(ASSIGNMENTS_TABLE)
    .select(SELECT_WITH_ASSIGNEE)
    .in('branch', branches)
    .order('assigned_at', { ascending: false });

  if (error) throw fromPostgrestError(error);
  return asJoinedMany(data);
}

/**
 * All assignments for a specific user — used by the "My Leads" page so a
 * sales rep can see only the leads currently assigned to them.
 */
export async function listMyAssignments(userId: string): Promise<AssignmentRowWithAssignee[]> {
  if (AUTH_PROVIDER === 'local') {
    return queryAssignedLeadsFromDB('AND ml.assigned_user_id = $1::uuid', [userId]);
  }
  const { data, error } = await getSupabaseAdmin()
    .from(ASSIGNMENTS_TABLE)
    .select(SELECT_WITH_ASSIGNEE)
    .eq('assigned_to', userId)
    .order('assigned_at', { ascending: false });
  if (error) throw fromPostgrestError(error);
  return asJoinedMany(data);
}

/**
 * All assignments, optionally scoped to a set of org IDs.
 *
 * Pass orgIds from resolveActorOrgIds:
 *   null / undefined → no filter (super_admin sees all)
 *   []               → empty result (actor has no accessible orgs)
 *   [uuid, ...]      → restrict to those orgs
 */
export async function listAllAssignments(orgIds?: string[] | null): Promise<AssignmentRowWithAssignee[]> {
  if (AUTH_PROVIDER === 'local') {
    if (orgIds && orgIds.length === 0) return [];
    if (orgIds) return queryAssignedLeadsFromDB('AND ml.org_id = ANY($1::uuid[])', [orgIds]);
    return queryAssignedLeadsFromDB('', []); // null/undefined → no filter
  }

  const { data, error } = await getSupabaseAdmin()
    .from(ASSIGNMENTS_TABLE)
    .select(SELECT_WITH_ASSIGNEE)
    .order('assigned_at', { ascending: false });

  if (error) throw fromPostgrestError(error);
  return asJoinedMany(data);
}

// `Assignment` re-exported for callers that need the bare DB shape (none
// in current code, but kept available in case a future caller wants the
// un-joined record).
export type { Assignment };
