/**
 * GET /api/dashboard/campaigns - Get tenant campaign summary
 */
import { NextRequest, NextResponse } from "next/server";
import { requireSession } from "@/src/lib/auth/session";
import * as tenantsQueries from "@/src/lib/db/queries/tenants";
import { AppError } from "@/src/lib/errors";

export const dynamic = "force-dynamic";

const AUTH_PROVIDER = process.env.AUTH_PROVIDER ?? "supabase";

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

    if (!["super_admin", "tenant_admin"].includes(gate.session.role)) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    // tenantId is not a first-class JWT claim yet — fall back to orgId.
    const tenantId = (gate.session as { tenantId?: string }).tenantId || gate.session.orgId;
    if (!tenantId) {
      return NextResponse.json(
        { error: "Tenant context not found in session" },
        { status: 400 },
      );
    }

    const summary = await tenantsQueries.getTenantCampaignSummary(
      tenantId,
      gate.session.id,
    );

    return NextResponse.json({ summary }, { status: 200 });
  } catch (err) {
    console.error("[GET /api/dashboard/campaigns]", err);
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
