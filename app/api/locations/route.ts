/**
 * GET /api/locations — cascading country/state/city options.
 *
 * Results are scoped to orgs accessible to the requesting user so dropdowns
 * never show locations where the user has no branches.
 *
 * ?level=countries                        → all countries for user's orgs
 * ?level=states&countryIds=1,2            → states in those countries
 * ?level=cities&stateIds=1,2             → cities in those states
 */
import { NextResponse } from "next/server";
import { withRoute } from "@/src/lib/api/route-handler";
import { withServiceTx } from "@/src/lib/db/transaction";

export const dynamic = "force-dynamic";

const TENANT_WIDE_ROLES = new Set(["tenant_admin", "super_admin"]);

export const GET = withRoute(async (req, session) => {
  const { searchParams } = req.nextUrl;
  const level = searchParams.get("level");
  const countryIds = (searchParams.get("countryIds") ?? "").split(",").map(Number).filter(Boolean);
  const stateIds = (searchParams.get("stateIds") ?? "").split(",").map(Number).filter(Boolean);

  const orgFilter = TENANT_WIDE_ROLES.has(session.role)
    ? `o.tenant_id = (SELECT tenant_id FROM organizations WHERE id = $1::uuid AND NOT is_deleted)`
    : `o.id = $1::uuid`;

  const data = await withServiceTx(async (tx) => {
    if (level === "countries") {
      return tx.unsafe(
        `SELECT DISTINCT c.id, c.name, c.iso_code AS "isoCode"
         FROM countries c
         JOIN organizations o ON o.country_id = c.id AND NOT o.is_deleted
         WHERE ${orgFilter}
         ORDER BY c.name`,
        [session.orgId],
      );
    }
    if (level === "states") {
      if (!countryIds.length) return [];
      return tx.unsafe(
        `SELECT DISTINCT s.id, s.name, s.country_id AS "countryId"
         FROM states s
         JOIN organizations o ON o.state_id = s.id AND NOT o.is_deleted
         WHERE s.country_id = ANY($2::int[])
           AND ${orgFilter}
         ORDER BY s.name`,
        [session.orgId, countryIds],
      );
    }
    if (level === "cities") {
      if (!stateIds.length) return [];
      return tx.unsafe(
        `SELECT DISTINCT ci.id, ci.name, ci.state_id AS "stateId"
         FROM cities ci
         JOIN organizations o ON o.city_id = ci.id AND NOT o.is_deleted
         WHERE ci.state_id = ANY($2::int[])
           AND ${orgFilter}
         ORDER BY ci.name`,
        [session.orgId, stateIds],
      );
    }
    return [];
  });

  return NextResponse.json(data);
});
