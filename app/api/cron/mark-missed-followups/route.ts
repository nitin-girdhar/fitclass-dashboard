/**
 * GET /api/cron/mark-missed-followups
 *
 * Background job: marks pending follow-ups that are 2+ hours overdue as
 * 'missed'.  Protected by a shared secret so only the cron scheduler can call
 * it — never exposed to regular users.
 *
 * Vercel Cron (vercel.json) fires this every 15 minutes.
 */
import { NextRequest, NextResponse } from "next/server";
import { markOverdueFollowUpsAsMissed } from "@/src/lib/db/queries/followups";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const cronSecret = req.headers.get("x-cron-secret");
  if (!cronSecret || cronSecret !== process.env.CRON_SECRET) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const markedMissed = await markOverdueFollowUpsAsMissed();
    return NextResponse.json({ markedMissed }, { status: 200 });
  } catch (err) {
    console.error("[GET /api/cron/mark-missed-followups]", err);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 },
    );
  }
}
