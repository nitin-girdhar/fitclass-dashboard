/**
 * GET /api/leads/[id]/assignment-history
 * Chronological assignment history for a lead via vw_lead_assignment_timeline.
 */
import { NextRequest, NextResponse } from "next/server";
import { requireSession } from "@/src/lib/auth/session";
import * as assignmentsQueries from "@/src/lib/db/queries/assignments";
import { AppError } from "@/src/lib/errors";

export const dynamic = "force-dynamic";

const AUTH_PROVIDER = process.env.AUTH_PROVIDER ?? "supabase";

export async function GET(
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

    const { id } = await params;
    const history = await assignmentsQueries.getAssignmentTimeline(
      gate.session.orgId,
      gate.session.id,
      id,
    );

    return NextResponse.json({ history }, { status: 200 });
  } catch (err) {
    console.error("[GET /api/leads/[id]/assignment-history]", err);
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
