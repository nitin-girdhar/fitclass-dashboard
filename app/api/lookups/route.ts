/**
 * GET /api/lookups - Get all lookup tables (statuses, roles, platforms, etc.)
 */
import { NextRequest, NextResponse } from "next/server";
import { requireSession } from "@/src/lib/auth/session";
import * as lookupsQueries from "@/src/lib/db/queries/lookups";
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

    const lookups = await lookupsQueries.getAllLookups();

    return NextResponse.json(lookups, { status: 200 });
  } catch (err) {
    console.error("[GET /api/lookups]", err);
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
