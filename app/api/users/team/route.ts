/**
 * GET /api/users/team - Get team members for a manager
 * Optional query param: managerId (defaults to current user)
 */
import { NextResponse } from "next/server";
import { withRoute } from "@/src/lib/api/route-handler";
import * as usersQueries from "@/src/lib/db/queries/users";

export const dynamic = "force-dynamic";

export const GET = withRoute(async (req, session) => {
  const managerId = new URL(req.url).searchParams.get("managerId") || session.id;
  const team = await usersQueries.getTeamMembers(session.orgId, managerId);
  return NextResponse.json({ team }, { status: 200 });
});
