/**
 * PATCH  /api/assignments/[id] — reassign to a new user
 * DELETE /api/assignments/[id] — unassign (lead returns to unowned)
 *
 * Authorization (Phase 2I) mirrors POST (see ../route.ts):
 *  - admin / manager / senior_sales_executive only (SE has no assign rights).
 *  - Branch authority: admin bypasses; manager / SSE need the assignment's
 *    branch in their `allowed_branches` (`canAssignLeadWithinBranch`).
 *  - Target-role routing (PATCH only): `canAssignToUser` matrix —
 *      admin→anyone, manager→sales tier, SSE→sales_executive only.
 *  - Target must share branch scope (admin actor skips this check).
 *
 * All denials emit a `privilege_denied_attempt` audit row.
 */
import { NextResponse, type NextRequest } from 'next/server';
import { revalidatePath } from 'next/cache';
import { requireMinimumRoleApi } from '@/src/lib/permissions/api';
import { canAssignLeadWithinBranch } from '@/src/lib/permissions/leads';
import {
  canAssignLeadToBranch,
  canAssignToUser,
} from '@/src/lib/permissions/assignments';
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

  // Branch authority.
  if (!canAssignLeadWithinBranch(actor, { branch: existing.branch })) {
    await logPrivilegeDeniedAttempt(actor.id, 'reassign_lead_branch', {
      assignment_id: id,
      branch: existing.branch,
    });
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
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

  // ── PRIVILEGE-ESCALATION GUARD (target-role routing + Phase 2L rules) ───
  // A reassign carries the same risk as a fresh assign — same predicate
  // applies. Blocks admin-target, self-assignment, and upward/sideways
  // role routing.
  if (!canAssignToUser(actor.rank, target.rank, actor.id, target.id)) {
    const reason: string =
      target.role === 'admin'
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

  // ── BRANCH INTEGRITY (Phase 2K) ─────────────────────────────────────────
  // Same rule as POST: applies to every actor including admin. A reassign
  // to a user outside the branch produces a ghost assignment.
  if (!canAssignLeadToBranch(target, existing.branch)) {
    await logPrivilegeDeniedAttempt(actor.id, 'reassign_lead_branch_scope', {
      assignment_id: id,
      branch: existing.branch,
      target_id: target.id,
      target_branches: target.allowed_branches,
    });
    return NextResponse.json(
      { error: 'Target user is not scoped to this lead\'s branch' },
      { status: 403 },
    );
  }

  const updated = await reassignLead({
    id,
    assignedTo: input.assigned_to,
    actorId: actor.id,
    notes: input.notes ?? null,
  });
  // Invalidate assignments page cache so the new owner shows up there too.
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
  if (!canAssignLeadWithinBranch(actor, { branch: existing.branch })) {
    await logPrivilegeDeniedAttempt(actor.id, 'unassign_lead_branch', {
      assignment_id: id,
      branch: existing.branch,
    });
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  await unassignLead({ id, actorId: actor.id });
  // Drop the row from the assignments page on next navigation.
  revalidatePath('/dashboard/assignments');
  return NextResponse.json({ success: true }, { status: 200 });
}
