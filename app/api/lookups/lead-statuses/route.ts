/**
 * GET /api/lookups/lead-statuses
 * @deprecated Use /api/lookups/lead-stages instead.
 * Kept for backward compatibility during transition.
 */
import { NextRequest, NextResponse } from "next/server";

export const dynamic = "force-dynamic";

export async function GET(_req: NextRequest) {
  return NextResponse.redirect(
    new URL("/api/lookups/lead-stages", _req.url),
    { status: 308 },
  );
}
