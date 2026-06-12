/**
 * Route-protection middleware — final Phase 2G shape.
 *
 * ── Why this file lives at the project ROOT (not src/) ──────────────────────
 * Next.js only executes middleware whose file sits at the SAME level as the
 * router. This project's App Router is at `./app`, so the active middleware
 * MUST be `./middleware.ts`. A `src/middleware.ts` would be silently ignored.
 *
 * ── Edge runtime ────────────────────────────────────────────────────────────
 * Runs on the Edge. The token verifier uses `jose` (WebCrypto) — see
 * `src/lib/auth/jwt-edge.ts` for why we cannot use `jsonwebtoken` here.
 *
 * ── Why the legacy CRM bypass is gone ───────────────────────────────────────
 * Earlier phases kept an allow-list (`LEGACY_CRM_PUBLIC_PATHS`) so the old
 * top-level CRM at `/` and its data APIs (/api/leads, /api/branches,
 * /api/sheets, /api/transfer) stayed reachable during the migration. In
 * Phase 2G those moved into the authenticated dashboard (`/dashboard/leads`)
 * and the APIs gained server-side `requireSession()` + branch / ownership
 * enforcement. The allow-list is therefore deleted entirely. Today every
 * request takes one of three paths:
 *
 *   1. PUBLIC_PATHS                — `/login` and `/api/auth/*` only
 *   2. PROTECTED_PREFIXES          — `/dashboard/*` + `/api/*`
 *                                    (verified here, double-checked Node-side)
 *   3. Everything else (incl. `/`) — passes through; the route handler /
 *                                    page decides what to do (the root page
 *                                    is a session-aware redirect)
 *
 * The matcher excludes Next.js internals and static assets (anything with a
 * file extension or under `_next`).
 */
import { NextResponse, type NextRequest } from 'next/server';
import {
  AUTH_COOKIE_NAME,
  AUTH_ROUTES,
  PROTECTED_EXACT_PATHS,
  PROTECTED_PREFIXES,
  PUBLIC_PATHS,
} from '@/src/features/auth/constants';
import { verifyJwtEdge } from '@/src/lib/auth/jwt-edge';

// Widen the `as const` literal tuple to `readonly string[]` so the in-runtime
// pathname (a plain string) can be checked with `.includes()`.
const exactProtected: readonly string[] = PROTECTED_EXACT_PATHS;

function isProtected(pathname: string): boolean {
  // Permanent public allow-list — keeps the sign-in flow reachable.
  if (PUBLIC_PATHS.some((p) => pathname === p || pathname.startsWith(`${p}/`))) {
    return false;
  }
  // Exact-match protected paths (notably `/`) — required for routes that
  // cannot safely be expressed as prefixes. `/` would otherwise either be
  // dropped from the gate (because `'/'` as a prefix means "everything") or
  // require special-casing inline.
  if (exactProtected.includes(pathname)) return true;
  return PROTECTED_PREFIXES.some(
    (prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`),
  );
}

function unauthenticated(req: NextRequest, hadToken: boolean): NextResponse {
  const { pathname, search, origin } = req.nextUrl;

  // APIs get a clean JSON 401 (not an HTML redirect).
  if (pathname.startsWith('/api')) {
    const res = NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    if (hadToken) res.cookies.delete(AUTH_COOKIE_NAME);
    return res;
  }

  // Pages get redirected to /login, preserving the intended target.
  const loginUrl = new URL(AUTH_ROUTES.login, origin);
  loginUrl.searchParams.set('callbackUrl', `${pathname}${search}`);
  const res = NextResponse.redirect(loginUrl);
  if (hadToken) res.cookies.delete(AUTH_COOKIE_NAME);
  return res;
}

export async function middleware(req: NextRequest): Promise<NextResponse> {
  if (!isProtected(req.nextUrl.pathname)) {
    return NextResponse.next();
  }

  const token = req.cookies.get(AUTH_COOKIE_NAME)?.value;
  if (!token) {
    return unauthenticated(req, false);
  }

  const verified = await verifyJwtEdge(token);
  if (!verified.valid) {
    return unauthenticated(req, true); // clear the bad cookie on the way out
  }

  // ── Role available, verified, trustworthy at the Edge ─────────────────────
  // The token signature + iss + aud + exp have been checked. `verified.payload.role`
  // can be used for cheap per-prefix gating WITHOUT a DB round-trip.
  //
  // Authoritative role / is_active / branch checks remain Node-side so they
  // see the user's CURRENT state (the JWT is point-in-time). The split is:
  //
  //   - server components / pages → src/lib/permissions/server.ts
  //                                 (requireRole / requireMinimumRole)
  //   - API route handlers        → src/lib/permissions/api.ts
  //                                 (requireRoleApi / requireMinimumRoleApi)
  //   - branch + assignment       → src/lib/permissions/leads.ts
  //                                 (canViewLeadData / canEditLead / ...)
  //
  // When a hot path needs sub-millisecond gate-out (no Node bounce), add an
  // edge rule HERE sourced from a single route map:
  //
  //   import { ROLE_RANK } from '@/src/features/auth/constants';
  //   const EDGE_RBAC: ReadonlyArray<{ prefix: string; minRank: number }> = [
  //     { prefix: '/dashboard/admin', minRank: ROLE_RANK.admin },
  //   ];
  //   const rule = EDGE_RBAC.find(r => pathname.startsWith(r.prefix));
  //   if (rule && ROLE_RANK[verified.payload.role] < rule.minRank) return forbidden(req);

  return NextResponse.next();
}

/**
 * Run middleware on everything EXCEPT Next.js internals and static assets.
 * Protected vs public is decided in `isProtected` above.
 */
export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico|.*\\.[\\w]+$).*)'],
};
