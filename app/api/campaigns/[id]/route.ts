/**
 * GET /api/campaigns/[id] - Get single campaign
 * PATCH /api/campaigns/[id] - Update campaign
 * DELETE /api/campaigns/[id] - Soft-delete campaign
 */
import { NextResponse, type NextRequest } from "next/server";
import { withRoute } from "@/src/lib/api/route-handler";
import * as campaignsQueries from "@/src/lib/db/queries/campaigns";
import { z } from "zod";

export const dynamic = "force-dynamic";

const updateCampaignSchema = z.object({
  name: z.string().max(255).optional(),
  platformName: z.string().optional(),
  statusName: z.string().optional(),
  budget: z.number().optional(),
  startDate: z.string().datetime().optional(),
  endDate: z.string().datetime().optional(),
  metadata: z.record(z.string(), z.unknown()).optional(),
});

export const GET = withRoute<{ id: string }>(async (_req, session, { id }) => {
  const campaign = await campaignsQueries.getCampaignById(session.orgId, session.id, id);
  if (!campaign) return NextResponse.json({ error: "Campaign not found" }, { status: 404 });
  return NextResponse.json(campaign, { status: 200 });
});

export const PATCH = withRoute<{ id: string }>(async (req: NextRequest, session, { id }) => {
  const body = await req.json();
  const parsed = updateCampaignSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid request body", details: parsed.error.issues },
      { status: 400 },
    );
  }
  const result = await campaignsQueries.updateCampaign(session.orgId, session.id, id, parsed.data);
  if (!result) return NextResponse.json({ error: "Campaign not found" }, { status: 404 });
  return NextResponse.json({ id: result.id }, { status: 200 });
});

export const DELETE = withRoute<{ id: string }>(async (_req, session, { id }) => {
  await campaignsQueries.deleteCampaign(session.orgId, session.id, id);
  return NextResponse.json({ success: true }, { status: 200 });
});
