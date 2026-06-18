/**
 * POST /api/auth/login
 *
 * Validate credentials, mint a JWT, set the HTTP-only session cookie.
 *
 * Multi-org flow:
 *  - If user has 1 org → auto-select it, return session immediately.
 *  - If user has N orgs → return { requiresOrgSelection: true, orgs: [...] }.
 *    Client re-POSTs with the chosen orgId to complete login.
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
  getUserOrgAccessFromProvider,
} from "@/src/lib/auth/provider";
import { comparePassword } from "@/src/lib/auth/password";
import { signJwt } from "@/src/lib/auth/jwt";
import { sessionCookieFor } from "@/src/lib/auth/cookies";
import type { SessionUser, OrgAccess } from "@/src/types/auth";
import { withServiceTx } from "@/src/lib/db/transaction";

export const dynamic = "force-dynamic";

const GENERIC_AUTH_ERROR = "Invalid email or password";

function fail(): NextResponse {
  return NextResponse.json({ error: GENERIC_AUTH_ERROR }, { status: 401 });
}

function pgUserToSessionUser(user: any, org: OrgAccess): SessionUser {
  return {
    id: user.id,
    email: user.email,
    role: org.role,
    rank: org.rank,
    orgId: org.orgId,
    tenantId: user.tenantId ?? undefined,
    roleLabel: org.roleLabel,
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
  const selectedOrgId = (raw as any)?.orgId as string | undefined;

  try {
    const user = await getUserByEmailFromProvider(email);
    if (process.env.NODE_ENV === "development") {
      console.log("[Login] email:", email, "user found:", !!user, "isActive:", user?.isActive);
    }
    if (!user) return fail();
    if (!user.isActive) return fail();

    if (!user.passwordHash) {
      console.error("[Login] User has no password hash:", user.id);
      return fail();
    }

    const ok = await comparePassword(password, user.passwordHash);
    if (process.env.NODE_ENV === "development") {
      console.log("[Login] password match:", ok);
    }
    if (!ok) return fail();

    // Fetch all orgs this user has access to
    const orgs = await getUserOrgAccessFromProvider(user.id);

    if (orgs.length === 0) {
      console.error("[Login] User has no org access rows:", user.id);
      return fail();
    }

    // Resolve which org to use for this session
    let activeOrg: OrgAccess | undefined;

    if (selectedOrgId) {
      // Client already chose an org (second leg of multi-org flow, or explicit login page)
      activeOrg = orgs.find((o) => o.orgId === selectedOrgId);
      if (!activeOrg) {
        return NextResponse.json({ error: "Selected org is not accessible" }, { status: 403 });
      }
    } else if (orgs.length === 1) {
      // Single org — auto-select
      activeOrg = orgs[0];
    } else {
      // Multiple orgs — ask the client to pick one
      return NextResponse.json(
        { requiresOrgSelection: true, orgs },
        { status: 200 },
      );
    }

    // Look up tenantId for the selected org
    const tenantId: string | undefined = await withServiceTx(async (tx) => {
      const rows = await tx.unsafe(
        `SELECT tenant_id FROM organizations WHERE id = $1 AND NOT is_deleted LIMIT 1`,
        [activeOrg!.orgId],
      );
      return (rows[0] as any)?.tenant_id ?? undefined;
    });

    await updateLastLoginFromProvider(user.id, activeOrg.orgId).catch((err) => {
      console.error("[Login] Failed to update last_login_at:", err);
    });

    const token = signJwt({
      sub: user.id,
      email: user.email,
      role: activeOrg.role,
      rank: activeOrg.rank,
      orgId: activeOrg.orgId,
      tenantId,
      pwd_iat: Math.floor(
        new Date(user.passwordChangedAt || new Date()).getTime() / 1000,
      ),
    });

    const session = pgUserToSessionUser(user, activeOrg);
    const res = NextResponse.json({ user: session }, { status: 200 });
    res.cookies.set(sessionCookieFor(token));
    return res;
  } catch (err) {
    console.error("[Login] Unexpected error:", err);
    return fail();
  }
}
