/**
 * Assignment queries — view assignment history and log.
 */
import { withOrgTx } from "../transaction";
import type { User } from "@/src/types/db";

/**
 * Get assignment history for a lead.
 */
export async function getAssignmentTimeline(
  orgId: string,
  userId: string,
  leadId: string,
) {
  return withOrgTx(orgId, userId, async (tx) => {
    return tx`
      SELECT * FROM vw_lead_assignment_timeline
      WHERE lead_id = ${leadId} AND org_id = ${orgId}
      ORDER BY assigned_at DESC
    `;
  });
}

/**
 * Get assignment log entries (audit trail).
 */
export async function getAssignmentLog(
  orgId: string,
  userId: string,
  filters: { leadId?: string; assignedUserId?: string; limit?: number } = {},
) {
  return withOrgTx(orgId, userId, async (tx) => {
    const limit = Math.min(filters.limit ?? 100, 1000);

    const conditions: string[] = ["org_id = $1"];
    const params: unknown[] = [orgId];

    if (filters.leadId) {
      params.push(filters.leadId);
      conditions.push(`lead_id = $${params.length}`);
    }
    if (filters.assignedUserId) {
      params.push(filters.assignedUserId);
      conditions.push(`new_assigned_user_id = $${params.length}`);
    }

    params.push(limit);
    const limitPos = params.length;

    return tx.unsafe(
      `SELECT * FROM lead_assignment_log
       WHERE ${conditions.join(" AND ")}
       ORDER BY assigned_at DESC
       LIMIT $${limitPos}`,
      params,
    );
  });
}
