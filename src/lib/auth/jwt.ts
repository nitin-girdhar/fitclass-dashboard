/**
 * JWT signing & verification.
 *
 * SERVER-ONLY (uses Node `crypto` via `jsonwebtoken` + the JWT secret). Do NOT
 * import this from Edge middleware — the Edge runtime lacks the Node crypto
 * `jsonwebtoken` depends on. The middleware deliberately does only a *presence*
 * check; cryptographic verification happens here on the Node server (route
 * handlers / server actions), and a future Edge-native verify (jose) can be
 * added alongside without changing this API.
 *
 * Why JWT (vs server-side session store):
 *  - Stateless: no session table round-trip on every request → scales
 *    horizontally on Vercel with zero shared infra.
 *  - Self-describing: role + identity travel in the signed token, so the
 *    future RBAC middleware can authorise from the token alone.
 *  - Revisitable: if revocation is later required, a short-lived access token
 *    + refresh/rotation can be layered on without changing call sites.
 *
 * Security defaults:
 *  - Algorithm pinned to HS256 on BOTH sign and verify (blocks `alg=none`
 *    and algorithm-confusion attacks).
 *  - Issuer + audience claims pinned and checked.
 *  - Expiry always set.
 *  - Verification never throws into business logic — returns a typed result.
 */
import jwt, {
  type SignOptions,
  type VerifyOptions,
  type JwtPayload as JsonwebtokenPayload,
} from 'jsonwebtoken';
import { getServerEnv } from '@/src/lib/auth/env';
import {
  JWT_EXPIRES_IN,
  JWT_ISSUER,
  JWT_AUDIENCE,
  ROLES,
} from '@/src/features/auth/constants';
import type { JwtPayload, JwtVerifyResult, UserRole } from '@/src/types/auth';

/** Claims we control when minting a token (registered claims are added by lib). */
type SignableClaims = Pick<JwtPayload, 'sub' | 'email' | 'role' | 'rank' | 'orgId' | 'pwd_iat'> & {
  tenantId?: string;
};

const ALGORITHM = 'HS256' as const;

const baseSignOptions: SignOptions = {
  algorithm: ALGORITHM,
  expiresIn: JWT_EXPIRES_IN,
  issuer: JWT_ISSUER,
  audience: JWT_AUDIENCE,
};

const baseVerifyOptions: VerifyOptions = {
  algorithms: [ALGORITHM],
  issuer: JWT_ISSUER,
  audience: JWT_AUDIENCE,
};

function isUserRole(value: unknown): value is UserRole {
  return typeof value === 'string' && (ROLES as readonly string[]).includes(value);
}

/**
 * Sign a session token. Pass only identity claims; `iat`/`exp`/`iss`/`aud`
 * are managed by the library + options.
 */
export function signJwt(claims: SignableClaims): string {
  const { JWT_SECRET } = getServerEnv();
  const payload: Record<string, unknown> = {
    email: claims.email,
    role: claims.role,
    rank: claims.rank,
    orgId: claims.orgId,
    pwd_iat: claims.pwd_iat,
  };
  if (claims.tenantId) payload.tenantId = claims.tenantId;
  return jwt.sign(payload, JWT_SECRET, { ...baseSignOptions, subject: claims.sub });
}

/**
 * Verify a token. Returns a discriminated result instead of throwing so
 * callers can branch cleanly. Also structurally validates custom claims so
 * downstream code gets a fully-typed `JwtPayload` with a known-good role.
 */
export function verifyJwt(token: string): JwtVerifyResult {
  const { JWT_SECRET } = getServerEnv();

  try {
    const decoded = jwt.verify(token, JWT_SECRET, baseVerifyOptions);

    if (typeof decoded === 'string') {
      return { valid: false, error: 'Malformed token payload' };
    }

    const d = decoded as JsonwebtokenPayload & {
      email?: unknown;
      role?: unknown;
      rank?: unknown;
      orgId?: unknown;
      tenantId?: unknown;
      pwd_iat?: unknown;
    };

    if (typeof d.sub !== 'string' || typeof d.email !== 'string' || !isUserRole(d.role)) {
      return { valid: false, error: 'Token claims failed validation' };
    }

    // Legacy tokens (minted before pwd_iat existed) have no claim → treat as
    // epoch 0 so the staleness check in the session resolver rejects them
    // against the backfilled password_changed_at, forcing one clean re-login.
    const pwdIat = typeof d.pwd_iat === 'number' ? d.pwd_iat : 0;
    const orgId = typeof d.orgId === 'string' ? d.orgId : '';
    const tenantId = typeof d.tenantId === 'string' ? d.tenantId : undefined;
    // Legacy tokens (minted before rank existed) default to 0 so existing
    // sessions continue to work; a fresh login will embed the correct rank.
    const rank = typeof d.rank === 'number' ? d.rank : 0;

    return {
      valid: true,
      payload: {
        sub: d.sub,
        email: d.email,
        role: d.role,
        rank,
        orgId,
        tenantId,
        pwd_iat: pwdIat,
        iat: d.iat,
        exp: d.exp,
      },
    };
  } catch (err) {
    const error =
      err instanceof jwt.TokenExpiredError
        ? 'Token expired'
        : err instanceof jwt.JsonWebTokenError
          ? 'Invalid token'
          : 'Token verification failed';
    return { valid: false, error };
  }
}
