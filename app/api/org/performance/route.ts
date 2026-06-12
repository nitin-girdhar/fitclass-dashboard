/**
 * GET /api/org/performance
 * Per-org performance snapshot via vw_org_performance_snapshot.
 */
import { NextRequest, NextResponse } from "next/server";
import { requireSession } from "@/src/lib/auth/session";
import { withOrgTx } from "@/src/lib/db/transaction";
import { AppError } from "@/src/lib/errors";

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

    const snapshot = await withOrgTx(
      gate.session.orgId,
      gate.session.id,
      async (tx) => {
        const [row] = await tx`
          SELECT * FROM vw_org_performance_snapshot
          WHERE org_id = ${gate.session.orgId}
        `;
        return row ?? null;
      },
    );

    return NextResponse.json(snapshot, { status: 200 });
  } catch (err) {
    console.error("[GET /api/org/performance]", err);
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
