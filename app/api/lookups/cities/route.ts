/**
 * GET /api/lookups/cities?stateId=<id>
 * Returns cities for a given state.
 */
import { NextRequest, NextResponse } from "next/server";
import { requireSession } from "@/src/lib/auth/session";
import { getCitiesByStateId } from "@/src/lib/db/queries/lookups";
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

    const stateIdParam = new URL(req.url).searchParams.get("stateId");
    if (!stateIdParam) {
      return NextResponse.json(
        { error: "stateId query parameter is required" },
        { status: 400 },
      );
    }

    const stateId = parseInt(stateIdParam, 10);
    if (isNaN(stateId)) {
      return NextResponse.json(
        { error: "stateId must be a number" },
        { status: 400 },
      );
    }

    const cities = await getCitiesByStateId(stateId);
    return NextResponse.json({ cities }, { status: 200 });
  } catch (err) {
    console.error("[GET /api/lookups/cities]", err);
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
