/**
 * GET /api/leads/[id]/assignments - Get assignment history for a lead
 */
import { NextResponse } from "next/server";
import { withRoute } from "@/src/lib/api/route-handler";
import * as assignmentsQueries from "@/src/lib/db/queries/assignments";

export const dynamic = "force-dynamic";

export const GET = withRoute<{ id: string }>(async (_req, session, { id: leadId }) => {
  const timeline = await assignmentsQueries.getAssignmentTimeline(session.orgId, session.id, leadId);
  return NextResponse.json({ timeline }, { status: 200 });
});
