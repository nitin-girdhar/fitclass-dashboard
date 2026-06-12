/**
 * GET /api/campaigns/[id] - Get single campaign
 * PATCH /api/campaigns/[id] - Update campaign
 * DELETE /api/campaigns/[id] - Soft-delete campaign
 */
import { NextRequest, NextResponse } from "next/server";
import { requireSession } from "@/src/lib/auth/session";
import * as campaignsQueries from "@/src/lib/db/queries/campaigns";
import { AppError } from "@/src/lib/errors";
import { z } from "zod";

export const dynamic = "force-dynamic";

const AUTH_PROVIDER = process.env.AUTH_PROVIDER ?? "supabase";

const updateCampaignSchema = z.object({
  name: z.string().max(255).optional(),
  platformName: z.string().optional(),
  statusName: z.string().optional(),
  budget: z.number().optional(),
  startDate: z.string().datetime().optional(),
  endDate: z.string().datetime().optional(),
  metadata: z.record(z.string(), z.unknown()).optional(),
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
    const campaign = await campaignsQueries.getCampaignById(
      userOrgId,
      gate.session.id,
      id,
    );

    if (!campaign) {
      return NextResponse.json(
        { error: "Campaign not found" },
        { status: 404 },
      );
    }

    return NextResponse.json(campaign, { status: 200 });
  } catch (err) {
    console.error("[GET /api/campaigns/[id]]", err);
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
    const parsed = updateCampaignSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { error: "Invalid request body", details: parsed.error.issues },
        { status: 400 },
      );
    }

    const { id } = await params;
    const userOrgId = gate.session.orgId;
    const result = await campaignsQueries.updateCampaign(
      userOrgId,
      gate.session.id,
      id,
      parsed.data,
    );

    if (!result) {
      return NextResponse.json(
        { error: "Campaign not found" },
        { status: 404 },
      );
    }

    return NextResponse.json({ id: result.id }, { status: 200 });
  } catch (err) {
    console.error("[PATCH /api/campaigns/[id]]", err);
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
    await campaignsQueries.deleteCampaign(userOrgId, gate.session.id, id);

    return NextResponse.json({ success: true }, { status: 200 });
  } catch (err) {
    console.error("[DELETE /api/campaigns/[id]]", err);
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
