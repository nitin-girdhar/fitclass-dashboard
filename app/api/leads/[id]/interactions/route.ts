/**
 * GET /api/leads/[leadId]/interactions - Get interactions for a lead
 * POST /api/leads/[leadId]/interactions - Create interaction
 */
import { NextRequest, NextResponse } from "next/server";
import { requireSession } from "@/src/lib/auth/session";
import * as interactionsQueries from "@/src/lib/db/queries/interactions";
import { AppError } from "@/src/lib/errors";
import { z } from "zod";

export const dynamic = "force-dynamic";

const AUTH_PROVIDER = process.env.AUTH_PROVIDER ?? "supabase";

const createInteractionSchema = z.object({
  interactionTypeName: z.string(),
  notes: z.string().optional(),
  occurredAt: z.string().datetime().optional(),
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
    const interactions = await interactionsQueries.getInteractionsByLead(
      userOrgId,
      gate.session.id,
      leadId,
    );

    return NextResponse.json({ interactions }, { status: 200 });
  } catch (err) {
    console.error("[GET /api/leads/[leadId]/interactions]", err);
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
    const parsed = createInteractionSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { error: "Invalid request body", details: parsed.error.issues },
        { status: 400 },
      );
    }

    const { id: leadId } = await params;
    const userOrgId = gate.session.orgId;
    const result = await interactionsQueries.createInteraction(
      userOrgId,
      gate.session.id,
      leadId,
      parsed.data,
    );

    return NextResponse.json({ id: result.id }, { status: 201 });
  } catch (err) {
    console.error("[POST /api/leads/[leadId]/interactions]", err);
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
