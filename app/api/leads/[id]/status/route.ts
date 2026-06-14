/**
 * PATCH /api/leads/[id]/status
 *
 * Atomic stage transition: updates lead.stage_id, auto-logs via DB trigger,
 * and (if the new status requires_followup) creates a follow-up in the same
 * transaction.  If any step fails the whole operation is rolled back.
 */
import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { withRoute } from "@/src/lib/api/route-handler";
import { withOrgTx } from "@/src/lib/db/transaction";
import { createFollowUpInTx } from "@/src/lib/db/queries/followups";
import { ForbiddenError, NotFoundError, ValidationError } from "@/src/lib/errors";

export const dynamic = "force-dynamic";

const statusChangeSchema = z.object({
  newStage: z.string().min(1),
  outcomeId: z.number().int().positive().optional().nullable(),
  outcomeComment: z.string().max(2000).optional().nullable(),
  transitionNote: z.string().max(1000).optional().nullable(),
  followUp: z
    .object({
      assignedUserId: z.string(),
      scheduledAt: z.string().datetime(),
      notes: z.string().max(2000).optional().nullable(),
    })
    .optional()
    .nullable(),
});

export const PATCH = withRoute<{ id: string }>(async (req: NextRequest, session, { id: leadId }) => {
  const body = await req.json();
  const parsed = statusChangeSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid request body", details: parsed.error.issues },
      { status: 400 },
    );
  }

  const data = parsed.data;

  const result = await withOrgTx(session.orgId, session.id, async (tx) => {
    // 1. Verify the lead exists in this org
    const [lead] = await tx`
      SELECT id, org_id, stage_id, assigned_user_id
      FROM marketing_leads
      WHERE id = ${leadId} AND org_id = ${session.orgId} AND NOT is_deleted
    `;
    if (!lead) throw new NotFoundError("Lead not found");

    // 2. Resolve the new stage
    const [newStage] = await tx`
      SELECT id, name, followup_required, is_rejected, is_terminated
      FROM lead_stage
      WHERE name = ${data.newStage}
    `;
    if (!newStage) throw new ValidationError(`Unknown stage: ${data.newStage}`);

    // 3. Validate outcome consistency
    if (newStage.is_rejected && !data.outcomeId) {
      throw new ValidationError("An outcome is required when marking a lead as unqualified.");
    }
    if (!newStage.is_rejected && !newStage.followup_required && data.outcomeId) {
      throw new ValidationError("Outcome cannot be set for this stage.");
    }

    // 4. Validate follow-up is provided when required
    if (newStage.followup_required && !data.followUp) {
      throw new ValidationError(
        `Stage '${newStage.name}' requires a follow-up to be scheduled. Please provide follow-up details.`,
      );
    }

    // 5. Verify hierarchy authority for the follow-up assignee
    if (data.followUp?.assignedUserId) {
      const [allowed] = await tx`
        SELECT can_assign_to(
          ${session.orgId}::uuid,
          ${session.id}::uuid,
          ${data.followUp.assignedUserId}::uuid
        ) AS allowed
      `;
      if (!allowed?.allowed) {
        throw new ForbiddenError("You do not have authority to assign a follow-up to this user.");
      }
    }

    // 6. Publish transition note so the SECURITY DEFINER trigger can capture it
    // SET LOCAL does not support parameterized values — escape single quotes manually.
    if (data.transitionNote) {
      const escaped = data.transitionNote.replace(/'/g, "''");
      await tx.unsafe(`SET LOCAL app.lead_transition_note = '${escaped}'`);
    }

    // 7. Update lead — trigger fires here and writes to lead_status_log
    await tx`
      UPDATE marketing_leads
      SET
        stage_id        = ${newStage.id},
        outcome_id      = ${data.outcomeId ?? null},
        outcome_comment = ${data.outcomeComment ?? null}
      WHERE id = ${leadId}
    `;

    // 8. Clear the note so subsequent statements in this tx don't re-use it
    await tx`SET LOCAL app.lead_transition_note = ''`;

    // 9. Create follow-up in the same transaction (atomic with the status change)
    let followUpId: string | null = null;
    if (data.followUp) {
      const fu = await createFollowUpInTx(
        session.orgId,
        leadId,
        data.followUp.assignedUserId,
        data.followUp.scheduledAt,
        data.followUp.notes ?? null,
        tx,
      );
      followUpId = fu.id;
    }

    return { success: true, followUpId };
  });

  return NextResponse.json(result, { status: 200 });
});
