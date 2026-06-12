/**
 * Follow-up queries — CRUD operations on lead_follow_ups.
 */
import { withOrgTx, withServiceTx } from "../transaction";
import { resolveLookupId } from "./lookups";
import type { FollowUp, FollowUpEnriched } from "@/src/types/db";

/**
 * Get follow-ups for a lead.
 */
export async function getFollowUpsByLead(
  orgId: string,
  userId: string,
  leadId: string,
) {
  return withOrgTx(orgId, userId, async (tx) => {
    return tx`
      SELECT lf.*, fs.name as status_name, u.full_name as assigned_rep_name
      FROM lead_follow_ups lf
      JOIN follow_up_statuses fs ON fs.id = lf.status_id
      LEFT JOIN users u ON u.id = lf.assigned_user_id
      WHERE lf.lead_id = ${leadId} AND lf.org_id = ${orgId} AND NOT lf.is_deleted
      ORDER BY lf.scheduled_at ASC
    `;
  });
}

/**
 * Get all pending follow-ups for an org (pipeline view).
 */
export async function getFollowUpPipeline(
  orgId: string,
  userId: string,
  assignedRepEmail?: string,
) {
  return withOrgTx(orgId, userId, async (tx) => {
    if (assignedRepEmail) {
      return tx`
        SELECT * FROM vw_sales_follow_up_pipeline
        WHERE org_id = ${orgId} AND assigned_rep_email = ${assignedRepEmail}
        ORDER BY scheduled_at ASC
      `;
    }
    return tx`
      SELECT * FROM vw_sales_follow_up_pipeline
      WHERE org_id = ${orgId}
      ORDER BY scheduled_at ASC
    `;
  });
}

/**
 * Create a new follow-up.
 */
export async function createFollowUp(
  orgId: string,
  userId: string,
  leadId: string,
  data: any,
) {
  return withOrgTx(orgId, userId, async (tx) => {
    const statusId = await resolveLookupId("follow_up_statuses", "pending");

    const [result] = await tx`
      INSERT INTO lead_follow_ups 
        (org_id, lead_id, assigned_user_id, scheduled_at, status_id, notes)
      VALUES 
        (${orgId}, ${leadId}, ${data.assignedUserId}, ${data.scheduledAt}, ${statusId}, ${data.notes ?? null})
      RETURNING id
    `;
    return result;
  });
}

/**
 * Update a follow-up (mark complete, reschedule, etc).
 */
export async function updateFollowUp(
  orgId: string,
  userId: string,
  followUpId: string,
  data: any,
) {
  return withOrgTx(orgId, userId, async (tx) => {
    const updates: any = {};

    if (data.statusName !== undefined) {
      updates.status_id = await resolveLookupId(
        "follow_up_statuses",
        data.statusName,
      );
      if (data.statusName === "completed") {
        updates.completed_at = new Date();
      } else {
        updates.completed_at = null;
      }
    }
    if (data.scheduledAt !== undefined) updates.scheduled_at = data.scheduledAt;
    if (data.notes !== undefined) updates.notes = data.notes;

    if (Object.keys(updates).length === 0) return null;

    const [result] = await tx`
      UPDATE lead_follow_ups 
      SET ${tx(updates)}
      WHERE id = ${followUpId} AND org_id = ${orgId} AND NOT is_deleted
      RETURNING id
    `;
    return result;
  });
}

/**
 * Soft-delete a follow-up.
 */
export async function deleteFollowUp(
  orgId: string,
  userId: string,
  followUpId: string,
) {
  return withOrgTx(orgId, userId, async (tx) => {
    await tx`DELETE FROM lead_follow_ups WHERE id = ${followUpId} AND org_id = ${orgId}`;
  });
}

/**
 * Create a follow-up within an existing transaction (for atomic status change).
 * Caller is responsible for the surrounding withOrgTx.
 */
export async function createFollowUpInTx(
  orgId: string,
  leadId: string,
  assignedUserId: string,
  scheduledAt: string,
  notes: string | null,
  tx: any,
): Promise<{ id: string }> {
  const [row] = await tx<{ id: string }[]>`
    INSERT INTO lead_follow_ups
      (org_id, lead_id, assigned_user_id, status_id, scheduled_at, notes)
    SELECT
      ${orgId}, ${leadId}, ${assignedUserId},
      fs.id, ${scheduledAt}::timestamptz, ${notes}
    FROM follow_up_statuses fs
    WHERE fs.name = 'pending'
    RETURNING id
  `;
  return row;
}

/** Mark a follow-up as completed (sets status + completed_at). */
export async function completeFollowUp(
  orgId: string,
  userId: string,
  followUpId: string,
  notes: string | null,
): Promise<void> {
  await withOrgTx(orgId, userId, async (tx) => {
    await tx`
      UPDATE lead_follow_ups
      SET
        status_id    = (SELECT id FROM follow_up_statuses WHERE name = 'completed'),
        completed_at = CLOCK_TIMESTAMP(),
        notes        = COALESCE(${notes}, notes)
      WHERE id     = ${followUpId}
        AND org_id = ${orgId}
        AND NOT is_deleted
    `;
  });
}

/** Reschedule a follow-up to a new datetime. */
export async function rescheduleFollowUp(
  orgId: string,
  userId: string,
  followUpId: string,
  newScheduledAt: string,
  notes: string | null,
): Promise<void> {
  await withOrgTx(orgId, userId, async (tx) => {
    await tx`
      UPDATE lead_follow_ups
      SET
        status_id    = (SELECT id FROM follow_up_statuses WHERE name = 'rescheduled'),
        scheduled_at = ${newScheduledAt}::timestamptz,
        notes        = COALESCE(${notes}, notes)
      WHERE id     = ${followUpId}
        AND org_id = ${orgId}
        AND NOT is_deleted
    `;
  });
}

/**
 * Enriched follow-up pipeline from vw_followup_pipeline_enriched.
 * Uses the new view added by migration 002.
 */
export async function getFollowUpPipelineEnriched(
  orgId: string,
  userId: string,
  opts?: { assignedRepId?: string; overdueOnly?: boolean },
): Promise<FollowUpEnriched[]> {
  return withOrgTx(orgId, userId, async (tx) => {
    const assignedRepId = opts?.assignedRepId;
    const overdueOnly = opts?.overdueOnly ?? false;

    if (assignedRepId && overdueOnly) {
      return tx<FollowUpEnriched[]>`
        SELECT * FROM vw_followup_pipeline_enriched
        WHERE org_id = ${orgId}
          AND assigned_rep_id = ${assignedRepId}
          AND is_overdue = TRUE
        ORDER BY scheduled_at ASC
      `;
    }
    if (assignedRepId) {
      return tx<FollowUpEnriched[]>`
        SELECT * FROM vw_followup_pipeline_enriched
        WHERE org_id = ${orgId}
          AND assigned_rep_id = ${assignedRepId}
        ORDER BY is_overdue DESC, scheduled_at ASC
      `;
    }
    if (overdueOnly) {
      return tx<FollowUpEnriched[]>`
        SELECT * FROM vw_followup_pipeline_enriched
        WHERE org_id = ${orgId}
          AND is_overdue = TRUE
        ORDER BY scheduled_at ASC
      `;
    }
    return tx<FollowUpEnriched[]>`
      SELECT * FROM vw_followup_pipeline_enriched
      WHERE org_id = ${orgId}
      ORDER BY is_overdue DESC, scheduled_at ASC
    `;
  });
}

/**
 * Background job: mark pending follow-ups that are 2+ hours overdue as 'missed'.
 * Run via cron — uses service pool to bypass RLS.
 */
export async function markOverdueFollowUpsAsMissed(): Promise<number> {
  const result = await withServiceTx(async (tx) => {
    return tx`
      UPDATE lead_follow_ups
      SET status_id = (SELECT id FROM follow_up_statuses WHERE name = 'missed')
      WHERE status_id = (SELECT id FROM follow_up_statuses WHERE name = 'pending')
        AND scheduled_at < CLOCK_TIMESTAMP() - INTERVAL '2 hours'
        AND NOT is_deleted
    `;
  });
  return (result as any).count ?? 0;
}
