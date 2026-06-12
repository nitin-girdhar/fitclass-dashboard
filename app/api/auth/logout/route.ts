/**
 * POST /api/auth/logout
 *
 * Clears the fc_session cookie. Idempotent — safe to call without an
 * existing session. Stateless server (no session store), so logout is just
 * "tell the browser to drop the cookie".
 *
 * We read the session BEFORE clearing the cookie so the audit row records
 * who logged out. `logLogout` never throws (audit isolation), so it cannot
 * block the response.
 */
import { NextResponse } from 'next/server';
import { clearedSessionCookie } from '@/src/lib/auth/cookies';
import { getSessionFromRequest } from '@/src/lib/auth/session';
import { logLogout } from '@/src/features/activities/mutations';

export const dynamic = 'force-dynamic';

export async function POST(): Promise<NextResponse> {
  const session = await getSessionFromRequest();

  const res = NextResponse.json({ success: true }, { status: 200 });
  res.cookies.set(clearedSessionCookie());

  if (session) {
    await logLogout(session.id);
  }
  return res;
}
