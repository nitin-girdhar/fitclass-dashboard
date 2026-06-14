/**
 * POST /api/auth/login
 *
 * Validate credentials, mint a JWT, set the HTTP-only session cookie.
 *
 * Security notes:
 *  - Single generic "Invalid email or password" message for ALL failure modes
 *  - bcrypt hash comparison is constant-time
 *  - The password never appears in the response body or logs
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
import type { SessionUser } from "@/src/types/auth";

export const dynamic = "force-dynamic";

const GENERIC_AUTH_ERROR = "Invalid email or password";

function fail(): NextResponse {
  return NextResponse.json({ error: GENERIC_AUTH_ERROR }, { status: 401 });
}

function pgUserToSessionUser(user: any): SessionUser {
  return {
    id: user.id,
    email: user.email,
    role: (user.role ??
      user.roleName ??
      "sales_representative") as SessionUser["role"],
    rank: user.rank ?? 0,
    orgId: user.orgId ?? "",
    roleLabel: user.roleLabel ?? undefined,
    name:
      user.fullName || `${user.firstName || ""} ${user.lastName || ""}`.trim(),
    is_active: user.isActive ?? true,
    force_password_change: user.forcePasswordChange ?? false,
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
  if (!parsed.success) return fail();

  const { email, password } = parsed.data;
  const orgId = (raw as any)?.orgId;

  try {
    const user = await getUserByEmailFromProvider(email, orgId);
    if (!user) return fail();
    if (!user.isActive) return fail();

    if (!user.passwordHash) {
      console.error("[Login] User has no password hash:", user.id);
      return fail();
    }

    const ok = await comparePassword(password, user.passwordHash);
    if (!ok) return fail();

    if (user.orgId) {
      await updateLastLoginFromProvider(user.id, user.orgId).catch((err) => {
        console.error("[Login] Failed to update last_login_at:", err);
      });
    }

    const token = signJwt({
      sub: user.id,
      email: user.email,
      role: (user.role ??
        "sales_representative") as import("@/src/types/auth").UserRole,
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
  } catch (err) {
    console.error("[Login] Unexpected error:", err);
    return fail();
  }
}
