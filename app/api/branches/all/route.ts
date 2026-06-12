/**
 * GET /api/branches/all — every CRM branch name, across every dashboard.
 *
 * Powers the admin "Allowed branches" selector. Existing /api/branches is
 * per-dashboard (the leads view only loads tabs for the current source);
 * the user-management surface needs the full union so admins can scope a
 * user to any real branch regardless of which spreadsheet hosts it.
 *
 * Authorization:
 *  - Session required.
 *  - Result is filtered through `filterAllowedBranches` so a manager (rare
 *    consumer) only ever sees branches they themselves can access. Admin's
 *    canonical view sees all.
 *
 * Caching: none today. The list rarely changes but admins SHOULD see the
 * effect of adding a new Sheets tab immediately. Add Cache-Control with a
 * short TTL only if the Sheets API call becomes a hot path.
 */
import { NextResponse } from 'next/server';
import { requireSession } from '@/src/lib/auth/session';
import { listAllBranches } from '@/src/features/branches/queries';
import { filterAllowedBranches } from '@/src/lib/permissions/branches';
import { resolveActorOrgIds } from '@/src/lib/permissions/scope';

export const dynamic = 'force-dynamic';

const AUTH_PROVIDER = process.env.AUTH_PROVIDER ?? 'supabase';

export async function GET(): Promise<NextResponse> {
  const gate = await requireSession();
  if (!gate.ok) return gate.response;

  try {
    // Local path: scope the DB query to the actor's accessible orgs so a
    // tenant_admin only sees their tenant's orgs, org_admin only their own.
    // Supabase path: list all then filter via allowed_branches as before.
    const orgIds = AUTH_PROVIDER === 'local'
      ? await resolveActorOrgIds(gate.session)
      : null;

    const all = await listAllBranches(orgIds);
    // filterAllowedBranches is still useful for the Supabase path; in the
    // local path the list is already org-scoped so it passes through.
    const visible = filterAllowedBranches(gate.session, all);
    return NextResponse.json({ branches: visible }, { status: 200 });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error('[GET /api/branches/all] error=%s', message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
