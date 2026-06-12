/**
 * Authorization gates for ROUTE HANDLERS.
 *
 * Split from `./server.ts` because pages and APIs need different failure
 * behaviour:
 *  - Pages → `redirect()` (next/navigation) so the user lands on /login or
 *    /dashboard with no flash of unauthorised content.
 *  - APIs  → typed JSON responses (`401` / `403`) so `fetch()` callers get a
 *    clean error contract, not an HTML page.
 *
 * Composition pattern:
 *
 *   const gate = await requireRoleApi('admin');
 *   if (!gate.ok) return gate.response;
 *   // gate.session is a verified, role-checked SessionUser
 */
import { NextResponse } from 'next/server';
import type { SessionUser, UserRole } from '@/src/types/auth';
import { requireSession } from '@/src/lib/auth/session';
import { hasMinimumRole, hasRole } from '@/src/lib/permissions';

export type ApiAuthGate =
  | { ok: true; session: SessionUser }
  | { ok: false; response: NextResponse };

function forbidden(): NextResponse {
  return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
}

/** Require an authenticated session AND an exact role. */
export async function requireRoleApi(role: UserRole): Promise<ApiAuthGate> {
  const gate = await requireSession();
  if (!gate.ok) return gate;
  if (!hasRole(gate.session, role)) {
    return { ok: false, response: forbidden() };
  }
  return gate;
}

/** Require an authenticated session AND at least the given role (hierarchical). */
export async function requireMinimumRoleApi(
  min: UserRole,
): Promise<ApiAuthGate> {
  const gate = await requireSession();
  if (!gate.ok) return gate;
  if (!hasMinimumRole(gate.session, min)) {
    return { ok: false, response: forbidden() };
  }
  return gate;
}
