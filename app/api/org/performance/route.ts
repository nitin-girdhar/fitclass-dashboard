/**
 * GET /api/org/performance
 * Per-org performance snapshot via vw_org_performance_snapshot.
 */
import { NextResponse } from "next/server";
import { withRoute } from "@/src/lib/api/route-handler";
import { withOrgTx } from "@/src/lib/db/transaction";

export const dynamic = "force-dynamic";

export const GET = withRoute(async (_req, session) => {
  const snapshot = await withOrgTx(session.orgId, session.id, async (tx) => {
    const [row] = await tx`
      SELECT * FROM vw_org_performance_snapshot
      WHERE org_id = ${session.orgId}
    `;
    return row ?? null;
  });
  return NextResponse.json(snapshot, { status: 200 });
});
