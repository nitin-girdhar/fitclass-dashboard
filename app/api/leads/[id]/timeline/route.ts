/**
 * GET /api/leads/[id]/timeline
 * Unified chronological timeline: status changes + follow-up entries.
 */
import { NextResponse } from "next/server";
import { withRoute } from "@/src/lib/api/route-handler";
import { getLeadTimeline } from "@/src/lib/db/queries/status-log";

export const dynamic = "force-dynamic";

export const GET = withRoute<{ id: string }>(async (_req, session, { id: leadId }) => {
  const timeline = await getLeadTimeline(session.orgId, session.id, leadId);
  return NextResponse.json({ timeline }, { status: 200 });
});
