/**
 * POST /api/assignments — create a new assignment for a lead that has none.
 *
 * Authorization (Phase 2W, server-authoritative):
 *  - Caller must be admin, manager, OR senior_sales_executive.
 *    (sales_executive has no assign rights at all.)
 *  - `canAssignLeadWithinBranch` enforces the BRANCH authority — admin
 *    bypasses, manager/SSE need the branch in their `allowed_branches`.
 *  - `canAssignToUser` enforces the TARGET-role routing matrix:
 *      admin   → any non-admin
 *      manager → SSE + SE
 *      SSE     → SE only
 *      SE      → nobody (already filtered by the role-gate above)
 *    Plus: admin target ⇒ ✗, self-assign ⇒ ✗ (both enforced here).
 *  - `canAssignLeadToBranch` validates the assignee's own branch scope so
 *    we don't create ghost assignments (lead invisible to its supposed owner).
 *
 *  All gates run server-side. Frontend hiding is UX only.
 *  Every denial path emits a `privilege_denied_attempt` audit row.
 */
import { NextResponse, type NextRequest } from 'next/server';
import { revalidatePath } from 'next/cache';
import { requireMinimumRoleApi } from '@/src/lib/permissions/api';
import { canAssignLeadWithinBranch } from '@/src/lib/permissions/leads';
import {
  canAssignLeadToBranch,
  canAssignToUser,
} from '@/src/lib/permissions/assignments';
import { createAssignmentSchema } from '@/src/features/assignments/validators';
import { assignLead } from '@/src/features/assignments/mutations';
import { toAssignmentView } from '@/src/features/assignments/serializers';
import { getUserById } from '@/src/features/users/queries';
import { toSessionUser } from '@/src/features/users/serializers';
import { isDatabaseError } from '@/src/lib/db/errors';
import { logPrivilegeDeniedAttempt } from '@/src/features/activities/mutations';

export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest): Promise<NextResponse> {
  // Lowest role that has ANY assign authority is senior_sales_executive
  // (per ROLE_RANK). The fine-grained matrix runs below.
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

  // Branch authority: must be admin OR in-branch manager/SSE.
  if (!canAssignLeadWithinBranch(actor, { branch: input.branch })) {
    await logPrivilegeDeniedAttempt(actor.id, 'assign_lead_branch', {
      lead_id: input.lead_id,
      branch: input.branch,
    });
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  // Resolve target.
  const targetRow = await getUserById(input.assigned_to);
  if (!targetRow || !targetRow.is_active) {
    return NextResponse.json(
      { error: 'Target user not found or inactive' },
      { status: 400 },
    );
  }
  const target = toSessionUser(targetRow);

  // ── PRIVILEGE-ESCALATION GUARD (target-role routing + Phase 2L rules) ───
  // Blocks: (a) admin target (admins are not operational assignees),
  //         (b) self-assignment (actor.id === target.id),
  //         (c) upward / sideways role routing.
  // The picker UI hides those options but the API never trusts the UI.
  if (!canAssignToUser(actor.rank, target.rank, actor.id, target.id)) {
    const reason: string =
      target.role === 'admin'
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

  // ── BRANCH INTEGRITY (Phase 2K) ─────────────────────────────────────────
  // Applies to EVERY actor including admin. An assignee who can't access
  // the lead's branch would silently fail their own canViewLeadData check
  // and the lead would be invisible to its supposed owner — a ghost
  // assignment. The rule has nothing to do with who is assigning.
  if (!canAssignLeadToBranch(target, input.branch)) {
    await logPrivilegeDeniedAttempt(actor.id, 'assign_lead_branch_scope', {
      lead_id: input.lead_id,
      branch: input.branch,
      target_id: target.id,
      target_branches: target.allowed_branches,
    });
    return NextResponse.json(
      { error: 'Target user is not scoped to this lead\'s branch' },
      { status: 403 },
    );
  }

  try {
    const created = await assignLead({
      leadId: input.lead_id,
      branch: input.branch,
      assignedTo: input.assigned_to,
      assignedBy: actor.id,
      notes: input.notes ?? null,
    });
    // Invalidate the assignments page's router cache so a subsequent
    // navigation there shows the freshly-created row — this is what makes
    // the inline create visible on /dashboard/assignments without the
    // user needing a hard refresh.
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
