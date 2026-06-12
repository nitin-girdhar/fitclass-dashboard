/**
 * GET /api/leads/[leadId]/assignments - Get assignment history for a lead
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

    const { id: leadId } = await params;
    const userOrgId = gate.session.orgId;
    const timeline = await assignmentsQueries.getAssignmentTimeline(
      userOrgId,
      gate.session.id,
      leadId,
    );

    return NextResponse.json({ timeline }, { status: 200 });
  } catch (err) {
    console.error("[GET /api/leads/[leadId]/assignments]", err);
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
