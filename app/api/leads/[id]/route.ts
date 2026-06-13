/**
 * GET /api/leads/[id] - Get a single lead
 * PATCH /api/leads/[id] - Update lead (status, assignment, metadata)
 * DELETE /api/leads/[id] - Soft-delete a lead
 */
import { NextRequest, NextResponse } from "next/server";
import { requireSession } from "@/src/lib/auth/session";
import * as leadsQueries from "@/src/lib/db/queries/leads";
import {
  AppError,
  NotFoundError,
  ForbiddenError,
  ValidationError,
} from "@/src/lib/errors";
import { z } from "zod";

export const dynamic = "force-dynamic";

const AUTH_PROVIDER = process.env.AUTH_PROVIDER ?? "supabase";

const updateLeadSchema = z.object({
  statusId: z.number().optional(),
  failReasonId: z.number().optional(),
  assignedUserId: z.string().nullable().optional(),
  transitionNote: z.string().max(1000).optional().nullable(),
  metadata: z.record(z.string(), z.unknown()).optional(),
  tags: z.array(z.string()).optional(),
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

    const { id } = await params;
    const userOrgId = gate.session.orgId;
    const lead = await leadsQueries.getLeadById(userOrgId, gate.session.id, id);

    if (!lead) {
      return NextResponse.json({ error: "Lead not found" }, { status: 404 });
    }

    return NextResponse.json(lead, { status: 200 });
  } catch (err) {
    console.error("[GET /api/leads/[id]]", err);
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

export async function PATCH(
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
    const parsed = updateLeadSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { error: "Invalid request body", details: parsed.error.issues },
        { status: 400 },
      );
    }

    const { id } = await params;
    const userOrgId = gate.session.orgId;
    const result = await leadsQueries.updateLead(
      userOrgId,
      gate.session.id,
      id,
      parsed.data,
    );

    if (!result) {
      return NextResponse.json({ error: "Lead not found" }, { status: 404 });
    }

    return NextResponse.json({ id: result.id }, { status: 200 });
  } catch (err) {
    console.error("[PATCH /api/leads/[id]]", err);
    if (err instanceof AppError) {
      return NextResponse.json(
        { error: err.message },
        { status: err.statusCode },
      );
    }

    const errorMessage = (err as any)?.message || "";
    if (errorMessage.includes("Insufficient hierarchy authority")) {
      return NextResponse.json(
        { error: "You do not have permission to assign this lead." },
        { status: 403 },
      );
    }
    if (errorMessage.includes("fail_reason")) {
      return NextResponse.json(
        {
          error:
            "A fail reason must be selected when marking a lead as failed.",
        },
        { status: 400 },
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
    const userOrgId = gate.session.orgId;
    await leadsQueries.deleteLead(userOrgId, gate.session.id, id);

    return NextResponse.json({ success: true }, { status: 200 });
  } catch (err) {
    console.error("[DELETE /api/leads/[id]]", err);
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
