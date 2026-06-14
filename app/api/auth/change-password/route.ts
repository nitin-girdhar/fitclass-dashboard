/**
 * POST /api/auth/change-password — self-service password change.
 *
 * Any authenticated user changes their OWN password here. Requires the
 * current password (a stolen session cookie alone cannot silently rotate the
 * credential), then validates strength, hashes, and writes the new password.
 *
 * ── Session handling ────────────────────────────────────────────────────────
 * Changing the password bumps `password_changed_at`, which would normally
 * invalidate the caller's own cookie (pwd_iat now stale). To avoid logging
 * the user out of the very request that succeeded, we re-mint THIS session's
 * cookie with the new pwd_iat. Every OTHER device/token for the user is still
 * invalidated, which is the desired behaviour. `force_password_change` is
 * cleared because the user has now chosen their own password.
 */
import { NextResponse, type NextRequest } from "next/server";
import { withRoute } from "@/src/lib/api/route-handler";
import { changePasswordSchema } from "@/src/features/users/validators";
import { getUserByIdFromProvider } from "@/src/lib/auth/provider";
import * as pgUsersQueries from "@/src/lib/db/queries/users";
import { comparePassword } from "@/src/lib/auth/password";
import { signJwt } from "@/src/lib/auth/jwt";
import { sessionCookieFor } from "@/src/lib/auth/cookies";
import { logPasswordChangedSelf } from "@/src/features/activities/mutations";

export const dynamic = "force-dynamic";

export const POST = withRoute(async (req: NextRequest, actor) => {
  let raw: unknown;
  try {
    raw = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const parsed = changePasswordSchema.safeParse(raw);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Validation failed", issues: parsed.error.issues },
      { status: 400 },
    );
  }

  const user = await getUserByIdFromProvider(actor.id);
  if (!user || !user.isActive) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const currentOk = await comparePassword(parsed.data.current_password, user.passwordHash ?? "");
  if (!currentOk) {
    return NextResponse.json({ error: "Current password is incorrect" }, { status: 400 });
  }

  // updateUser hashes the plaintext password internally and returns
  // RETURNING id, password_changed_at so we get the exact DB timestamp for
  // the JWT pwd_iat watermark — no clock-skew between our capture and the DB.
  const updated = await pgUsersQueries.updateUser(
    actor.orgId,
    actor.id,
    actor.id,
    { password: parsed.data.new_password, forcePasswordChange: false },
  );

  await logPasswordChangedSelf(actor.id);

  const token = signJwt({
    sub: actor.id,
    email: actor.email,
    role: actor.role,
    rank: actor.rank,
    orgId: actor.orgId,
    pwd_iat: Math.floor(
      new Date((updated as any).password_changed_at ?? Date.now()).getTime() / 1000,
    ),
  });

  const res = NextResponse.json({ success: true }, { status: 200 });
  res.cookies.set(sessionCookieFor(token));
  return res;
});
