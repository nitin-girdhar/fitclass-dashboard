/**
 * PATCH /api/follow-ups/[followUpId] - Update follow-up status/scheduling
 * DELETE /api/follow-ups/[followUpId] - Soft-delete follow-up
 */
import { NextResponse, type NextRequest } from "next/server";
import { withRoute } from "@/src/lib/api/route-handler";
import * as followupsQueries from "@/src/lib/db/queries/followups";
import { z } from "zod";

export const dynamic = "force-dynamic";

const updateFollowUpSchema = z.object({
  statusName: z.string().optional(),
  scheduledAt: z.string().datetime().optional(),
  notes: z.string().optional(),
});

export const PATCH = withRoute<{ followUpId: string }>(async (req: NextRequest, session, { followUpId }) => {
  const body = await req.json();
  const parsed = updateFollowUpSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid request body", details: parsed.error.issues },
      { status: 400 },
    );
  }
  const result = await followupsQueries.updateFollowUp(
    session.orgId,
    session.id,
    followUpId,
    parsed.data,
  );
  if (!result) return NextResponse.json({ error: "Follow-up not found" }, { status: 404 });
  return NextResponse.json({ id: result.id }, { status: 200 });
});

export const DELETE = withRoute<{ followUpId: string }>(async (_req, session, { followUpId }) => {
  await followupsQueries.deleteFollowUp(session.orgId, session.id, followUpId);
  return NextResponse.json({ success: true }, { status: 200 });
});
