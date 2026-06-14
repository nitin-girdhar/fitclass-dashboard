/**
 * GET /api/leads/[id]/assignment-history
 * Chronological assignment history for a lead via vw_lead_assignment_timeline.
 */
import { NextResponse } from "next/server";
import { withRoute } from "@/src/lib/api/route-handler";
import * as assignmentsQueries from "@/src/lib/db/queries/assignments";

export const dynamic = "force-dynamic";

export const GET = withRoute<{ id: string }>(async (_req, session, { id }) => {
  const history = await assignmentsQueries.getAssignmentTimeline(session.orgId, session.id, id);
  return NextResponse.json({ history }, { status: 200 });
});
