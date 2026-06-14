/**
 * GET /api/branches/all — every CRM branch name, across every dashboard.
 *
 * Powers the admin "Allowed branches" selector. /api/branches is per-dashboard
 * (the leads view only loads tabs for the current source); user-management
 * needs the full union so admins can scope a user to any real branch regardless
 * of which spreadsheet hosts it.
 */
import { NextResponse } from "next/server";
import { withRoute } from "@/src/lib/api/route-handler";
import { listAllBranches } from "@/src/features/branches/queries";
import { resolveActorOrgIds } from "@/src/lib/permissions/scope";

export const dynamic = "force-dynamic";

export const GET = withRoute(async (_req, session) => {
  const orgIds = await resolveActorOrgIds(session);
  const all = await listAllBranches(orgIds);
  return NextResponse.json({ branches: all }, { status: 200 });
});
