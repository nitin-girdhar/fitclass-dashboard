import { withOrgTx, withServiceTx } from "../transaction";
import type { LeadStatusLogEntry, TimelineEvent } from "@/src/types/db";

let _followupRequiredCache: Set<string> | null = null;

/** Bust the in-memory followup_required cache (called by the admin toggle route). */
export function bustFollowupRequiredCache(): void {
  _followupRequiredCache = null;
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
        os.name  AS old_stage_name,
        ns.name  AS new_stage_name,
        cb.full_name AS changed_by_name
      FROM lead_status_log lsl
      JOIN  lead_stage ns ON ns.id = lsl.new_stage_id
      LEFT JOIN lead_stage os ON os.id = lsl.old_stage_id
      LEFT JOIN users cb ON cb.id = lsl.changed_by_id
      WHERE lsl.lead_id = ${leadId}
        AND lsl.org_id  = ${orgId}
      ORDER BY lsl.changed_at DESC
    `;
  });
}

/**
 * Return the set of stage names that require a follow-up to be scheduled.
 * Module-level cached — constant at runtime; busted only on admin toggle.
 */
export async function getStagesRequiringFollowup(): Promise<Set<string>> {
  if (_followupRequiredCache) return _followupRequiredCache;
  return withServiceTx(async (tx) => {
    const rows = await tx<{ name: string }[]>`
      SELECT name FROM lead_stage WHERE followup_required = TRUE
    `;
    _followupRequiredCache = new Set(rows.map((r: { name: string }) => r.name));
    return _followupRequiredCache;
  });
}
