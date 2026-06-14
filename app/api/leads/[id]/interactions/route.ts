/**
 * GET /api/leads/[id]/interactions - Get interactions for a lead
 * POST /api/leads/[id]/interactions - Create interaction
 */
import { NextResponse, type NextRequest } from "next/server";
import { withRoute } from "@/src/lib/api/route-handler";
import * as interactionsQueries from "@/src/lib/db/queries/interactions";
import { z } from "zod";

export const dynamic = "force-dynamic";

const createInteractionSchema = z.object({
  interactionTypeName: z.string(),
  notes: z.string().optional(),
  occurredAt: z.string().datetime().optional(),
});

export const GET = withRoute<{ id: string }>(async (_req, session, { id: leadId }) => {
  const interactions = await interactionsQueries.getInteractionsByLead(
    session.orgId,
    session.id,
    leadId,
  );
  return NextResponse.json({ interactions }, { status: 200 });
});

export const POST = withRoute<{ id: string }>(async (req: NextRequest, session, { id: leadId }) => {
  const body = await req.json();
  const parsed = createInteractionSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid request body", details: parsed.error.issues },
      { status: 400 },
    );
  }
  const result = await interactionsQueries.createInteraction(
    session.orgId,
    session.id,
    leadId,
    parsed.data,
  );
  return NextResponse.json({ id: result.id }, { status: 201 });
});
