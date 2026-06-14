/**
 * GET /api/dashboard - Get full tenant dashboard (requires tenant_admin role)
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
  const tenantId = (session as { tenantId?: string }).tenantId || session.orgId;
  if (!tenantId) {
    return NextResponse.json({ error: "Tenant context not found in session" }, { status: 400 });
  }
  const dashboard = await tenantsQueries.getTenantDashboard(tenantId, session.id);
  return NextResponse.json(dashboard, { status: 200 });
});
