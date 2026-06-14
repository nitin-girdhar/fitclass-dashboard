/**
 * POST /api/assignments — create a new assignment for a lead that has none.
 *
 * Authorization (server-authoritative):
 *  - Caller must be senior_sales_executive or above.
 *  - `canAssignToUser` enforces the TARGET-role routing matrix:
 *      admin   → any non-admin
 *      manager → SSE + SE
 *      SSE     → SE only
 *    Plus: admin-tier target ⇒ ✗, self-assign ⇒ ✗ (both enforced here).
 *
 *  All gates run server-side. Frontend hiding is UX only.
 *  Every denial path emits a `privilege_denied_attempt` audit row.
 */
import { NextResponse, type NextRequest } from 'next/server';
import { revalidatePath } from 'next/cache';
import { requireMinimumRoleApi } from '@/src/lib/permissions/api';
import { canAssignToUser } from '@/src/lib/permissions/assignments';
import { createAssignmentSchema } from '@/src/features/assignments/validators';
import { assignLead } from '@/src/features/assignments/mutations';
import { toAssignmentView } from '@/src/features/assignments/serializers';
import { getUserById } from '@/src/features/users/queries';
import { toSessionUser } from '@/src/features/users/serializers';
import { isDatabaseError } from '@/src/lib/db/errors';
import { logPrivilegeDeniedAttempt } from '@/src/features/activities/mutations';
import { RANKS } from '@/src/lib/permissions/ranks';

export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest): Promise<NextResponse> {
  // Lowest role that has ANY assign authority is senior_sales_executive
  const gate = await requireMinimumRoleApi('senior_sales_executive');
  if (!gate.ok) return gate.response;
  const actor = gate.session;

  let raw: unknown;
  try {
    raw = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  const parsed = createAssignmentSchema.safeParse(raw);
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'Validation failed', issues: parsed.error.issues },
      { status: 400 },
    );
  }
  const input = parsed.data;

  // Resolve target.
  const targetRow = await getUserById(input.assigned_to);
  if (!targetRow || !targetRow.is_active) {
    return NextResponse.json(
      { error: 'Target user not found or inactive' },
      { status: 400 },
    );
  }
  const target = toSessionUser(targetRow);

  // ── PRIVILEGE-ESCALATION GUARD (target-role routing) ────────────────────
  // Blocks: (a) admin-tier target (admins are not operational assignees),
  //         (b) self-assignment (actor.id === target.id),
  //         (c) upward / sideways role routing.
  if (!canAssignToUser(actor.rank, target.rank, actor.id, target.id)) {
    const reason: string =
      target.rank >= RANKS.ADMIN
        ? 'admin_target'
        : actor.id === target.id
          ? 'self_assignment'
          : 'role_routing';
    await logPrivilegeDeniedAttempt(actor.id, 'assign_lead_target_role', {
      reason,
      lead_id: input.lead_id,
      target_id: target.id,
      target_role: target.role,
    });
    const message =
      reason === 'admin_target'
        ? 'Admin users cannot be lead assignees'
        : reason === 'self_assignment'
          ? 'You cannot assign a lead to yourself'
          : 'You cannot assign leads to a user with that role';
    return NextResponse.json({ error: message }, { status: 403 });
  }

  try {
    const created = await assignLead({
      leadId: input.lead_id,
      branch: input.branch,
      assignedTo: input.assigned_to,
      assignedBy: actor.id,
      notes: input.notes ?? null,
    });
    revalidatePath('/dashboard/assignments');
    return NextResponse.json(
      { assignment: toAssignmentView(created) },
      { status: 201 },
    );
  } catch (err) {
    if (isDatabaseError(err) && err.kind === 'unique_violation') {
      return NextResponse.json(
        {
          error:
            'This lead is already assigned. Use PATCH /api/assignments/{id} to reassign.',
        },
        { status: 409 },
      );
    }
    throw err;
  }
}
