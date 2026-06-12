/**
 * GET /api/users/assignable?orgId=<uuid>
 *
 * Returns the users the current actor is allowed to assign a lead to,
 * within the given org/branch. Powers the inline assignment picker.
 *
 * For AUTH_PROVIDER=local (PostgreSQL):
 *   - Queries active, non-deleted users in the same org
 *   - Excludes org_admin / tenant_admin / super_admin (they don't receive leads)
 *   - Excludes the current actor (no self-assignment)
 *   - Returns SessionUser shape for the picker
 *
 * For AUTH_PROVIDER=supabase (legacy):
 *   - Falls back to the old Supabase + branch-name based path
 */
import { NextResponse, type NextRequest } from 'next/server';
import { requireSession } from '@/src/lib/auth/session';
import { withServiceTx } from '@/src/lib/db/transaction';
import { requireMinimumRoleApi } from '@/src/lib/permissions/api';
import { canAssignLeadWithinBranch } from '@/src/lib/permissions/leads';
import { canAssignLeadToBranch, canAssignToUser } from '@/src/lib/permissions/assignments';
import { listUsers } from '@/src/features/users/queries';
import { toSessionUsers } from '@/src/features/users/serializers';
import type { SessionUser } from '@/src/types/auth';

export const dynamic = 'force-dynamic';

const AUTH_PROVIDER = process.env.AUTH_PROVIDER ?? 'supabase';

// Roles that RECEIVE leads (excludes platform operators and read-only)
const LEAD_RECEIVER_ROLES = new Set([
  'sales_rep',
  'sales_executive',       // legacy Supabase role
  'senior_sales_executive',
  'org_manager',
  'manager',               // legacy Supabase role
]);

// Roles that CAN assign leads
const CAN_ASSIGN_ROLES = new Set([
  'org_admin', 'admin', 'tenant_admin', 'super_admin',
  'org_manager', 'manager', 'senior_sales_executive',
]);

export async function GET(req: NextRequest): Promise<NextResponse> {
  if (AUTH_PROVIDER === 'local') {
    return handleLocal(req);
  }
  return handleLegacy(req);
}

// ── PostgreSQL path ────────────────────────────────────────────────────────────

async function handleLocal(req: NextRequest): Promise<NextResponse> {
  const gate = await requireSession();
  if (!gate.ok) return gate.response;
  const actor = gate.session;

  if (!CAN_ASSIGN_ROLES.has(actor.role)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const orgId = req.nextUrl.searchParams.get('orgId');
  if (!orgId) {
    return NextResponse.json({ error: 'orgId param is required' }, { status: 400 });
  }

  // Fetch active users in the target org from the PostgreSQL DB
  type AssignableRow = { id: string; full_name: string; email: string; role_name: string; role_rank: number; org_id: string };

  const rows: AssignableRow[] = await withServiceTx(async (tx) => {
    return tx.unsafe(
      `SELECT u.id, u.full_name, u.email, ur.name AS role_name, ur.rank AS role_rank, u.org_id
       FROM users u
       JOIN user_roles ur ON ur.id = u.role_id
       WHERE u.org_id = $1
         AND u.is_active = TRUE
         AND NOT u.is_deleted
         AND u.id <> $2
         AND ur.name = ANY($3::text[])
       ORDER BY u.full_name`,
      [orgId, actor.id, Array.from(LEAD_RECEIVER_ROLES)],
    );
  });

  const users: SessionUser[] = rows.map((r: AssignableRow) => ({
    id: r.id,
    email: r.email,
    role: r.role_name as SessionUser['role'],
    rank: r.role_rank ?? 0,
    orgId: r.org_id,
    name: r.full_name,
    allowed_branches: [],
    is_active: true,
    force_password_change: false,
  }));

  return NextResponse.json({ users }, { status: 200 });
}

// ── Legacy Supabase path ───────────────────────────────────────────────────────

async function handleLegacy(req: NextRequest): Promise<NextResponse> {
  const gate = await requireMinimumRoleApi('senior_sales_executive');
  if (!gate.ok) return gate.response;
  const actor = gate.session;

  const branch = req.nextUrl.searchParams.get('branch') ?? req.nextUrl.searchParams.get('orgId') ?? '';
  if (!branch) {
    return NextResponse.json({ error: 'branch param is required' }, { status: 400 });
  }

  if (!canAssignLeadWithinBranch(actor, { branch })) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const rows = (await listUsers()).filter((u) => u.is_active);
  const candidates = toSessionUsers(rows).filter(
    (u) =>
      canAssignToUser(actor.rank, u.rank, actor.id, u.id) &&
      canAssignLeadToBranch(u, branch),
  );

  return NextResponse.json({ users: candidates }, { status: 200 });
}
