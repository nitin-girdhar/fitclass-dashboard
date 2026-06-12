/**
 * Server-side authorization guards for App-Router pages & layouts.
 *
 * These compose the session helpers (src/lib/auth/session.ts) with the pure
 * predicates (./index.ts) and apply the FAILURE BEHAVIOUR that's right for
 * server-rendered pages — `redirect()` from next/navigation, which throws an
 * internal "interrupt" so the caller never executes the rest of its render.
 *
 * For API route handlers, do NOT use these — they would 302 a fetch caller
 * to HTML. Pair `requireSession()` from session.ts with the predicates from
 * `./index.ts` and return your own NextResponse.json({error}, {status: 403}).
 *
 * WHY SERVER-SIDE ENFORCEMENT IS MANDATORY:
 *   Frontend `<Protected>` wrappers only hide UI — they're bypassable. The
 *   server is the only place that can guarantee an unauthorised user cannot
 *   read data or perform an action, because the server runs before any
 *   HTML / data leaves the building.
 */
import { redirect } from 'next/navigation';
import type { SessionUser, UserRole } from '@/src/types/auth';
import { getSessionFromRequest } from '@/src/lib/auth/session';
import { hasMinimumRole, hasRole } from '@/src/lib/permissions';
import { AUTH_ROUTES } from '@/src/features/auth/constants';

/**
 * Require ANY authenticated session. Returns the user; redirects to /login
 * otherwise. `redirect` is declared to return `never`, so the return type
 * `Promise<SessionUser>` is sound — control never resumes past a redirect.
 */
export async function requireSessionPage(
  callbackUrl?: string,
): Promise<SessionUser> {
  const session = await getSessionFromRequest();
  if (!session) {
    const target = callbackUrl
      ? `${AUTH_ROUTES.login}?callbackUrl=${encodeURIComponent(callbackUrl)}`
      : AUTH_ROUTES.login;
    redirect(target);
  }
  return session;
}

/**
 * Require an EXACT role. Authenticated-but-wrong-role users are bounced to
 * /dashboard (their own role-aware home) rather than /login — they ARE
 * signed in, they just lack the privilege for this surface.
 */
export async function requireRole(role: UserRole): Promise<SessionUser> {
  const session = await requireSessionPage();
  if (!hasRole(session, role)) {
    redirect(AUTH_ROUTES.dashboard);
  }
  return session;
}

/** Require AT LEAST the given role (uses ROLE_RANK hierarchy). */
export async function requireMinimumRole(
  min: UserRole,
): Promise<SessionUser> {
  const session = await requireSessionPage();
  if (!hasMinimumRole(session, min)) {
    redirect(AUTH_ROUTES.dashboard);
  }
  return session;
}
