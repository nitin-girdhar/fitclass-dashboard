/**
 * PATCH  /api/assignments/[id] — reassign to a new user
 * DELETE /api/assignments/[id] — unassign (lead returns to unowned)
 *
 * Authorization mirrors POST (see ../route.ts):
 *  - senior_sales_executive or above only.
 *  - Target-role routing (PATCH only): `canAssignToUser` matrix —
 *      admin→anyone, manager→SSE + SE, SSE→SE only.
 *
 * All denials emit a `privilege_denied_attempt` audit row.
 */
import { NextResponse, type NextRequest } from 'next/server';
import { revalidatePath } from 'next/cache';
import { requireMinimumRoleApi } from '@/src/lib/permissions/api';
import { canAssignToUser } from '@/src/lib/permissions/assignments';
import { updateAssignmentSchema } from '@/src/features/assignments/validators';
import {
  reassignLead,
  unassignLead,
} from '@/src/features/assignments/mutations';
import { getAssignmentById } from '@/src/features/assignments/queries';
import { toAssignmentView } from '@/src/features/assignments/serializers';
import { getUserById } from '@/src/features/users/queries';
import { toSessionUser } from '@/src/features/users/serializers';
import { logPrivilegeDeniedAttempt } from '@/src/features/activities/mutations';
import { RANKS } from '@/src/lib/permissions/ranks';

export const dynamic = 'force-dynamic';

interface RouteContext {
  params: Promise<{ id: string }>;
}

export async function PATCH(
  req: NextRequest,
  ctx: RouteContext,
): Promise<NextResponse> {
  const gate = await requireMinimumRoleApi('senior_sales_executive');
  if (!gate.ok) return gate.response;
  const actor = gate.session;

  const { id } = await ctx.params;

  let raw: unknown;
  try {
    raw = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }
  const parsed = updateAssignmentSchema.safeParse(raw);
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'Validation failed', issues: parsed.error.issues },
      { status: 400 },
    );
  }
  const input = parsed.data;

  const existing = await getAssignmentById(id);
  if (!existing) {
    return NextResponse.json({ error: 'Assignment not found' }, { status: 404 });
  }

  // Resolve new owner.
  const targetRow = await getUserById(input.assigned_to);
  if (!targetRow || !targetRow.is_active) {
    return NextResponse.json(
      { error: 'Target user not found or inactive' },
      { status: 400 },
    );
  }
  const target = toSessionUser(targetRow);

  // ── PRIVILEGE-ESCALATION GUARD (target-role routing) ────────────────────
  if (!canAssignToUser(actor.rank, target.rank, actor.id, target.id)) {
    const reason: string =
      target.rank >= RANKS.ADMIN
        ? 'admin_target'
        : actor.id === target.id
          ? 'self_assignment'
          : 'role_routing';
    await logPrivilegeDeniedAttempt(actor.id, 'reassign_lead_target_role', {
      reason,
      assignment_id: id,
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

  const updated = await reassignLead({
    id,
    assignedTo: input.assigned_to,
    actorId: actor.id,
    notes: input.notes ?? null,
  });
  revalidatePath('/dashboard/assignments');
  return NextResponse.json({ assignment: toAssignmentView(updated) }, { status: 200 });
}

export async function DELETE(
  _req: NextRequest,
  ctx: RouteContext,
): Promise<NextResponse> {
  const gate = await requireMinimumRoleApi('senior_sales_executive');
  if (!gate.ok) return gate.response;
  const actor = gate.session;

  const { id } = await ctx.params;

  const existing = await getAssignmentById(id);
  if (!existing) {
    return NextResponse.json({ error: 'Assignment not found' }, { status: 404 });
  }

  await unassignLead({ id, actorId: actor.id });
  revalidatePath('/dashboard/assignments');
  return NextResponse.json({ success: true }, { status: 200 });
}
