/**
 * GET /api/users/team - Get team members for a manager
 * Optional query param: managerId (defaults to current user)
 */
import { NextRequest, NextResponse } from "next/server";
import { requireSession } from "@/src/lib/auth/session";
import * as usersQueries from "@/src/lib/db/queries/users";
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

    const { searchParams } = new URL(req.url);
    const managerId = searchParams.get("managerId") || gate.session.id;

    const userOrgId = gate.session.orgId;
    const team = await usersQueries.getTeamMembers(userOrgId, managerId);

    return NextResponse.json({ team }, { status: 200 });
  } catch (err) {
    console.error("[GET /api/users/team]", err);
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
