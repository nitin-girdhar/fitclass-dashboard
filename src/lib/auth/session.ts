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
 *  cycle — no token revocation list needed for the common cases.
 *
 * ── Password-rotation invalidation ──────────────────────────────────────────
 * The token carries `pwd_iat` (epoch seconds of `password_changed_at` at sign
 * time). If the row's CURRENT password_changed_at is newer, the token was
 * issued against an old credential and is rejected.
 */
import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { AUTH_COOKIE_NAME } from "@/src/features/auth/constants";
import { verifyJwt } from "@/src/lib/auth/jwt";
import { getUserByIdFromProvider } from "@/src/lib/auth/provider";
import type { SessionUser } from "@/src/types/auth";

function dbUserToSessionUser(user: any, orgIdFallback?: string): SessionUser {
  return {
    id: user.id,
    email: user.email,
    role: (user.role ??
      user.roleName ??
      "sales_representative") as SessionUser["role"],
    rank: user.rank ?? 0,
    orgId: user.orgId ?? orgIdFallback ?? "",
    orgName: user.orgName ?? null,
    tenantName: user.tenantName ?? null,
    roleLabel: user.roleLabel ?? undefined,
    name:
      user.fullName || `${user.firstName || ""} ${user.lastName || ""}`.trim(),
    is_active: user.isActive ?? true,
    force_password_change: user.forcePasswordChange ?? false,
  };
}

/** Read the raw session token from the request cookie, if any. */
export async function getSessionToken(): Promise<string | null> {
  const store = await cookies();
  return store.get(AUTH_COOKIE_NAME)?.value ?? null;
}

export async function getSessionFromRequest(): Promise<SessionUser | null> {
  const token = await getSessionToken();
  if (!token) return null;

  const verified = verifyJwt(token);
  if (!verified.valid) return null;

  const user = await getUserByIdFromProvider(verified.payload.sub);
  if (!user || !user.isActive) return null;

  const pwdChangedAtSec = Math.floor(
    new Date(user.passwordChangedAt || new Date()).getTime() / 1000,
  );
  if (verified.payload.pwd_iat < pwdChangedAtSec) return null;

  return dbUserToSessionUser(user, verified.payload.orgId);
}

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
