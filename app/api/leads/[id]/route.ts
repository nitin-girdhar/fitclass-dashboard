/**
 * GET /api/leads/[id] - Get a single lead
 * PATCH /api/leads/[id] - Update lead (status, assignment, metadata)
 * DELETE /api/leads/[id] - Soft-delete a lead
 */
import { NextResponse, type NextRequest } from "next/server";
import { withRoute } from "@/src/lib/api/route-handler";
import * as leadsQueries from "@/src/lib/db/queries/leads";
import { z } from "zod";

export const dynamic = "force-dynamic";

const updateLeadSchema = z.object({
  stageId: z.number().optional(),
  outcomeId: z.number().optional(),
  assignedUserId: z.string().nullable().optional(),
  transitionNote: z.string().max(1000).optional().nullable(),
  metadata: z.record(z.string(), z.unknown()).optional(),
  tags: z.array(z.string()).optional(),
});

export const GET = withRoute<{ id: string }>(async (_req, session, { id }) => {
  const lead = await leadsQueries.getLeadById(session.orgId, session.id, id);
  if (!lead) return NextResponse.json({ error: "Lead not found" }, { status: 404 });
  return NextResponse.json(lead, { status: 200 });
});

export const PATCH = withRoute<{ id: string }>(async (req: NextRequest, session, { id }) => {
  const body = await req.json();
  const parsed = updateLeadSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid request body", details: parsed.error.issues },
      { status: 400 },
    );
  }

  try {
    const result = await leadsQueries.updateLead(session.orgId, session.id, id, parsed.data);
    if (!result) return NextResponse.json({ error: "Lead not found" }, { status: 404 });
    return NextResponse.json({ id: result.id }, { status: 200 });
  } catch (err) {
    const msg = (err as any)?.message ?? "";
    if (msg.includes("Insufficient hierarchy authority")) {
      return NextResponse.json(
        { error: "You do not have permission to assign this lead." },
        { status: 403 },
      );
    }
    if (msg.includes("outcome_id")) {
      return NextResponse.json(
        { error: "An outcome must be selected when marking a lead as unqualified." },
        { status: 400 },
      );
    }
    throw err;
  }
});

export const DELETE = withRoute<{ id: string }>(async (_req, session, { id }) => {
  await leadsQueries.deleteLead(session.orgId, session.id, id);
  return NextResponse.json({ success: true }, { status: 200 });
});
