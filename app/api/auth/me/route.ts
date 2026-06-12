/**
 * GET /api/auth/me
 *
 * Returns the current authenticated user, ALWAYS revalidated from the
 * database (see the doc on `getSessionFromRequest` for the reasoning — role
 * / is_active changes take effect immediately instead of being shadowed by
 * a still-valid JWT). Returns 401 when the cookie is missing, the token
 * doesn't verify, or the user has been deactivated.
 *
 * This endpoint is the canonical client-side "am I logged in?" probe. It is
 * intentionally listed in PUBLIC_PATHS so the handler — not the middleware —
 * decides the response, keeping the client's error contract consistent
 * (always JSON {error}).
 */
import { NextResponse } from 'next/server';
import { getSessionFromRequest } from '@/src/lib/auth/session';

export const dynamic = 'force-dynamic';

export async function GET(): Promise<NextResponse> {
  const session = await getSessionFromRequest();
  if (!session) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  return NextResponse.json({ user: session }, { status: 200 });
}
