/**
 * GET /api/dashboard/campaigns - Get tenant campaign summary
 */
import { NextResponse } from "next/server";
import { withRoute } from "@/src/lib/api/route-handler";
import * as tenantsQueries from "@/src/lib/db/queries/tenants";
import { ForbiddenError } from "@/src/lib/errors";

export const dynamic = "force-dynamic";

export const GET = withRoute(async (_req, session) => {
  if (!["super_admin", "tenant_admin"].includes(session.role)) {
    throw new ForbiddenError("Access restricted to tenant administrators.");
  }
  // tenantId is not a first-class JWT claim yet — fall back to orgId.
  const tenantId = (session as { tenantId?: string }).tenantId || session.orgId;
  if (!tenantId) {
    return NextResponse.json({ error: "Tenant context not found in session" }, { status: 400 });
  }
  const summary = await tenantsQueries.getTenantCampaignSummary(tenantId, session.id);
  return NextResponse.json({ summary }, { status: 200 });
});
