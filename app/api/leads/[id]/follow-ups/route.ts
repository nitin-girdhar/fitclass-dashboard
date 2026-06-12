/**
 * GET /api/leads/[leadId]/follow-ups - Get follow-ups for a lead
 * POST /api/leads/[leadId]/follow-ups - Create follow-up
 */
import { NextRequest, NextResponse } from "next/server";
import { requireSession } from "@/src/lib/auth/session";
import * as followupsQueries from "@/src/lib/db/queries/followups";
import { AppError } from "@/src/lib/errors";
import { z } from "zod";

export const dynamic = "force-dynamic";

const AUTH_PROVIDER = process.env.AUTH_PROVIDER ?? "supabase";

const createFollowUpSchema = z.object({
  statusName: z.string().optional(),
  scheduledAt: z.string().datetime(),
  notes: z.string().optional(),
  assignedUserId: z.string().uuid().optional(),
});

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
    const followups = await followupsQueries.getFollowUpsByLead(
      userOrgId,
      gate.session.id,
      leadId,
    );

    return NextResponse.json({ followups }, { status: 200 });
  } catch (err) {
    console.error("[GET /api/leads/[leadId]/follow-ups]", err);
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

export async function POST(
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

    const body = await req.json();
    const parsed = createFollowUpSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { error: "Invalid request body", details: parsed.error.issues },
        { status: 400 },
      );
    }

    const { id: leadId } = await params;
    const userOrgId = gate.session.orgId;
    const result = await followupsQueries.createFollowUp(
      userOrgId,
      gate.session.id,
      leadId,
      parsed.data,
    );

    return NextResponse.json({ id: result.id }, { status: 201 });
  } catch (err) {
    console.error("[POST /api/leads/[leadId]/follow-ups]", err);
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
