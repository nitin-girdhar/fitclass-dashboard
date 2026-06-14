/**
 * User READ layer. SERVER-ONLY.
 *
 * All queries target the PostgreSQL DB directly via withServiceTx.
 */
import { withServiceTx } from '@/src/lib/db/transaction';
import type { DatabaseUser } from '@/src/types/database';
import type { UserRole } from '@/src/types/auth';

function mapUserRow(r: any): DatabaseUser {
  return {
    id:                    r.id as string,
    name:                  (r.name ?? r.email) as string,
    first_name:            (r.first_name ?? null) as string | null,
    middle_name:           (r.middle_name ?? null) as string | null,
    last_name:             (r.last_name ?? null) as string | null,
    manager_id:            (r.manager_id ?? null) as string | null,
    manager_name:          (r.manager_name ?? null) as string | null,
    last_login_at:         r.last_login_at ? String(r.last_login_at) : null,
    email:                 r.email as string,
    mobile:                (r.mobile ?? null) as string | null,
    password_hash:         (r.password_hash ?? '') as string,
    role:                  r.role as UserRole,
    rank:                  Number(r.rank ?? 0),
    is_active:             r.is_active as boolean,
    password_changed_at:   String(r.password_changed_at ?? r.created_at ?? ''),
    force_password_change: Boolean(r.force_password_change),
    created_at:            String(r.created_at ?? ''),
    updated_at:            String(r.updated_at ?? r.created_at ?? ''),
  };
}

/** Look up a user by email. Email is normalised to lowercase. Returns null when absent. */
export async function getUserByEmail(email: string): Promise<DatabaseUser | null> {
  return withServiceTx(async (tx) => {
    const rows = await tx.unsafe(`
      SELECT u.id, COALESCE(u.full_name, u.email) AS name, u.email,
             ur.name AS role, ur.rank AS rank, u.is_active, u.created_at
      FROM users u
      JOIN user_roles ur ON ur.id = u.role_id
      WHERE LOWER(u.email) = LOWER($1) AND NOT u.is_deleted
      LIMIT 1
    `, [email.trim().toLowerCase()]);

    if (!rows.length) return null;
    return mapUserRow(rows[0]);
  });
}

/** Look up a user by primary id. Returns null when absent. */
export async function getUserById(id: string): Promise<DatabaseUser | null> {
  return withServiceTx(async (tx) => {
    const rows = await tx.unsafe(`
      SELECT u.id, COALESCE(u.full_name, u.email) AS name, u.email,
             ur.name AS role, ur.rank AS rank, u.is_active, u.created_at
      FROM users u
      JOIN user_roles ur ON ur.id = u.role_id
      WHERE u.id = $1 AND NOT u.is_deleted
      LIMIT 1
    `, [id]);

    if (!rows.length) return null;
    return mapUserRow(rows[0]);
  });
}

/**
 * List users (newest first).
 * Pass orgIds to scope to specific orgs; null/undefined returns all.
 */
export async function listUsers(orgIds?: string[] | null): Promise<DatabaseUser[]> {
  return withServiceTx(async (tx) => {
    if (orgIds && orgIds.length === 0) return [];

    const orgFilter = orgIds ? 'AND u.org_id = ANY($1::uuid[])' : '';
    const params: unknown[] = orgIds ? [orgIds] : [];

    const rows = await tx.unsafe(`
      SELECT
        u.id,
        u.first_name,
        u.middle_name,
        u.last_name,
        COALESCE(u.full_name, u.email) AS name,
        u.email,
        u.mobile,
        ur.name                         AS role,
        ur.rank                         AS rank,
        u.is_active,
        u.force_password_change,
        u.last_login_at,
        u.manager_id,
        m.full_name                     AS manager_name,
        u.created_at,
        u.updated_at
      FROM users u
      JOIN user_roles ur ON ur.id = u.role_id
      LEFT JOIN users m ON m.id = u.manager_id
      WHERE NOT u.is_deleted ${orgFilter}
      ORDER BY u.created_at DESC
    `, params);

    return (rows as any[]).map(mapUserRow);
  });
}

/**
 * Count active admins. Used for idempotency checks and to guard against
 * demoting/deactivating the last admin.
 */
export async function countActiveAdmins(): Promise<number> {
  return withServiceTx(async (tx) => {
    const rows = await tx.unsafe(`
      SELECT COUNT(*) AS count
      FROM users u
      JOIN user_roles ur ON ur.id = u.role_id
      WHERE ur.name = 'org_admin' AND u.is_active = true AND NOT u.is_deleted
    `);
    return Number((rows[0] as any)?.count ?? 0);
  });
}
