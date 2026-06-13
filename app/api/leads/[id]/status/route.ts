/**
 * PATCH /api/leads/[id]/status
 *
 * Atomic status transition: updates lead.status_id, auto-logs via DB trigger,
 * and (if the new status requires_followup) creates a follow-up in the same
 * transaction.  If any step fails the whole operation is rolled back.
 *
 * app.lead_transition_note is set via SET LOCAL so the SECURITY DEFINER
 * trigger function can read it even though app_user cannot write
 * lead_status_log directly.
 */
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireSession } from "@/src/lib/auth/session";
import { withOrgTx } from "@/src/lib/db/transaction";
import { createFollowUpInTx } from "@/src/lib/db/queries/followups";
import {
  AppError,
  ForbiddenError,
  NotFoundError,
  ValidationError,
} from "@/src/lib/errors";

export const dynamic = "force-dynamic";

const AUTH_PROVIDER = process.env.AUTH_PROVIDER ?? "supabase";

const statusChangeSchema = z.object({
  newStatus: z.string().min(1),
  failReasonId: z.number().int().positive().optional().nullable(),
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

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    if (AUTH_PROVIDER !== "local") {
      return NextResponse.json(
        { error: "PostgreSQL auth not enabled" },
        { status: 400 },
      );
    }

    const gate = await requireSession();
    if (!gate.ok) return gate.response;

    const body = await req.json();
    const parsed = statusChangeSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { error: "Invalid request body", details: parsed.error.issues },
        { status: 400 },
      );
    }

    const { id: leadId } = await params;
    const session = gate.session;
    const data = parsed.data;

    const result = await withOrgTx(session.orgId, session.id, async (tx) => {
      // 1. Verify the lead exists in this org
      const [lead] = await tx`
        SELECT id, org_id, status_id, assigned_user_id
        FROM marketing_leads
        WHERE id = ${leadId} AND org_id = ${session.orgId} AND NOT is_deleted
      `;
      if (!lead) throw new NotFoundError("Lead not found");

      // 2. Resolve the new status
      const [newStatus] = await tx`
        SELECT id, name, requires_followup, is_rejection
        FROM lead_statuses
        WHERE name = ${data.newStatus}
      `;
      if (!newStatus) {
        throw new ValidationError(`Unknown status: ${data.newStatus}`);
      }

      // 3. Validate fail_reason consistency (data-driven: is_rejection flag, not hardcoded name)
      if (newStatus.is_rejection && !data.failReasonId) {
        throw new ValidationError(
          "A fail reason is required when marking a lead as rejected.",
        );
      }
      if (!newStatus.is_rejection && data.failReasonId) {
        throw new ValidationError(
          "Fail reason should only be set for rejection statuses.",
        );
      }

      // 4. Validate follow-up is provided when required
      if (newStatus.requiresFollowup && !data.followUp) {
        throw new ValidationError(
          `Status '${newStatus.name}' requires a follow-up to be scheduled. ` +
            `Please provide follow-up details.`,
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
          throw new ForbiddenError(
            "You do not have authority to assign a follow-up to this user.",
          );
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
          status_id      = ${newStatus.id},
          fail_reason_id = ${data.failReasonId ?? null}
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
  } catch (err) {
    console.error("[PATCH /api/leads/[id]/status]", err);
    if (err instanceof AppError) {
      return NextResponse.json(
        { error: err.message },
        { status: err.statusCode },
      );
    }
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 },
    );
  }
}
