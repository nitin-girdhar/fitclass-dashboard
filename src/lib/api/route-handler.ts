/**
 * withRoute — authenticated route handler wrapper.
 *
 * Eliminates the ~7-line try/catch boilerplate that was copy-pasted across
 * every API route. Handles:
 *   1. requireSession() — returns 401 if the JWT is missing or invalid
 *   2. AppError — maps to the error's statusCode
 *   3. Unhandled errors — logs with method + path, returns 500
 *
 * Route-specific errors (e.g. DB unique-constraint violations) should be
 * caught INSIDE the handler and returned as NextResponse directly, or
 * re-thrown as AppError. Any error that reaches this wrapper becomes a 500.
 *
 * Dynamic-route usage (params are typed via the generic):
 *   export const GET = withRoute<{ id: string }>(async (req, session, { id }) => { ... });
 *
 * Non-dynamic usage:
 *   export const GET = withRoute(async (_req, session) => { ... });
 */
import { NextResponse, type NextRequest } from 'next/server';
import { requireSession } from '@/src/lib/auth/session';
import { AppError } from '@/src/lib/errors';
import type { SessionUser } from '@/src/types/auth';

type AuthedHandler<P extends Record<string, string>> = (
  req: NextRequest,
  session: SessionUser,
  params: P,
) => Promise<NextResponse>;

// Next.js 15 made route context params a Promise; support both old and new shapes.
type RouteCtx<P> = { params: Promise<P> | P } | undefined;

export function withRoute<P extends Record<string, string> = Record<string, string>>(
  handler: AuthedHandler<P>,
) {
  return async (req: NextRequest, ctx?: RouteCtx<P>): Promise<NextResponse> => {
    try {
      const gate = await requireSession();
      if (!gate.ok) return gate.response;
      const params = ctx?.params ? await ctx.params : ({} as P);
      return await handler(req, gate.session, params);
    } catch (err) {
      console.error(`[${req.method} ${new URL(req.url).pathname}]`, err);
      if (err instanceof AppError) {
        return NextResponse.json({ error: err.message }, { status: err.statusCode });
      }
      return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
    }
  };
}
