/**
 * Node-side session helpers for route handlers and server components.
 *
 * Uses the Node JWT verifier (`src/lib/auth/jwt.ts`) — middleware has its own
 * Edge-safe verifier (`jwt-edge.ts`). Both validate the same tokens; they
 * just run on different runtimes.
 *
 * WHY THE USER IS REVALIDATED FROM THE DATABASE:
 *  A JWT carries `role` and `sub` claims that are TRUE AS OF SIGNING. If an
 *  admin disables a user (`is_active = false`) or changes their role between
 *  sign-in and now, the token still says otherwise. Re-reading `users` here
 *  means deactivations/role changes take effect within at most one request
 *  cycle (or instantly for /me) — no token revocation list needed for the
 *  common cases. The DB hit is acceptable for protected endpoints; a lighter
 *  token-only fast-path (`getJwtPayload`) can be layered on later if a hot
 *  path proves the cost matters.
 */
import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { AUTH_COOKIE_NAME } from "@/src/features/auth/constants";
import { verifyJwt } from "@/src/lib/auth/jwt";
import { getUserByIdFromProvider } from "@/src/lib/auth/provider";
import type { SessionUser } from "@/src/types/auth";

const AUTH_PROVIDER = process.env.AUTH_PROVIDER ?? "supabase";

/**
 * Convert DbUser (PostgreSQL) to SessionUser (app format).
 * user.role is the role NAME string from user_roles join in db-user.ts.
 */
function dbUserToSessionUser(user: any, orgIdFallback?: string): SessionUser {
  return {
    id: user.id,
    email: user.email,
    role: (user.role ?? user.roleName ?? "sales_rep") as SessionUser["role"],
    rank: user.rank ?? 0,
    orgId: user.orgId ?? orgIdFallback ?? "",
    orgName: user.orgName ?? null,
    tenantName: user.tenantName ?? null,
    roleLabel: user.roleLabel ?? undefined,
    name:
      user.fullName || `${user.firstName || ""} ${user.lastName || ""}`.trim(),
    allowed_branches: [],
    is_active: user.isActive ?? true,
    force_password_change: user.forcePasswordChange ?? false,
  };
}

/** Read the raw session token from the request cookie, if any. */
export async function getSessionToken(): Promise<string | null> {
  const store = await cookies();
  return store.get(AUTH_COOKIE_NAME)?.value ?? null;
}

/**
 * Resolve the current session: verify the JWT, re-read the user from the DB,
 * reject if missing/inactive OR if the token predates the user's most recent
 * password change. Returns null for any failure (no throws).
 *
 * ── Password-rotation invalidation ──────────────────────────────────────────
 * The token carries `pwd_iat` (epoch seconds of `password_changed_at` at sign
 * time). If the row's CURRENT password_changed_at is newer, the token was
 * issued against an old credential and is rejected. This is what makes an
 * admin reset / self-service change invalidate every previously-issued token
 * for that user — no server-side session store, no revocation list.
 */
export async function getSessionFromRequest(): Promise<SessionUser | null> {
  const token = await getSessionToken();
  if (!token) return null;

  const verified = verifyJwt(token);
  if (!verified.valid) return null;

  if (AUTH_PROVIDER === "local") {
    // Use PostgreSQL-native auth
    const user = await getUserByIdFromProvider(verified.payload.sub);
    if (!user || !user.isActive) return null;

    // Reject tokens older than the user's current password watermark.
    const pwdChangedAtSec = Math.floor(
      new Date(user.passwordChangedAt || new Date()).getTime() / 1000,
    );
    if (verified.payload.pwd_iat < pwdChangedAtSec) return null;

    // Pass orgId from JWT as fallback in case the DB user doesn't carry it
    return dbUserToSessionUser(user, verified.payload.orgId);
  }

  // Fall back to Supabase path (existing)
  const { getUserById } = await import("@/src/features/users/queries");
  const { toSessionUser } = await import("@/src/features/users/serializers");

  const user = await getUserById(verified.payload.sub);
  if (!user || !user.is_active) return null;

  const pwdChangedAtSec = Math.floor(
    new Date(user.password_changed_at).getTime() / 1000,
  );
  if (verified.payload.pwd_iat < pwdChangedAtSec) return null;

  return toSessionUser(user);
}

/**
 * Discriminated guard for API route handlers. Usage:
 *
 *   const gate = await requireSession();
 *   if (!gate.ok) return gate.response;
 *   // gate.session is SessionUser
 */
export type SessionGate =
  | { ok: true; session: SessionUser }
  | { ok: false; response: NextResponse };

export async function requireSession(): Promise<SessionGate> {
  const session = await getSessionFromRequest();
  if (!session) {
    return {
      ok: false,
      response: NextResponse.json({ error: "Unauthorized" }, { status: 401 }),
    };
  }
  return { ok: true, session };
}
