/**
 * GET /api/branches — org branches accessible to the current user.
 *
 * Returns org objects (not just names) so clients can correlate branches with
 * location IDs for the cascading country/state/city/branch filter.
 *
 * Optional location filters (comma-separated integers):
 *   ?cityIds=1,2      → only orgs in those cities
 *   ?stateIds=1,2     → only orgs in those states  (ignored when cityIds given)
 *   ?countryIds=1,2   → only orgs in those countries (ignored when stateIds given)
 *
 * Role visibility:
 *  - tenant_admin / super_admin / admin  →  all active orgs in the user's tenant
 *  - everyone else                        →  their own org only
 */
import { NextResponse } from "next/server";
import { withRoute } from "@/src/lib/api/route-handler";
import { withServiceTx } from "@/src/lib/db/transaction";

export const dynamic = "force-dynamic";

export interface BranchInfo {
  id: string;
  name: string;
  cityId: number | null;
  stateId: number | null;
  countryId: number | null;
}

const TENANT_WIDE_ROLES = new Set(["tenant_admin", "super_admin"]);

export const GET = withRoute(async (req, session) => {
  const { searchParams } = req.nextUrl;
  const cityIds    = (searchParams.get("cityIds")    ?? "").split(",").map(Number).filter(Boolean);
  const stateIds   = (searchParams.get("stateIds")   ?? "").split(",").map(Number).filter(Boolean);
  const countryIds = (searchParams.get("countryIds") ?? "").split(",").map(Number).filter(Boolean);

  const branches: BranchInfo[] = await withServiceTx(async (tx) => {
    const scopeFilter = TENANT_WIDE_ROLES.has(session.role)
      ? `o.tenant_id = (SELECT tenant_id FROM organizations WHERE id = $1::uuid)`
      : `o.id = $1::uuid`;

    let locationFilter = "";
    const extraParams: unknown[] = [];
    if (cityIds.length) {
      extraParams.push(cityIds);
      locationFilter = `AND o.city_id = ANY($${extraParams.length + 1}::int[])`;
    } else if (stateIds.length) {
      extraParams.push(stateIds);
      locationFilter = `AND o.state_id = ANY($${extraParams.length + 1}::int[])`;
    } else if (countryIds.length) {
      extraParams.push(countryIds);
      locationFilter = `AND o.country_id = ANY($${extraParams.length + 1}::int[])`;
    }

    const rows = await tx.unsafe(
      `SELECT o.id, o.name, o.city_id AS "cityId", o.state_id AS "stateId", o.country_id AS "countryId"
       FROM organizations o
       WHERE ${scopeFilter}
         AND NOT o.is_deleted
         AND o.is_active
         ${locationFilter}
       ORDER BY o.name`,
      [session.orgId, ...extraParams],
    );
    return rows as BranchInfo[];
  });

  return NextResponse.json(branches);
});
