/**
 * User READ layer.
 *
 * Dual-path: when AUTH_PROVIDER=local, queries the PostgreSQL DB directly
 * via withServiceTx. Otherwise falls back to the Supabase admin client.
 *
 * SERVER-ONLY.
 */
import { getSupabaseAdmin } from '@/src/lib/db/supabase';
import { fromPostgrestError } from '@/src/lib/db/errors';
import { withServiceTx } from '@/src/lib/db/transaction';
import type { DatabaseUser } from '@/src/types/database';
import type { UserRole } from '@/src/types/auth';

const AUTH_PROVIDER = process.env.AUTH_PROVIDER ?? 'supabase';

// ── PostgreSQL path ───────────────────────────────────────────────────────────

async function listUsersFromPostgres(orgIds?: string[]): Promise<DatabaseUser[]> {
  return withServiceTx(async (tx) => {
    // Empty orgIds means the actor has access to no orgs — return nothing.
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
        u.created_at
      FROM users u
      JOIN user_roles ur ON ur.id = u.role_id
      LEFT JOIN users m ON m.id = u.manager_id
      WHERE NOT u.is_deleted ${orgFilter}
      ORDER BY u.created_at DESC
    `, params);

    return (rows as any[]).map((r) => ({
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
      password_hash:         '',
      role:                  r.role as UserRole,
      rank:                  (r.rank as number) ?? 0,
      allowed_branches:      [] as string[],
      is_active:             r.is_active as boolean,
      password_changed_at:   String(r.created_at ?? ''),
      force_password_change: Boolean(r.force_password_change),
      created_at:            String(r.created_at ?? ''),
      updated_at:            String(r.created_at ?? ''),
    }));
  });
}

async function getUserByEmailFromPostgres(email: string): Promise<DatabaseUser | null> {
  return withServiceTx(async (tx) => {
    const rows = await tx.unsafe(`
      SELECT u.id, COALESCE(u.full_name, u.email) AS name, u.email,
             ur.name AS role, ur.rank AS rank, u.is_active, u.created_at
      FROM users u
      JOIN user_roles ur ON ur.id = u.role_id
      WHERE LOWER(u.email) = LOWER($1) AND NOT u.is_deleted
      LIMIT 1
    `, [email]);

    if (!rows.length) return null;
    const r = rows[0] as any;
    return {
      id: r.id, name: r.name ?? r.email, email: r.email,
      password_hash: '', role: r.role as UserRole, rank: (r.rank as number) ?? 0,
      allowed_branches: [], is_active: r.is_active,
      password_changed_at: String(r.created_at ?? ''),
      force_password_change: false,
      created_at: String(r.created_at ?? ''),
      updated_at: String(r.created_at ?? ''),
    };
  });
}

async function getUserByIdFromPostgres(id: string): Promise<DatabaseUser | null> {
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
    const r = rows[0] as any;
    return {
      id: r.id, name: r.name ?? r.email, email: r.email,
      password_hash: '', role: r.role as UserRole, rank: (r.rank as number) ?? 0,
      allowed_branches: [], is_active: r.is_active,
      password_changed_at: String(r.created_at ?? ''),
      force_password_change: false,
      created_at: String(r.created_at ?? ''),
      updated_at: String(r.created_at ?? ''),
    };
  });
}

// ── Supabase path (legacy) ────────────────────────────────────────────────────

const USERS_TABLE = 'users';

// The shared client is intentionally untyped (no generated Database generic
// yet). We assert the row shape at this single data-access boundary so the
// rest of the app stays fully typed without `any`. When `supabase gen types`
// is introduced, these casts can be removed wholesale.
function asUser(row: unknown): DatabaseUser {
  return row as DatabaseUser;
}
function asUsers(rows: unknown): DatabaseUser[] {
  return (rows as DatabaseUser[] | null) ?? [];
}

/**
 * Look up a user by email. Email is normalised to lowercase to match the
 * DB's case-insensitive uniqueness. Returns null when absent (not an error).
 */
export async function getUserByEmail(
  email: string,
): Promise<DatabaseUser | null> {
  if (AUTH_PROVIDER === 'local') return getUserByEmailFromPostgres(email);

  const normalised = email.trim().toLowerCase();
  const { data, error } = await getSupabaseAdmin()
    .from(USERS_TABLE)
    .select('*')
    .eq('email', normalised)
    .maybeSingle();

  if (error) throw fromPostgrestError(error);
  return data ? asUser(data) : null;
}

/** Look up a user by primary id. Returns null when absent. */
export async function getUserById(id: string): Promise<DatabaseUser | null> {
  if (AUTH_PROVIDER === 'local') return getUserByIdFromPostgres(id);

  const { data, error } = await getSupabaseAdmin()
    .from(USERS_TABLE)
    .select('*')
    .eq('id', id)
    .maybeSingle();

  if (error) throw fromPostgrestError(error);
  return data ? asUser(data) : null;
}

/**
 * List users (newest first).
 * Pass orgIds (from resolveActorOrgIds) to scope to specific orgs;
 * null or omit to return all (super_admin path).
 */
export async function listUsers(orgIds?: string[] | null): Promise<DatabaseUser[]> {
  if (AUTH_PROVIDER === 'local') return listUsersFromPostgres(orgIds ?? undefined);

  const { data, error } = await getSupabaseAdmin()
    .from(USERS_TABLE)
    .select('*')
    .order('created_at', { ascending: false });

  if (error) throw fromPostgrestError(error);
  return asUsers(data);
}

/**
 * Count active admins. Used by the seed script for idempotency and (later) to
 * guard against demoting/deactivating the last admin.
 */
export async function countActiveAdmins(): Promise<number> {
  const { count, error } = await getSupabaseAdmin()
    .from(USERS_TABLE)
    .select('id', { count: 'exact', head: true })
    .eq('role', 'admin')
    .eq('is_active', true);

  if (error) throw fromPostgrestError(error);
  return count ?? 0;
}
