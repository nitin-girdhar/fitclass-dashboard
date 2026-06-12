/**
 * /dashboard — the workspace home redirects to /dashboard/leads.
 *
 * Phase 2G unified the dashboard around a single primary surface (Leads).
 * There's no separate role-aware landing page anymore: every role's
 * top-of-funnel is the leads view, role-filtered server-side.
 *
 * Keeping /dashboard as a stable entry URL (and as the `AUTH_ROUTES.dashboard`
 * fallback target) means external links / bookmarks continue to work — they
 * just transparently land on the real surface.
 */
import { redirect } from 'next/navigation';
import { requireSessionPage } from '@/src/lib/permissions/server';

export const dynamic = 'force-dynamic';

export default async function DashboardHome() {
  await requireSessionPage('/dashboard');
  redirect('/dashboard/leads');
}
