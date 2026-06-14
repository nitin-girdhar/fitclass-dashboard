/**
 * GET /api/lookups - Get all lookup tables (statuses, roles, platforms, etc.)
 */
import { NextResponse } from "next/server";
import { withRoute } from "@/src/lib/api/route-handler";
import * as lookupsQueries from "@/src/lib/db/queries/lookups";

export const dynamic = "force-dynamic";

export const GET = withRoute(async () => {
  const lookups = await lookupsQueries.getAllLookups();
  return NextResponse.json(lookups, { status: 200 });
});
