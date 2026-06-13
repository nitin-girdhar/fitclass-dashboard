import { withOrgTx, withServiceTx } from "../transaction";
import type { LeadStatusLogEntry, TimelineEvent } from "@/src/types/db";

let _requiresFollowupCache: Set<string> | null = null;

/** Bust the in-memory requires_followup cache (called by the admin toggle route). */
export function bustRequiresFollowupCache(): void {
  _requiresFollowupCache = null;
}

/** Unified chronological timeline for a lead: status changes + follow-up entries. */
export async function getLeadTimeline(
  orgId: string,
  userId: string,
  leadId: string,
): Promise<TimelineEvent[]> {
  return withOrgTx(orgId, userId, async (tx) => {
    // Use tx.unsafe() — tagged-template tx`` does not reliably apply the
    // camelCase transform for view queries in this postgres.js setup.
    const rows = await tx.unsafe(
      `SELECT * FROM vw_lead_followup_timeline
       WHERE lead_id = $1 AND org_id = $2
       ORDER BY event_at DESC`,
      [leadId, orgId],
    );
    // Belt-and-suspenders: manually convert snake_case keys to camelCase in
    // case the pool's transform isn't inherited by the transaction wrapper.
    return rows.map(snakeToCamel) as unknown as TimelineEvent[];
  });
}

function snakeToCamel(row: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(row)) {
    const camel = k.replace(/_([a-z])/g, (_, c: string) => c.toUpperCase());
    out[camel] = v;
  }
  return out;
}

/** Status-change-only log for a lead (audit/export). */
export async function getLeadStatusLog(
  orgId: string,
  userId: string,
  leadId: string,
): Promise<LeadStatusLogEntry[]> {
  return withOrgTx(orgId, userId, async (tx) => {
    return tx<LeadStatusLogEntry[]>`
      SELECT
        lsl.*,
        os.name  AS old_status_name,
        ns.name  AS new_status_name,
        cb.full_name AS changed_by_name
      FROM lead_status_log lsl
      JOIN  lead_statuses ns ON ns.id = lsl.new_status_id
      LEFT JOIN lead_statuses os ON os.id = lsl.old_status_id
      LEFT JOIN users cb ON cb.id = lsl.changed_by_id
      WHERE lsl.lead_id = ${leadId}
        AND lsl.org_id  = ${orgId}
      ORDER BY lsl.changed_at DESC
    `;
  });
}

/**
 * Return the set of status names that require a follow-up to be scheduled.
 * Module-level cached — constant at runtime; busted only on admin toggle.
 */
export async function getStatusesRequiringFollowup(): Promise<Set<string>> {
  if (_requiresFollowupCache) return _requiresFollowupCache;
  return withServiceTx(async (tx) => {
    const rows = await tx<{ name: string }[]>`
      SELECT name FROM lead_statuses WHERE requires_followup = TRUE
    `;
    _requiresFollowupCache = new Set(rows.map((r: { name: string }) => r.name));
    return _requiresFollowupCache;
  });
}
