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
 * sales_rep can only see their own follow-ups regardless of params.
 */
import { NextRequest, NextResponse } from "next/server";
import { requireSession } from "@/src/lib/auth/session";
import { getFollowUpPipelineEnriched } from "@/src/lib/db/queries/followups";
import { isSalesRole } from "@/src/features/auth/constants";
import { AppError } from "@/src/lib/errors";

export const dynamic = "force-dynamic";

const AUTH_PROVIDER = process.env.AUTH_PROVIDER ?? "supabase";

export async function GET(req: NextRequest) {
  try {
    if (AUTH_PROVIDER !== "local") {
      return NextResponse.json(
        { error: "PostgreSQL auth not enabled" },
        { status: 400 },
      );
    }

    const gate = await requireSession();
    if (!gate.ok) return gate.response;

    const { searchParams } = new URL(req.url);
    const assignedRepId = searchParams.get("assignedRepId") ?? undefined;
    const overdueOnly = searchParams.get("overdueOnly") === "true";

    // Individual-contributor sales roles may only view their own pipeline
    const effectiveRepId = isSalesRole(gate.session.role)
      ? gate.session.id
      : assignedRepId;

    const pipeline = await getFollowUpPipelineEnriched(
      gate.session.orgId,
      gate.session.id,
      { assignedRepId: effectiveRepId, overdueOnly },
    );

    return NextResponse.json({ pipeline }, { status: 200 });
  } catch (err) {
    console.error("[GET /api/follow-ups]", err);
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
