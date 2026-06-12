/**
 * Single source of truth for activity action types.
 *
 * Action strings are part of an append-only AUDIT contract: never rename an
 * existing one (you'd lose searchability over historical rows); add new ones
 * here and adoption is automatic via `ActivityAction`. Categories are
 * documented inline so the type itself stays terse.
 */

export const ACTIVITY_ACTIONS = [
  // ── Authentication ────────────────────────────────────────────────────────
  'login_success',
  'login_failure',
  'logout',
  // ── User management ───────────────────────────────────────────────────────
  'user_created',
  'user_updated',
  'user_deactivated',
  'user_reactivated',
  'user_password_reset',
  'password_reset_by_admin',
  'password_changed_self',
  'role_changed',
  'privilege_denied_attempt',
  // ── Lead operations (Phase 2E+) ───────────────────────────────────────────
  'assignment_created',
  'assignment_reassigned',
  'assignment_removed',
  'status_change',
  'lead_transferred',
  // ── Sheet ownership (Phase 2M) ────────────────────────────────────────────
  'sheet_assigned',
  'sheet_unassigned',
] as const;

export type ActivityAction = (typeof ACTIVITY_ACTIONS)[number];

/** Public-facing shape — strips internals not meant for UI / API consumers. */
export interface ActivityView {
  id: string;
  action_type: ActivityAction | string; // tolerate unknown legacy strings
  performed_by: string | null;
  subject_user_id: string | null;
  lead_id: string | null;
  old_value: unknown;
  new_value: unknown;
  created_at: string;
}
