/**
 * Row → safe-shape translation.
 *
 * The ONLY sanctioned bridge from a stored `DatabaseUser` (contains
 * password_hash) to an app-facing `SessionUser` (no secrets). Centralising
 * this means a password hash can never accidentally be serialised into a JWT,
 * API response, or log line — call sites physically cannot see the hash field
 * once they go through here.
 */
import type { DatabaseUser } from '@/src/types/database';
import type { SessionUser } from '@/src/types/auth';

/** Strip secrets/internal columns; produce the app-safe user shape. */
export function toSessionUser(row: DatabaseUser): SessionUser {
  return {
    id: row.id,
    email: row.email,
    role: row.role,
    rank: row.rank ?? 0,
    orgId: '',
    name: row.name,
    first_name: row.first_name ?? null,
    middle_name: row.middle_name ?? null,
    last_name: row.last_name ?? null,
    manager_id: row.manager_id ?? null,
    manager_name: row.manager_name ?? null,
    last_login_at: row.last_login_at ?? null,
    mobile: row.mobile ?? null,
    allowed_branches: row.allowed_branches,
    is_active: row.is_active,
    force_password_change: row.force_password_change,
  };
}

export function toSessionUsers(rows: DatabaseUser[]): SessionUser[] {
  return rows.map(toSessionUser);
}
