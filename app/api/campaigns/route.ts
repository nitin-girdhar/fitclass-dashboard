/**
 * GET /api/campaigns - List campaigns for the org
 * POST /api/campaigns - Create a new campaign
 */
import { NextRequest, NextResponse } from "next/server";
import { requireSession } from "@/src/lib/auth/session";
import * as campaignsQueries from "@/src/lib/db/queries/campaigns";
import { AppError } from "@/src/lib/errors";
import { z } from "zod";

export const dynamic = "force-dynamic";

const AUTH_PROVIDER = process.env.AUTH_PROVIDER ?? "supabase";

const createCampaignSchema = z.object({
  name: z.string().min(1).max(255),
  platformName: z.string(),
  statusName: z.string().optional(),
  budget: z.number().optional(),
  startDate: z.string().datetime().optional(),
  endDate: z.string().datetime().optional(),
  metadata: z.record(z.string(), z.unknown()).optional(),
});

export async function GET(req: NextRequest) {
  try {
    if (AUTH_PROVIDER !== "local") {
      return NextResponse.json(
        { error: "PostgreSQL auth not enabled" },
        { status: 400 },
      );
    }

    const gate = await requireSession();
    if (!gate.ok) return gate.response;

    const userOrgId = gate.session.orgId;
    const campaigns = await campaignsQueries.getCampaigns(
      userOrgId,
      gate.session.id,
    );

    return NextResponse.json({ campaigns }, { status: 200 });
  } catch (err) {
    console.error("[GET /api/campaigns]", err);
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

export async function POST(req: NextRequest) {
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
    const parsed = createCampaignSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { error: "Invalid request body", details: parsed.error.issues },
        { status: 400 },
      );
    }

    const userOrgId = gate.session.orgId;
    const result = await campaignsQueries.createCampaign(
      userOrgId,
      gate.session.id,
      parsed.data,
    );

    return NextResponse.json({ id: result.id }, { status: 201 });
  } catch (err) {
    console.error("[POST /api/campaigns]", err);
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
