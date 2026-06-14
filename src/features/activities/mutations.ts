/**
 * Audit-log writes.
 *
 * ── Why audit logging is an ISOLATED layer ──────────────────────────────────
 * Auditing is observability, not business logic. It must NEVER fail the
 * business operation it is observing. Every public helper here therefore
 * catches its own errors and logs to stderr instead of propagating —
 * "the audit row didn't land" is an operational problem, "we lost a customer
 * because audit was down" is a business catastrophe.
 *
 * ── Non-blocking pattern ────────────────────────────────────────────────────
 * The helpers are `async` and return `Promise<void>`. Callers can `await`
 * them when ordering matters (e.g. log BEFORE returning a response so the
 * row exists when an admin queries it), but can also fire-and-forget with
 * `void log...()` because the helper swallows errors. There is no `throw`
 * path that can ever surface inside a business handler.
 *
 * ── Where rows come from ────────────────────────────────────────────────────
 * Wrappers (`logLoginSuccess`, `logUserCreated`, ...) encode the right shape
 * for each event — handlers shouldn't hand-roll inserts. New event types are
 * added in `./types.ts` first; mutations.ts gains a one-line wrapper.
 */
import { withServiceTx } from '@/src/lib/db/transaction';
import { fromPgError, DatabaseError } from '@/src/lib/db/errors';
import type { ActivityInsert, JsonValue } from '@/src/types/database';
import type { ActivityAction } from './types';

interface LogParams {
  performedBy?: string | null;
  subjectUserId?: string | null;
  leadId?: string | null;
  oldValue?: JsonValue | null;
  newValue?: JsonValue | null;
}

async function insertActivity(row: ActivityInsert): Promise<void> {
  try {
    await withServiceTx(async (tx) => {
      await tx.unsafe(
        `INSERT INTO activities
           (action_type, performed_by, subject_user_id, lead_id, old_value, new_value)
         VALUES ($1, $2, $3, $4, $5::jsonb, $6::jsonb)`,
        [
          row.action_type,
          row.performed_by ?? null,
          row.subject_user_id ?? null,
          row.lead_id ?? null,
          row.old_value != null ? JSON.stringify(row.old_value) : null,
          row.new_value != null ? JSON.stringify(row.new_value) : null,
        ],
      );
    });
  } catch (err) {
    if (err instanceof DatabaseError) throw err;
    throw fromPgError(err);
  }
}

function safeLog(scope: string, err: unknown): void {
  const message = err instanceof Error ? err.message : String(err);
  // Audit-write failures go to server logs only — never propagated to the
  // caller. Operators see this in their log aggregator.
  console.warn(`[activities:${scope}] audit write failed: ${message}`);
}

async function log(action: ActivityAction, params: LogParams = {}): Promise<void> {
  try {
    await insertActivity({
      action_type: action,
      performed_by: params.performedBy ?? null,
      subject_user_id: params.subjectUserId ?? null,
      lead_id: params.leadId ?? null,
      old_value: params.oldValue ?? null,
      new_value: params.newValue ?? null,
    });
  } catch (err) {
    safeLog(action, err);
  }
}

// ── Authentication events ────────────────────────────────────────────────────

export function logLoginSuccess(userId: string): Promise<void> {
  return log('login_success', { performedBy: userId, subjectUserId: userId });
}

/**
 * Login failed. We log the attempted email (sanitised to lowercase) and a
 * short machine-readable reason, but NEVER the candidate password.
 */
export function logLoginFailure(
  attemptedEmail: string,
  reason: 'unknown_email' | 'inactive_user' | 'bad_password' | 'invalid_input',
  knownUserId?: string | null,
): Promise<void> {
  return log('login_failure', {
    performedBy: knownUserId ?? null,
    subjectUserId: knownUserId ?? null,
    newValue: {
      attempted_email: attemptedEmail.trim().toLowerCase(),
      reason,
    },
  });
}

export function logLogout(userId: string): Promise<void> {
  return log('logout', { performedBy: userId, subjectUserId: userId });
}

// ── User-management events ───────────────────────────────────────────────────
// `before` / `after` snapshots are sanitised by callers (NEVER include
// password_hash). Sanitisation lives in `sanitizeUserForAudit` below.

export interface UserAuditSnapshot {
  id: string;
  email: string;
  name: string;
  role: string;
  is_active: boolean;
}

/**
 * Build the audit-safe projection of a user row. Hard-codes the allow-list
 * of fields so no future column (e.g. a new secret) leaks by accident.
 */
export function sanitizeUserForAudit(user: {
  id: string;
  email: string;
  name: string;
  role: string;
  is_active: boolean;
}): UserAuditSnapshot {
  return {
    id: user.id,
    email: user.email,
    name: user.name,
    role: user.role,
    is_active: user.is_active,
  };
}

// The snapshots are JSON-safe by construction (only primitive fields +
// string[]) but TypeScript can't prove that an `interface` satisfies the
// recursive index-signature in JsonValue. Cast at this boundary only.
const asJson = (v: UserAuditSnapshot): JsonValue =>
  v as unknown as JsonValue;

export function logUserCreated(
  actorId: string,
  target: UserAuditSnapshot,
): Promise<void> {
  return log('user_created', {
    performedBy: actorId,
    subjectUserId: target.id,
    newValue: asJson(target),
  });
}

export function logUserUpdated(
  actorId: string,
  before: UserAuditSnapshot,
  after: UserAuditSnapshot,
): Promise<void> {
  return log('user_updated', {
    performedBy: actorId,
    subjectUserId: after.id,
    oldValue: asJson(before),
    newValue: asJson(after),
  });
}

export function logUserDeactivated(
  actorId: string,
  targetId: string,
): Promise<void> {
  return log('user_deactivated', {
    performedBy: actorId,
    subjectUserId: targetId,
  });
}

export function logUserReactivated(
  actorId: string,
  targetId: string,
): Promise<void> {
  return log('user_reactivated', {
    performedBy: actorId,
    subjectUserId: targetId,
  });
}

export function logUserPasswordReset(
  actorId: string,
  targetId: string,
): Promise<void> {
  return log('user_password_reset', {
    performedBy: actorId,
    subjectUserId: targetId,
  });
}

/**
 * An admin MANUALLY set another user's password (admin typed it, vs. the
 * server auto-generating a temporary one). Records actor + target only — the
 * password itself is NEVER part of the audit payload.
 */
export function logPasswordResetByAdmin(
  actorId: string,
  targetId: string,
): Promise<void> {
  return log('password_reset_by_admin', {
    performedBy: actorId,
    subjectUserId: targetId,
  });
}

/** A user changed their OWN password via the self-service change flow. */
export function logPasswordChangedSelf(userId: string): Promise<void> {
  return log('password_changed_self', {
    performedBy: userId,
    subjectUserId: userId,
  });
}

/** Explicit role-change event — emitted alongside user_updated when role differs. */
export function logRoleChanged(
  actorId: string,
  targetId: string,
  oldRole: string,
  newRole: string,
): Promise<void> {
  return log('role_changed', {
    performedBy: actorId,
    subjectUserId: targetId,
    oldValue: { role: oldRole },
    newValue: { role: newRole },
  });
}

/**
 * Audit-log a forbidden attempt. Emitted from API handlers right before
 * returning 403. Useful for detecting credential abuse / probing — admins
 * can grep for repeated denials by `performed_by`.
 *
 * `attemptedAction` is a stable short token ('create_user', 'update_user',
 * 'assign_lead', …) — keep it terse and never change existing values (it's
 * an append-only audit contract).
 */
export function logPrivilegeDeniedAttempt(
  actorId: string | null,
  attemptedAction: string,
  details: JsonValue,
): Promise<void> {
  return log('privilege_denied_attempt', {
    performedBy: actorId,
    newValue: { action: attemptedAction, details },
  });
}

// ── Lead / assignment events (foundations) ──────────────────────────────────

export function logAssignmentCreated(
  actorId: string,
  leadId: string,
  details: JsonValue,
): Promise<void> {
  return log('assignment_created', {
    performedBy: actorId,
    leadId,
    newValue: details,
  });
}

export function logAssignmentReassigned(
  actorId: string,
  leadId: string,
  before: JsonValue,
  after: JsonValue,
): Promise<void> {
  return log('assignment_reassigned', {
    performedBy: actorId,
    leadId,
    oldValue: before,
    newValue: after,
  });
}

export function logAssignmentRemoved(
  actorId: string,
  leadId: string,
  details: JsonValue,
): Promise<void> {
  return log('assignment_removed', {
    performedBy: actorId,
    leadId,
    oldValue: details,
  });
}

export function logStatusChange(
  actorId: string,
  leadId: string,
  before: JsonValue,
  after: JsonValue,
): Promise<void> {
  return log('status_change', {
    performedBy: actorId,
    leadId,
    oldValue: before,
    newValue: after,
  });
}

export function logLeadTransferred(
  actorId: string,
  leadId: string,
  fromBranch: string,
  toBranch: string,
): Promise<void> {
  return log('lead_transferred', {
    performedBy: actorId,
    leadId,
    oldValue: { branch: fromBranch },
    newValue: { branch: toBranch },
  });
}

// NOTE: the `sheet_assigned` / `sheet_unassigned` action strings remain in
// ACTIVITY_ACTIONS (see ./types.ts) for HISTORICAL audit-log compatibility —
// any rows written before the Sheets surface was retired will still parse
// cleanly. The helpers themselves were removed because nothing in the app
// emits these events anymore.
