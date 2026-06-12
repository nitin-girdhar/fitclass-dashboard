/**
 * GET /api/lookups/lead-statuses
 * Returns lead_statuses including the requires_followup flag.
 * Used by StatusChangeTrigger to decide whether to open the follow-up modal.
 */
import { NextRequest, NextResponse } from "next/server";
import { requireSession } from "@/src/lib/auth/session";
import { withServiceTx } from "@/src/lib/db/transaction";
import { AppError } from "@/src/lib/errors";
import type { LeadStatus } from "@/src/types/db";

export const dynamic = "force-dynamic";

const AUTH_PROVIDER = process.env.AUTH_PROVIDER ?? "supabase";

export async function GET(req: NextRequest) {
  try {
    if (AUTH_PROVIDER !== "local") {
      return NextResponse.json(
        { error: "PostgreSQL auth not enabled" },
        { status: 400 },
      );
    }

    const gate = await requireSession();
    if (!gate.ok) return gate.response;

    const statuses = await withServiceTx(async (tx) => {
      return tx<LeadStatus[]>`
        SELECT id, name, description, label, requires_followup, is_rejection
        FROM lead_statuses
        ORDER BY id
      `;
    });

    return NextResponse.json({ statuses }, { status: 200 });
  } catch (err) {
    console.error("[GET /api/lookups/lead-statuses]", err);
    if (err instanceof AppError) {
      return NextResponse.json(
        { error: err.message },
        { status: err.statusCode },
      );
    }
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 },
    );
  }
}
