/**
 * POST /api/users/[id]/reset-password — ADMIN-ONLY manual password set.
 *
 * The admin supplies the new password in the body; the server validates
 * strength, bcrypt-hashes it, and writes it.
 *
 * ── Security ────────────────────────────────────────────────────────────────
 *  - Plaintext is hashed by pgUsersQueries.updateUser and NEVER stored or
 *    logged. The audit row records only actor + target.
 *  - `password_changed_at` is bumped to NOW, which invalidates every
 *    previously-issued JWT for the target.
 *  - `force_password_change` is set so the admin-chosen password is treated
 *    as temporary: the user is routed to the change-password screen on next
 *    login to pick their own.
 *
 * ── RBAC ────────────────────────────────────────────────────────────────────
 *  Admin only. Self-reset is blocked — admins rotate their own password
 *  through the self-service /api/auth/change-password flow.
 */
import { NextResponse, type NextRequest } from 'next/server';
import { requireRoleApi } from '@/src/lib/permissions/api';
import { adminSetPasswordSchema } from '@/src/features/users/validators';
import * as pgUsersQueries from '@/src/lib/db/queries/users';
import { getUserById } from '@/src/features/users/queries';
import {
  logPasswordResetByAdmin,
  logPrivilegeDeniedAttempt,
} from '@/src/features/activities/mutations';

export const dynamic = 'force-dynamic';

interface RouteContext {
  params: Promise<{ id: string }>;
}

export async function POST(
  req: NextRequest,
  ctx: RouteContext,
): Promise<NextResponse> {
  const gate = await requireRoleApi('admin');
  if (!gate.ok) return gate.response;
  const actor = gate.session;

  const { id } = await ctx.params;

  let raw: unknown;
  try {
    raw = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  const parsed = adminSetPasswordSchema.safeParse(raw);
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'Validation failed', issues: parsed.error.issues },
      { status: 400 },
    );
  }

  const target = await getUserById(id);
  if (!target) {
    return NextResponse.json({ error: 'User not found' }, { status: 404 });
  }

  if (target.id === actor.id) {
    await logPrivilegeDeniedAttempt(actor.id, 'admin_set_password', {
      reason: 'self_target',
      target_id: target.id,
    });
    return NextResponse.json(
      { error: 'Use the change-password flow to set your own password.' },
      { status: 403 },
    );
  }

  // pgUsersQueries.updateUser hashes the plaintext password internally and
  // bumps password_changed_at, invalidating existing sessions for the target.
  await pgUsersQueries.updateUser(
    actor.orgId,
    actor.id,
    id,
    { password: parsed.data.password, forcePasswordChange: true },
  );

  await logPasswordResetByAdmin(actor.id, id);

  return NextResponse.json({ success: true }, { status: 200 });
}
