/**
 * GET /api/lead-sources
 * Returns marketing platforms (lead sources) available in the user's accessible orgs.
 * Scoped to the user's tenant; admin roles see all orgs in the tenant.
 */
import { NextRequest, NextResponse } from "next/server";
import { requireSession } from "@/src/lib/auth/session";
import { withServiceTx } from "@/src/lib/db/transaction";

export const dynamic = "force-dynamic";

const TENANT_WIDE_ROLES = new Set(['super_admin', 'admin', 'tenant_admin']);

export async function GET(req: NextRequest) {
  try {
    const gate = await requireSession();
    if (!gate.ok) return gate.response;

    const { session } = gate;
    const orgFilter = TENANT_WIDE_ROLES.has(session.role)
      ? `o.tenant_id = (SELECT tenant_id FROM organizations WHERE id = $1::uuid AND NOT is_deleted)`
      : `o.id = $1::uuid`;

    const rows: { name: string }[] = await withServiceTx((tx) =>
      tx.unsafe(
        `SELECT DISTINCT mp.name
         FROM marketing_platforms mp
         JOIN ad_campaigns ac ON ac.platform_id = mp.id AND NOT ac.is_deleted
         JOIN organizations o  ON o.id = ac.org_id  AND NOT o.is_deleted
         WHERE ${orgFilter}
         ORDER BY mp.name`,
        [session.orgId],
      ),
    );

    return NextResponse.json(rows.map((r) => r.name), { status: 200 });
  } catch (err) {
    console.error("[GET /api/lead-sources]", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
