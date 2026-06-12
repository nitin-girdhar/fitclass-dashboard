/**
 * Edge-runtime JWT verification using `jose`.
 *
 * WHY jose (and NOT jsonwebtoken) IN MIDDLEWARE:
 *  - `jsonwebtoken` depends on Node's built-in `crypto` module, which is NOT
 *    available in the Edge runtime that runs middleware/proxy.
 *  - `jose` is a pure WebCrypto implementation. It runs unchanged on Edge,
 *    Workers, Node, Deno, and the browser.
 *
 * The Node side (route handlers, server actions) keeps using
 * `src/lib/auth/jwt.ts` (jsonwebtoken) so we don't pay an extra dependency on
 * the Node server. The Edge side uses this module. Both verify the SAME
 * tokens with the SAME secret, algorithm (HS256), issuer and audience pins,
 * so tokens minted by one side are accepted by the other.
 *
 * Returns a discriminated result — never throws into middleware logic.
 */
import { jwtVerify, errors as joseErrors } from 'jose';
import {
  JWT_ISSUER,
  JWT_AUDIENCE,
  ROLES,
} from '@/src/features/auth/constants';
import type {
  JwtPayload,
  JwtVerifyResult,
  UserRole,
} from '@/src/types/auth';

const ALGORITHM = 'HS256' as const;

function isUserRole(v: unknown): v is UserRole {
  return typeof v === 'string' && (ROLES as readonly string[]).includes(v);
}

/**
 * Verify a token in the Edge runtime. Returns false on missing/bad secret so
 * middleware fails CLOSED (no token can pass when JWT_SECRET is misconfigured).
 */
export async function verifyJwtEdge(token: string): Promise<JwtVerifyResult> {
  const secret = process.env.JWT_SECRET;
  if (!secret) {
    return { valid: false, error: 'Server misconfiguration: JWT_SECRET missing' };
  }

  const key = new TextEncoder().encode(secret);

  try {
    const { payload } = await jwtVerify(token, key, {
      algorithms: [ALGORITHM],
      issuer: JWT_ISSUER,
      audience: JWT_AUDIENCE,
    });

    // Structurally validate our custom claims so callers get a typed JwtPayload.
    const sub = payload.sub;
    const email = (payload as { email?: unknown }).email;
    const role = (payload as { role?: unknown }).role;
    const rankRaw = (payload as { rank?: unknown }).rank;
    const orgIdRaw = (payload as { orgId?: unknown }).orgId;
    const pwdIatRaw = (payload as { pwd_iat?: unknown }).pwd_iat;

    if (
      typeof sub !== 'string' ||
      typeof email !== 'string' ||
      !isUserRole(role)
    ) {
      return { valid: false, error: 'Token claims failed validation' };
    }

    // The Edge gate only checks token validity/role, not the password
    // watermark (that DB-bound check lives in the Node session resolver). A
    // missing pwd_iat or rank is tolerated here and defaults to 0.
    const verified: JwtPayload = {
      sub,
      email,
      role,
      rank: typeof rankRaw === 'number' ? rankRaw : 0,
      orgId: typeof orgIdRaw === 'string' ? orgIdRaw : '',
      pwd_iat: typeof pwdIatRaw === 'number' ? pwdIatRaw : 0,
      iat: payload.iat,
      exp: payload.exp,
    };
    return { valid: true, payload: verified };
  } catch (err) {
    const error =
      err instanceof joseErrors.JWTExpired
        ? 'Token expired'
        : err instanceof joseErrors.JWTClaimValidationFailed
          ? 'Token claims rejected'
          : err instanceof joseErrors.JWSSignatureVerificationFailed
            ? 'Token signature invalid'
            : err instanceof joseErrors.JOSEError
              ? 'Token verification failed'
              : 'Token verification failed';
    return { valid: false, error };
  }
}
