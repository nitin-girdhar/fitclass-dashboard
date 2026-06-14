/**
 * GET /api/campaigns - List campaigns for the org
 * POST /api/campaigns - Create a new campaign
 */
import { NextResponse, type NextRequest } from "next/server";
import { withRoute } from "@/src/lib/api/route-handler";
import * as campaignsQueries from "@/src/lib/db/queries/campaigns";
import { z } from "zod";

export const dynamic = "force-dynamic";

const createCampaignSchema = z.object({
  name: z.string().min(1).max(255),
  platformName: z.string(),
  statusName: z.string().optional(),
  budget: z.number().optional(),
  startDate: z.string().datetime().optional(),
  endDate: z.string().datetime().optional(),
  metadata: z.record(z.string(), z.unknown()).optional(),
});

export const GET = withRoute(async (_req, session) => {
  const campaigns = await campaignsQueries.getCampaigns(session.orgId, session.id);
  return NextResponse.json({ campaigns }, { status: 200 });
});

export const POST = withRoute(async (req: NextRequest, session) => {
  const body = await req.json();
  const parsed = createCampaignSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid request body", details: parsed.error.issues },
      { status: 400 },
    );
  }
  const result = await campaignsQueries.createCampaign(session.orgId, session.id, parsed.data);
  return NextResponse.json({ id: result.id }, { status: 201 });
});
