/**
 * GET /api/lookups/lead-stage-outcomes?stage_id=<id>
 * Returns outcomes for a given stage. If stage_id is omitted, returns all outcomes.
 */
import { NextResponse } from "next/server";
import { withRoute } from "@/src/lib/api/route-handler";
import { withServiceTx } from "@/src/lib/db/transaction";
import type { LeadStageOutcome } from "@/src/types/db";

export const dynamic = "force-dynamic";

export const GET = withRoute(async (req) => {
  const stageIdParam = req.nextUrl.searchParams.get("stage_id");
  const stageId = stageIdParam ? parseInt(stageIdParam, 10) : null;

  if (stageIdParam !== null && (isNaN(stageId!) || stageId! < 1)) {
    return NextResponse.json({ error: "Invalid stage_id" }, { status: 400 });
  }

  const outcomes = await withServiceTx(async (tx) => {
    if (stageId !== null) {
      return tx<LeadStageOutcome[]>`
        SELECT id, stage_id, name, label, description, requires_comment, display_order
        FROM lead_stage_outcome
        WHERE stage_id = ${stageId}
        ORDER BY display_order
      `;
    }
    return tx<LeadStageOutcome[]>`
      SELECT id, stage_id, name, label, description, requires_comment, display_order
      FROM lead_stage_outcome
      ORDER BY stage_id, display_order
    `;
  });

  return NextResponse.json({ outcomes }, { status: 200 });
});
