/**
 * Database row types — the exact shape of rows in PostgreSQL.
 *
 * Kept separate from `src/types/auth.ts`:
 *  - `auth.ts` = what the *app* passes around (SessionUser has NO password).
 *  - `database.ts` = what the *table* physically stores (DatabaseUser DOES
 *    have password_hash). Serializers (src/features/users/serializers.ts)
 *    translate DB rows → safe app shapes so secrets never leak by accident.
 *
 * `UserRole` is re-exported from the single source of truth (the ROLES tuple)
 * so the DB type and the auth type can never drift apart.
 */
import type { UserRole } from '@/src/types/auth';

export type { UserRole };

/** Arbitrary JSON value — used for the dynamic activity snapshots (jsonb). */
export type JsonValue =
  | string
  | number
  | boolean
  | null
  | JsonValue[]
  | { [key: string]: JsonValue };

/** A row of public.users exactly as stored (includes the password hash). */
export interface DatabaseUser {
  id: string;
  /** Generated full name (first + middle + last). */
  name: string;
  first_name?: string | null;
  middle_name?: string | null;
  last_name?: string | null;
  manager_id?: string | null;
  /** Manager's full_name — denormalised via LEFT JOIN at query time. */
  manager_name?: string | null;
  last_login_at?: string | null;
  email: string;
  mobile?: string | null;
  password_hash: string;
  role: UserRole;
  /** Privilege rank from user_roles.rank via JOIN at query time. */
  rank: number;
  allowed_branches: string[];
  is_active: boolean;
  /**
   * Watermark for JWT invalidation. Each minted token embeds `pwd_iat` =
   * epoch seconds of this value at sign time; the session resolver rejects
   * tokens whose pwd_iat predates the current value. Bumped on every password
   * change so old sessions die immediately.
   */
  password_changed_at: string;
  /** When true, user must set a new password before reaching protected routes. */
  force_password_change: boolean;
  created_at: string;
  updated_at: string;
}

/** Columns required to insert a user (DB fills id/timestamps/defaults). */
export interface DatabaseUserInsert {
  name: string;
  email: string;
  password_hash: string;
  role?: UserRole;
  allowed_branches?: string[];
  is_active?: boolean;
  force_password_change?: boolean;
}

/** Patchable user columns (id/email/timestamps are not mass-assignable). */
export interface DatabaseUserUpdate {
  name?: string;
  password_hash?: string;
  role?: UserRole;
  allowed_branches?: string[];
  is_active?: boolean;
  password_changed_at?: string;
  force_password_change?: boolean;
}

/** A row of public.assignments. lead_id is the canonical Sheets-row key. */
export interface Assignment {
  id: string;
  lead_id: string;
  /** Denormalised sheet/tab name = branch. Powers branch-scoped authz. */
  branch: string;
  assigned_to: string;
  assigned_by: string;
  assigned_at: string;
  notes: string | null;
}

export interface AssignmentInsert {
  lead_id: string;
  branch: string;
  assigned_to: string;
  assigned_by: string;
  notes?: string | null;
}

export interface AssignmentUpdate {
  assigned_to?: string;
  assigned_by?: string;
  notes?: string | null;
}

/**
 * A row of public.activities — append-only audit entry.
 *
 * Post-Phase-2E shape (see migration 20260520000000):
 *  - `lead_id` is null for non-lead events (auth, user mgmt, ...).
 *  - `performed_by` is null when the actor is unknown (e.g. login_failure for
 *    an unknown email).
 *  - `subject_user_id` is the target user for user-management events.
 */
export interface Activity {
  id: string;
  lead_id: string | null;
  action_type: string;
  old_value: JsonValue | null;
  new_value: JsonValue | null;
  performed_by: string | null;
  subject_user_id: string | null;
  created_at: string;
}

export interface ActivityInsert {
  action_type: string;
  lead_id?: string | null;
  old_value?: JsonValue | null;
  new_value?: JsonValue | null;
  performed_by?: string | null;
  subject_user_id?: string | null;
}

/**
 * A row of public.sheet_assignments — branch (sheet) ownership granted
 * by an admin to a manager, or by a manager to a senior_sales_executive.
 * Distinct from `Assignment` (lead-level ownership).
 */
export interface SheetAssignment {
  id: string;
  branch: string;
  user_id: string;
  assigned_by: string | null;
  assigned_at: string;
  notes: string | null;
}

export interface SheetAssignmentInsert {
  branch: string;
  user_id: string;
  assigned_by?: string | null;
  notes?: string | null;
}
