/**
 * GET /api/lookups/cities?stateId=<id>
 * Returns cities for a given state.
 */
import { NextResponse } from "next/server";
import { withRoute } from "@/src/lib/api/route-handler";
import { getCitiesByStateId } from "@/src/lib/db/queries/lookups";

export const dynamic = "force-dynamic";

export const GET = withRoute(async (req) => {
  const stateIdParam = new URL(req.url).searchParams.get("stateId");
  if (!stateIdParam) {
    return NextResponse.json({ error: "stateId query parameter is required" }, { status: 400 });
  }
  const stateId = parseInt(stateIdParam, 10);
  if (isNaN(stateId)) {
    return NextResponse.json({ error: "stateId must be a number" }, { status: 400 });
  }
  const cities = await getCitiesByStateId(stateId);
  return NextResponse.json({ cities }, { status: 200 });
});
