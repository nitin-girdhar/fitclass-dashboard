/**
 * PATCH /api/follow-ups/[followUpId] - Update follow-up status/scheduling
 * DELETE /api/follow-ups/[followUpId] - Soft-delete follow-up
 */
import { NextRequest, NextResponse } from "next/server";
import { requireSession } from "@/src/lib/auth/session";
import * as followupsQueries from "@/src/lib/db/queries/followups";
import { AppError } from "@/src/lib/errors";
import { z } from "zod";

export const dynamic = "force-dynamic";

const AUTH_PROVIDER = process.env.AUTH_PROVIDER ?? "supabase";

const updateFollowUpSchema = z.object({
  statusName: z.string().optional(),
  scheduledAt: z.string().datetime().optional(),
  notes: z.string().optional(),
});

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ followUpId: string }> },
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
    const parsed = updateFollowUpSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { error: "Invalid request body", details: parsed.error.issues },
        { status: 400 },
      );
    }

    const { followUpId } = await params;
    const userOrgId = gate.session.orgId;
    const result = await followupsQueries.updateFollowUp(
      userOrgId,
      gate.session.id,
      followUpId,
      parsed.data,
    );

    if (!result) {
      return NextResponse.json(
        { error: "Follow-up not found" },
        { status: 404 },
      );
    }

    return NextResponse.json({ id: result.id }, { status: 200 });
  } catch (err) {
    console.error("[PATCH /api/follow-ups/[followUpId]]", err);
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

export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ followUpId: string }> },
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

    const { followUpId } = await params;
    const userOrgId = gate.session.orgId;
    await followupsQueries.deleteFollowUp(userOrgId, gate.session.id, followUpId);

    return NextResponse.json({ success: true }, { status: 200 });
  } catch (err) {
    console.error("[DELETE /api/follow-ups/[followUpId]]", err);
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
