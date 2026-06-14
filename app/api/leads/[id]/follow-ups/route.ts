/**
 * GET /api/leads/[id]/follow-ups - Get follow-ups for a lead
 * POST /api/leads/[id]/follow-ups - Create follow-up
 */
import { NextResponse, type NextRequest } from "next/server";
import { withRoute } from "@/src/lib/api/route-handler";
import * as followupsQueries from "@/src/lib/db/queries/followups";
import { z } from "zod";

export const dynamic = "force-dynamic";

const createFollowUpSchema = z.object({
  statusName: z.string().optional(),
  scheduledAt: z.string().datetime(),
  notes: z.string().optional(),
  assignedUserId: z.string().uuid().optional(),
});

export const GET = withRoute<{ id: string }>(async (_req, session, { id: leadId }) => {
  const followups = await followupsQueries.getFollowUpsByLead(session.orgId, session.id, leadId);
  return NextResponse.json({ followups }, { status: 200 });
});

export const POST = withRoute<{ id: string }>(async (req: NextRequest, session, { id: leadId }) => {
  const body = await req.json();
  const parsed = createFollowUpSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid request body", details: parsed.error.issues },
      { status: 400 },
    );
  }
  const result = await followupsQueries.createFollowUp(
    session.orgId,
    session.id,
    leadId,
    parsed.data,
  );
  return NextResponse.json({ id: result.id }, { status: 201 });
});
