/**
 * /dashboard/assignments — senior_sales_executive+ (Phase 2W).
 *
 * Server-rendered list of current assignments + candidate assignees. Both
 * lists are filtered server-side:
 *  - Admin   → all assignments + all active non-admin users
 *  - Manager → in-branch assignments + active SSE/SE in branch overlap
 *  - SSE     → in-branch assignments + active SE in branch overlap
 *  - SE      → rejected by the role gate (read-only role)
 *
 * Page is `force-dynamic`; `revalidatePath('/dashboard/assignments')` in
 * the mutation handlers refreshes this view after writes.
 */
import { requireMinimumRole } from '@/src/lib/permissions/server';
import { hasMinimumRole } from '@/src/lib/permissions';
import {
  getAssignmentsForBranches,
  listAllAssignments,
} from '@/src/features/assignments/queries';
import { listUsers } from '@/src/features/users/queries';
import { toAssignmentViews } from '@/src/features/assignments/serializers';
import { toSessionUser } from '@/src/features/users/serializers';
import { canAssignToUser } from '@/src/lib/permissions/assignments';
import { resolveActorOrgIds } from '@/src/lib/permissions/scope';
import AssignmentsClient from '@/components/assignments/AssignmentsClient';
import type { SessionUser } from '@/src/types/auth';

export const dynamic = 'force-dynamic';

const AUTH_PROVIDER = process.env.AUTH_PROVIDER ?? 'supabase';

export default async function AssignmentsPage() {
  // Lowest role with ANY assign authority is senior_sales_executive; the
  // fine-grained matrix runs below (and again server-side in the API).
  const actor = await requireMinimumRole('senior_sales_executive');

  // ── Org-scope resolution ───────────────────────────────────────────────
  // Local (PostgreSQL) path uses org-based scoping:
  //   super_admin   → null (all orgs, all tenants)
  //   tenant_admin  → all orgs within their tenant
  //   org_admin+    → their own org only
  //
  // Supabase path keeps the old allowed_branches logic.
  let orgIds: string[] | null = null;
  if (AUTH_PROVIDER === 'local') {
    orgIds = await resolveActorOrgIds(actor);
  }

  const rows = AUTH_PROVIDER === 'local'
    ? await listAllAssignments(orgIds)
    : (hasMinimumRole(actor, 'admin') || actor.allowed_branches.length === 0
        ? await listAllAssignments()
        : await getAssignmentsForBranches(actor.allowed_branches));
  const assignments = toAssignmentViews(rows);

  // ── Candidate assignees ────────────────────────────────────────────────
  // Scoped to the same org set as the assignments above so an org_admin
  // cannot see (or assign to) users outside their org.
  //
  // SECURITY NOTE: this list is UX, not the gate. The same predicates run
  // server-side in POST/PATCH /api/assignments — a crafted POST to assign
  // to an admin (or to yourself) will 403 even if the UI never shows that
  // option.
  const allUsers = AUTH_PROVIDER === 'local'
    ? (await listUsers(orgIds)).filter((u) => u.is_active)
    : (await listUsers()).filter((u) => u.is_active);

  const candidates: SessionUser[] = allUsers
    .map(toSessionUser)
    .filter((u) => canAssignToUser(actor.rank, u.rank, actor.id, u.id))
    .filter((u) => {
      if (AUTH_PROVIDER === 'local') return true; // org-scoped list already filtered above
      if (hasMinimumRole(actor, 'admin')) return true;
      // Supabase path: branch overlap for manager / SSE
      return (
        u.allowed_branches.length === 0 ||
        u.allowed_branches.some((b) => actor.allowed_branches.includes(b))
      );
    });

  return (
    // Card-page padding (the dashboard `<main>` is padding-free).
    <div className="mx-auto w-full max-w-6xl p-4 sm:p-6">
      <AssignmentsClient
        actor={actor}
        assignments={assignments}
        candidates={candidates}
      />
    </div>
  );
}
