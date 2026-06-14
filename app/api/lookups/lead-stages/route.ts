/**
 * GET /api/lookups/lead-stages
 * Returns lead_stage rows including followup_required, is_rejected, is_terminated flags.
 * Used by StatusChangeTrigger to decide whether to open the follow-up modal.
 */
import { NextResponse } from "next/server";
import { withRoute } from "@/src/lib/api/route-handler";
import { withServiceTx } from "@/src/lib/db/transaction";
import type { LeadStage } from "@/src/types/db";

export const dynamic = "force-dynamic";

export const GET = withRoute(async () => {
  const stages = await withServiceTx(async (tx) => {
    return tx<LeadStage[]>`
      SELECT id, name, description, label,
             followup_required, is_rejected, is_terminated,
             display_order
      FROM lead_stage
      ORDER BY display_order
    `;
  });
  return NextResponse.json({ stages }, { status: 200 });
});
