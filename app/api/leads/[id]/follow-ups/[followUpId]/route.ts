/**
 * PATCH /api/leads/[id]/follow-ups/[followUpId]
 *
 * Action-based follow-up update. Three actions:
 *   complete   — mark done, set completed_at, optional notes
 *   reschedule — change scheduled_at (status → 'rescheduled'), optional notes
 *   add_note   — append text to existing notes without changing status
 */
import { NextResponse, type NextRequest } from "next/server";
import { withRoute } from "@/src/lib/api/route-handler";
import { completeFollowUp, rescheduleFollowUp } from "@/src/lib/db/queries/followups";
import { withOrgTx } from "@/src/lib/db/transaction";
import { NotFoundError } from "@/src/lib/errors";
import { z } from "zod";

export const dynamic = "force-dynamic";

const updateSchema = z.discriminatedUnion("action", [
  z.object({
    action: z.literal("complete"),
    notes: z.string().max(2000).optional().nullable(),
  }),
  z.object({
    action: z.literal("reschedule"),
    scheduledAt: z.string().datetime(),
    notes: z.string().max(2000).optional().nullable(),
  }),
  z.object({
    action: z.literal("add_note"),
    notes: z.string().min(1).max(2000),
  }),
]);

export const PATCH = withRoute<{ id: string; followUpId: string }>(
  async (req: NextRequest, session, { followUpId }) => {
    const body = await req.json();
    const parsed = updateSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { error: "Invalid request body", details: parsed.error.issues },
        { status: 400 },
      );
    }

    const { orgId, id: userId } = session;
    const data = parsed.data;

    if (data.action === "complete") {
      await completeFollowUp(orgId, userId, followUpId, data.notes ?? null);
    } else if (data.action === "reschedule") {
      await rescheduleFollowUp(orgId, userId, followUpId, data.scheduledAt, data.notes ?? null);
    } else {
      // add_note: append to existing notes, preserving history
      await withOrgTx(orgId, userId, async (tx) => {
        const result = await tx`
          UPDATE lead_follow_ups
          SET notes = CASE
            WHEN notes IS NULL OR notes = '' THEN ${data.notes}
            ELSE notes || E'\n\n' || ${data.notes}
          END
          WHERE id     = ${followUpId}
            AND org_id = ${orgId}
            AND NOT is_deleted
          RETURNING id
        `;
        if (!result.length) throw new NotFoundError("Follow-up not found");
      });
    }

    return NextResponse.json({ success: true }, { status: 200 });
  },
);
