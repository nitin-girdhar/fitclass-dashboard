/**
 * POST /api/auth/login
 *
 * Validate credentials, mint a JWT, set the HTTP-only session cookie.
 *
 * Security notes:
 *  - Single generic "Invalid email or password" message for ALL failure modes
 *  - bcrypt hash comparison is constant-time
 *  - The password never appears in the response body or logs
 *
 * Routes between Supabase and PostgreSQL auth based on AUTH_PROVIDER env var.
 */
import { NextResponse, type NextRequest } from "next/server";
import { loginSchema } from "@/src/lib/validations/auth";
import {
  getUserByEmailFromProvider,
  updateLastLoginFromProvider,
} from "@/src/lib/auth/provider";
import { comparePassword } from "@/src/lib/auth/password";
import { signJwt } from "@/src/lib/auth/jwt";
import { sessionCookieFor } from "@/src/lib/auth/cookies";
import { ROLE_RANK } from "@/src/features/auth/constants";
import type { SessionUser } from "@/src/types/auth";

export const dynamic = "force-dynamic";

const GENERIC_AUTH_ERROR = "Invalid email or password";
const AUTH_PROVIDER = process.env.AUTH_PROVIDER ?? "supabase";

function fail(): NextResponse {
  return NextResponse.json({ error: GENERIC_AUTH_ERROR }, { status: 401 });
}

/**
 * Convert DbUser to SessionUser for PostgreSQL auth.
 */
function pgUserToSessionUser(user: any): SessionUser {
  return {
    id: user.id,
    email: user.email,
    role: (user.role ?? user.roleName ?? "sales_rep") as SessionUser["role"],
    rank: user.rank ?? 0,
    orgId: user.orgId ?? "",
    roleLabel: user.roleLabel ?? undefined,
    name:
      user.fullName || `${user.firstName || ""} ${user.lastName || ""}`.trim(),
    allowed_branches: [],
    is_active: user.isActive ?? true,
    force_password_change: user.forcePasswordChange ?? false,
  };
}

/**
 * Convert DatabaseUser (Supabase) to SessionUser.
 */
function supabaseUserToSessionUser(user: any): SessionUser {
  return {
    id: user.id,
    email: user.email,
    role: user.role,
    rank: user.rank ?? 0,
    orgId: '',
    name: user.name,
    allowed_branches: user.allowed_branches || [],
    is_active: user.is_active,
    force_password_change: user.force_password_change || false,
  };
}

export async function POST(req: NextRequest): Promise<NextResponse> {
  let raw: unknown;
  try {
    raw = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const parsed = loginSchema.safeParse(raw);
  if (!parsed.success) {
    const candidateEmail =
      typeof (raw as { email?: unknown })?.email === "string"
        ? (raw as { email: string }).email
        : "";
    return fail();
  }
  const { email, password } = parsed.data;
  const orgId = (raw as any)?.orgId; // Optional org context for PostgreSQL

  try {
    if (AUTH_PROVIDER === "local") {
      // PostgreSQL auth path
      const user = await getUserByEmailFromProvider(email, orgId);
      if (!user) return fail();

      if (!user.isActive) return fail();

      if (!user.passwordHash) {
        console.error("[Login] User has no password hash:", user.id);
        return fail();
      }

      const ok = await comparePassword(password, user.passwordHash);
      if (!ok) return fail();

      // Update last login
      if (user.orgId) {
        await updateLastLoginFromProvider(user.id, user.orgId).catch((err) => {
          console.error("[Login] Failed to update last_login_at:", err);
        });
      }

      const token = signJwt({
        sub: user.id,
        email: user.email,
        role: (user.role ?? "sales_rep") as import("@/src/types/auth").UserRole,
        rank: user.rank ?? 0,
        orgId: user.orgId,
        pwd_iat: Math.floor(
          new Date(user.passwordChangedAt || new Date()).getTime() / 1000,
        ),
      });

      const session = pgUserToSessionUser(user);
      const res = NextResponse.json({ user: session }, { status: 200 });
      res.cookies.set(sessionCookieFor(token));

      return res;
    } else {
      // Supabase auth path (existing)
      const { getUserByEmail } = await import("@/src/features/users/queries");
      const { toSessionUser } =
        await import("@/src/features/users/serializers");
      const { logLoginFailure, logLoginSuccess } =
        await import("@/src/features/activities/mutations");

      const user = await getUserByEmail(email);
      if (!user) {
        await logLoginFailure(email, "unknown_email");
        return fail();
      }
      if (!user.is_active) {
        await logLoginFailure(email, "inactive_user", user.id);
        return fail();
      }

      const ok = await comparePassword(password, user.password_hash);
      if (!ok) {
        await logLoginFailure(email, "bad_password", user.id);
        return fail();
      }

      const token = signJwt({
        sub: user.id,
        email: user.email,
        role: user.role,
        rank: ROLE_RANK[user.role] ?? 0,
        orgId: '',
        pwd_iat: Math.floor(
          new Date(user.password_changed_at).getTime() / 1000,
        ),
      });

      const session = toSessionUser(user);
      const res = NextResponse.json({ user: session }, { status: 200 });
      res.cookies.set(sessionCookieFor(token));

      await logLoginSuccess(user.id);
      return res;
    }
  } catch (err) {
    console.error("[Login] Unexpected error:", err);
    return fail();
  }
}
