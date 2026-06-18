/**
 * GET /api/users/assignable?orgId=<uuid>
 *
 * Returns the users the current actor is allowed to assign a lead to,
 * within the given org. Powers the inline assignment picker.
 *
 * Returns active, non-deleted users in the same org, excluding platform
 * operators and the current actor.
 */
import { NextResponse } from "next/server";
import { withRoute } from "@/src/lib/api/route-handler";
import { withServiceTx } from "@/src/lib/db/transaction";
import { ForbiddenError } from "@/src/lib/errors";
import { RANKS } from "@/src/lib/permissions/ranks";
import type { SessionUser } from "@/src/types/auth";

export const dynamic = "force-dynamic";

type AssignableRow = {
  id: string;
  full_name: string;
  email: string;
  role_name: string;
  role_rank: number;
  org_id: string;
};

export const GET = withRoute(async (req, session) => {
  if (session.rank < RANKS.SSE) {
    throw new ForbiddenError("Insufficient rank to assign leads");
  }

  const orgId = req.nextUrl.searchParams.get("orgId");
  if (!orgId) {
    return NextResponse.json({ error: "orgId param is required" }, { status: 400 });
  }

  const rows: AssignableRow[] = await withServiceTx(async (tx) => {
    return tx.unsafe(
      `SELECT u.id, u.full_name, u.email, ur.name AS role_name, ur.rank AS role_rank, u.org_id
       FROM users u
       JOIN user_roles ur ON ur.id = u.role_id
       WHERE u.org_id = $1
         AND u.is_active = TRUE
         AND NOT u.is_deleted
         AND ur.rank > $2
         AND ur.rank < $3
         AND ur.rank <= $4
         AND u.id != $5
       ORDER BY ur.rank DESC, u.full_name`,
      [orgId, RANKS.READ_ONLY, RANKS.ADMIN, session.rank, session.id],
    );
  });

  const users: SessionUser[] = rows.map((r) => ({
    id: r.id,
    email: r.email,
    role: r.role_name as SessionUser["role"],
    rank: r.role_rank ?? 0,
    orgId: r.org_id,
    name: r.full_name,
    is_active: true,
    force_password_change: false,
  }));

  return NextResponse.json({ users }, { status: 200 });
});
