/**
 * POST /api/users/[id]/reset-password — ADMIN-ONLY manual password set.
 *
 * The admin supplies the new password (and confirmation) in the body; the
 * server validates strength, bcrypt-hashes it, and writes it. There is no
 * server-generated temporary password anymore — the admin owns the value and
 * hands it off out-of-band.
 *
 * ── Security ────────────────────────────────────────────────────────────────
 *  - Plaintext is hashed with bcrypt and NEVER stored or logged. The audit
 *    row records only actor + target (`password_reset_by_admin`).
 *  - `password_changed_at` is bumped to NOW, which invalidates every
 *    previously-issued JWT for the target (their `pwd_iat` now predates the
 *    watermark — see src/lib/auth/session.ts). The user must log in again.
 *  - `force_password_change` is set so the admin-chosen password is treated
 *    as temporary: the user is routed to the change-password screen on next
 *    login to pick their own.
 *
 * ── RBAC ────────────────────────────────────────────────────────────────────
 *  Admin only. Manual credential-setting is a high-trust operation reserved
 *  for the platform owner; the broader manager+ hierarchy does not apply here.
 *  Self-reset via this endpoint is blocked — admins rotate their own password
 *  through the self-service /api/auth/change-password flow.
 */
import { NextResponse, type NextRequest } from 'next/server';
import { requireRoleApi } from '@/src/lib/permissions/api';
import { adminSetPasswordSchema } from '@/src/features/users/validators';
import { updateUser } from '@/src/features/users/mutations';
import { getUserById } from '@/src/features/users/queries';
import { hashPassword } from '@/src/lib/auth/password';
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
  // Admin only — manual password setting is not part of the manager+ chain.
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

  // Admins rotate their OWN password via the self-service flow, which verifies
  // the current password. Blocking self-reset here avoids an admin bypassing
  // that check on themselves.
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

  const password_hash = await hashPassword(parsed.data.password);

  // Bump password_changed_at → invalidates the target's existing sessions.
  // force_password_change → user must pick their own password next login.
  await updateUser(id, {
    password_hash,
    password_changed_at: new Date().toISOString(),
    force_password_change: true,
  });

  // Audit: actor + target + timestamp (created_at). NEVER the password.
  await logPasswordResetByAdmin(actor.id, id);

  return NextResponse.json({ success: true }, { status: 200 });
}
