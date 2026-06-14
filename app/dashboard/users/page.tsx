/**
 * /dashboard/users — manager+ user-management (Phase 2H hierarchy).
 *
 * Server-side authority gate: `requireMinimumRole('manager')`. Inside, the
 * user list is scoped per `canCreateUser(actor.role, target.role)` so a
 * manager only sees users they can actually create / edit (the sales tier);
 * admin sees everyone. Sales-tier users hitting this URL are redirected
 * to /dashboard by `requireMinimumRole`.
 *
 * Mutations trigger `router.refresh()` in the modals so this server
 * component re-runs with the latest data.
 */
import { requireMinimumRole } from '@/src/lib/permissions/server';
import { listUsers } from '@/src/features/users/queries';
import { toSessionUsers } from '@/src/features/users/serializers';
import { canViewUser } from '@/src/lib/permissions';
import { resolveActorOrgIds } from '@/src/lib/permissions/scope';
import UsersClient from '@/components/users/UsersClient';

export const dynamic = 'force-dynamic';

export default async function UsersPage() {
  // Phase 2M: SSE creates SEs, so they also need user-management access.
  // sales_executive is the only role completely excluded.
  const actor = await requireMinimumRole('senior_sales_executive');

  // Org-scope: super_admin → null (all tenants), tenant_admin → their tenant's
  // orgs, everyone else → their own single org.
  const orgIds = await resolveActorOrgIds(actor);
  const rows = await listUsers(orgIds);

  // canViewUser provides the secondary filter (role-based visibility within
  // the already-scoped list). Same predicate as the API GET so UI and data
  // layer never disagree. Per-row Edit-button visibility (canCreateUser) is
  // handled inside UsersTable.
  const users = toSessionUsers(
    rows.filter((u) =>
      canViewUser(actor, {
        id: u.id,
        rank: u.rank ?? 0,
        allowed_branches: u.allowed_branches,
      }),
    ),
  );

  return (
    // The dashboard `<main>` is padding-free (so full-bleed surfaces like
    // /dashboard/leads can claim every pixel). "Card" pages like this one
    // own their own gutter via `p-4 sm:p-6`.
    <div className="mx-auto w-full max-w-6xl p-4 sm:p-6">
      <UsersClient users={users} actor={actor} />
    </div>
  );
}
