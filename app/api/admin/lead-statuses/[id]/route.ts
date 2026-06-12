/**
 * PATCH /api/admin/lead-statuses/[id]
 * Toggle the requires_followup flag on a lead status (org_admin+ only).
 * Updates the lookup table directly via service_role and busts the in-memory cache.
 */
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireSession } from "@/src/lib/auth/session";
import { getServicePool } from "@/src/lib/db/client";
import { bustRequiresFollowupCache } from "@/src/lib/db/queries/status-log";
import {
  AppError,
  ForbiddenError,
  ValidationError,
} from "@/src/lib/errors";

export const dynamic = "force-dynamic";

const AUTH_PROVIDER = process.env.AUTH_PROVIDER ?? "supabase";

const ALLOWED_ROLES = new Set([
  "org_admin",
  "admin",
  "tenant_admin",
  "super_admin",
]);

const patchSchema = z.object({
  requiresFollowup: z.boolean(),
});

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    if (AUTH_PROVIDER !== "local") {
      return NextResponse.json(
        { error: "PostgreSQL auth not enabled" },
        { status: 400 },
      );
    }

    const gate = await requireSession();
    if (!gate.ok) return gate.response;

    if (!ALLOWED_ROLES.has(gate.session.role)) {
      throw new ForbiddenError(
        "Only org admins and above can modify lead status configuration.",
      );
    }

    const body = await req.json();
    const parsed = patchSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { error: "Invalid request body", details: parsed.error.issues },
        { status: 400 },
      );
    }

    const { id } = await params;
    const statusId = parseInt(id, 10);
    if (isNaN(statusId)) {
      throw new ValidationError("Invalid status ID");
    }

    const pool = getServicePool();
    await pool`
      UPDATE lead_statuses
      SET requires_followup = ${parsed.data.requiresFollowup}
      WHERE id = ${statusId}
    `;

    bustRequiresFollowupCache();

    return NextResponse.json({ success: true }, { status: 200 });
  } catch (err) {
    console.error("[PATCH /api/admin/lead-statuses/[id]]", err);
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
