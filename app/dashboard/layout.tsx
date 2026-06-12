/**
 * /dashboard — protected shell. Every sub-route inherits this layout, so:
 *
 *  1. Authentication is enforced ONCE here (server-side), not in every page.
 *  2. The user object hydrates the navbar + sidebar without each child
 *     re-fetching it.
 *  3. Role-aware nav filtering happens in the sidebar/mobile-nav components
 *     using the session passed down from this layout.
 *
 * Force-dynamic because the session lives in an HTTP-only cookie that must
 * be read per-request; never prerender this tree.
 */
import type { ReactNode } from 'react';
import { redirect } from 'next/navigation';
import { getSessionFromRequest } from '@/src/lib/auth/session';
import DashboardNavbar from '@/components/dashboard/DashboardNavbar';
import DashboardSidebar from '@/components/dashboard/DashboardSidebar';
import SidebarController from '@/components/dashboard/SidebarController';

export const dynamic = 'force-dynamic';

interface Props {
  children: ReactNode;
}

export default async function DashboardLayout({ children }: Props) {
  const session = await getSessionFromRequest();
  if (!session) {
    redirect('/login?callbackUrl=%2Fdashboard');
  }

  // Forced password change (admin reset / new account): the user is signed in
  // but must pick their own password before reaching any dashboard surface.
  // The change-password page lives OUTSIDE /dashboard so this redirect can't
  // loop on itself.
  if (session.force_password_change) {
    redirect('/change-password');
  }

  // ── Padding policy ─────────────────────────────────────────────────────────
  // `<main>` is intentionally PADDING-FREE. Each page owns its own gutter so
  // the shell composes cleanly with two kinds of children:
  //   - "card" pages (users, assignments, …) wrap themselves in `p-4 sm:p-6`
  //   - "full-bleed" pages (leads — AG Grid) render edge-to-edge against the
  //     sidebar / top navbar without negative-margin tricks.
  // This avoids the bug where a full-bleed page used `-m-4 sm:-m-6` to escape
  // the padding: that interacted badly with `overflow-y-auto` + sticky
  // positioning and caused inner sections to visually overlap.
  // Layout policy:
  //   - Mobile/tablet (<lg): natural document scroll inherited from <body>.
  //     The shell stretches via `min-h-screen` so short pages still fill
  //     the viewport, but long pages can scroll past the fold normally.
  //   - Desktop (≥lg): the body is `100dvh + overflow:hidden` (see
  //     globals.css), and the inner row is `flex-1 min-h-0 overflow-hidden`
  //     so the AG Grid owns the only scroll region.
  return (
    <div className="flex min-h-screen w-full flex-col bg-[#F8FAFC] lg:h-full lg:min-h-0 lg:overflow-hidden">
      <DashboardNavbar user={session} />
      <SidebarController role={session.role} />
      <div className="flex w-full flex-1 lg:min-h-0 lg:overflow-hidden">
        <DashboardSidebar role={session.role} />
        <main className="flex w-full min-w-0 flex-1 flex-col lg:overflow-y-auto">
          {children}
        </main>
      </div>
    </div>
  );
}
