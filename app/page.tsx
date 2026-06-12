/**
 * Root `/` — pure session-aware redirect.
 *
 *  Unauthenticated → /login
 *  Authenticated   → /dashboard/leads
 *
 * ── Why root is now auth-only ───────────────────────────────────────────────
 * Phase 2G retired the legacy CRM that used to render here. There is now
 * exactly ONE authenticated application surface (`/dashboard/*`); visiting
 * the root is just a routing helper that lands you in the right place.
 * Public CRM exposure is forbidden — the production incident that brought us
 * here proved a single layer of redirect can fail (stale build, transient
 * session-lookup error) and silently re-expose the dashboard.
 *
 * ── How middleware + this page cooperate ────────────────────────────────────
 *  1. EDGE LAYER (middleware.ts): `/` is in `PROTECTED_EXACT_PATHS`, so a
 *     request without a verified `fc_session` cookie is bounced to /login
 *     BEFORE any rendering happens. This is the authoritative gate.
 *  2. PAGE LAYER (this file): runs only when the Edge layer let the request
 *     through (i.e. the session is verified). It performs the simple
 *     authenticated routing: send the user to /dashboard/leads.
 *
 * The `try/catch` below is belt-and-braces: if `getSessionFromRequest` ever
 * throws (DB outage, env var missing, network blip), we treat the request as
 * unauthenticated and bounce to /login rather than crashing into Next.js's
 * default error page (which historically rendered enough of the layout tree
 * to leak the navbar). `redirect()` itself throws a sentinel error that
 * Next.js catches at the framework level, so it MUST be invoked OUTSIDE
 * the try block — otherwise the sentinel would be swallowed.
 *
 * `force-dynamic` ensures this route is never statically optimised. The
 * session lives in an HTTP-only cookie that must be read per request.
 */
import { redirect } from 'next/navigation';
import { getSessionFromRequest } from '@/src/lib/auth/session';
import { AUTH_ROUTES } from '@/src/features/auth/constants';
import type { SessionUser } from '@/src/types/auth';

export const dynamic = 'force-dynamic';

export default async function Root() {
  let session: SessionUser | null = null;
  try {
    session = await getSessionFromRequest();
  } catch {
    // Any failure resolving the session — verifyJwt throw, DB error, etc.
    // — is treated as "not signed in". The middleware already short-circuits
    // truly anonymous requests; this catch only fires for authed-but-broken
    // sessions and the safest UX is to send the user back through /login.
    session = null;
  }

  if (!session) {
    redirect(AUTH_ROUTES.login);
  }
  redirect(AUTH_ROUTES.afterLogin);
}
