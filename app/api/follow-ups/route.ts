/**
 * GET /api/follow-ups
 *
 * Org-wide follow-up pipeline using the enriched view added in migration 002.
 * Includes lead status, overdue flag, minutes_overdue, and last interaction.
 *
 * Query params:
 *   assignedRepId  — filter to a specific user's follow-ups
 *   overdueOnly    — 'true' to return only overdue entries
 *
 * sales_representative can only see their own follow-ups regardless of params.
 */
import { NextResponse } from "next/server";
import { withRoute } from "@/src/lib/api/route-handler";
import { getFollowUpPipelineEnriched } from "@/src/lib/db/queries/followups";
import { isSalesRole } from "@/src/features/auth/constants";

export const dynamic = "force-dynamic";

export const GET = withRoute(async (req, session) => {
  const { searchParams } = new URL(req.url);
  const assignedRepId = searchParams.get("assignedRepId") ?? undefined;
  const overdueOnly = searchParams.get("overdueOnly") === "true";

  // Individual-contributor sales roles may only view their own pipeline
  const effectiveRepId = isSalesRole(session.role) ? session.id : assignedRepId;

  const pipeline = await getFollowUpPipelineEnriched(
    session.orgId,
    session.id,
    { assignedRepId: effectiveRepId, overdueOnly },
  );
  return NextResponse.json({ pipeline }, { status: 200 });
});
