/**
 * PATCH /api/admin/lead-statuses/[id]
 * Toggle the followup_required flag on a lead stage (org_admin+ only).
 * Updates the lookup table directly via service_role and busts the in-memory cache.
 */
import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { withRoute } from "@/src/lib/api/route-handler";
import { getServicePool } from "@/src/lib/db/client";
import { bustFollowupRequiredCache } from "@/src/lib/db/queries/status-log";
import { ForbiddenError, ValidationError } from "@/src/lib/errors";

export const dynamic = "force-dynamic";

const ALLOWED_ROLES = new Set(["org_admin", "tenant_admin", "super_admin"]);

const patchSchema = z.object({
  followupRequired: z.boolean(),
});

export const PATCH = withRoute<{ id: string }>(async (req: NextRequest, session, { id }) => {
  if (!ALLOWED_ROLES.has(session.role)) {
    throw new ForbiddenError("Only org admins and above can modify lead stage configuration.");
  }

  const body = await req.json();
  const parsed = patchSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid request body", details: parsed.error.issues },
      { status: 400 },
    );
  }

  const stageId = parseInt(id, 10);
  if (isNaN(stageId)) {
    throw new ValidationError("Invalid stage ID");
  }

  const pool = getServicePool();
  await pool`
    UPDATE lead_stage
    SET followup_required = ${parsed.data.followupRequired}
    WHERE id = ${stageId}
  `;

  bustFollowupRequiredCache();

  return NextResponse.json({ success: true }, { status: 200 });
});
