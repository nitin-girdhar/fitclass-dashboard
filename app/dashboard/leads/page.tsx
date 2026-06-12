/**
 * /dashboard/leads — the unified, role-aware leads surface.
 *
 *  - The dashboard layout already enforces authentication, so this page
 *    inherits the gate; `requireSessionPage()` is a defensive double-check
 *    so a direct render never bypasses auth (no client-only rendering
 *    decision can leak data).
 *  - Branch + assignment enforcement happens INSIDE the API routes that
 *    `LeadDashboardShell` calls — frontend is just a renderer.
 *  - Force-dynamic so navigation back to this route always re-checks the
 *    cookie (never serves a stale-cached HTML version to a different user).
 */
import { requireSessionPage } from '@/src/lib/permissions/server';
import LeadDashboardShell from '@/components/dashboard/LeadDashboardShell';

export const dynamic = 'force-dynamic';

export default async function LeadsPage() {
  // Capture the verified actor so the shell can pass it into the inline
  // assignment selector (drives "can I assign?" + filtered candidate fetch).
  const actor = await requireSessionPage('/dashboard/leads');
  return <LeadDashboardShell actor={actor} />;
}
