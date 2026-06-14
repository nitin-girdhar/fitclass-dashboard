/**
 * GET /api/users/org-chart - Get org hierarchy tree
 */
import { NextResponse } from "next/server";
import { withRoute } from "@/src/lib/api/route-handler";
import * as usersQueries from "@/src/lib/db/queries/users";

export const dynamic = "force-dynamic";

export const GET = withRoute(async (_req, session) => {
  const chart = await usersQueries.getOrgChart(session.orgId, session.id);
  return NextResponse.json({ chart }, { status: 200 });
});
