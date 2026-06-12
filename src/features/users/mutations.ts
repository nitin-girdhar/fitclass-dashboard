/**
 * User WRITE layer.
 *
 * SERVER-ONLY. Uses `getSupabaseAdmin()` (service role, bypasses RLS). Callers must
 * pass an ALREADY-HASHED password (hashing belongs to src/lib/auth/password.ts
 * — this layer never sees plaintext). Emails are normalised to lowercase to
 * satisfy the DB's lowercase check + case-insensitive unique index.
 */
import { getSupabaseAdmin } from '@/src/lib/db/supabase';
import { fromPostgrestError } from '@/src/lib/db/errors';
import type {
  DatabaseUser,
  DatabaseUserInsert,
  DatabaseUserUpdate,
} from '@/src/types/database';

const USERS_TABLE = 'users';

// Single typed boundary for the untyped shared client (see queries.ts note).
function asUser(row: unknown): DatabaseUser {
  return row as DatabaseUser;
}

/** Insert a new user. `password_hash` must already be a bcrypt hash. */
export async function createUser(
  input: DatabaseUserInsert,
): Promise<DatabaseUser> {
  const payload: DatabaseUserInsert = {
    ...input,
    email: input.email.trim().toLowerCase(),
  };

  const { data, error } = await getSupabaseAdmin()
    .from(USERS_TABLE)
    .insert(payload)
    .select('*')
    .single();

  if (error) throw fromPostgrestError(error);
  return asUser(data);
}

/**
 * Patch mutable user columns. `updated_at` is maintained by a DB trigger, so
 * it is intentionally NOT set here.
 */
export async function updateUser(
  id: string,
  patch: DatabaseUserUpdate,
): Promise<DatabaseUser> {
  const { data, error } = await getSupabaseAdmin()
    .from(USERS_TABLE)
    .update(patch)
    .eq('id', id)
    .select('*')
    .single();

  if (error) throw fromPostgrestError(error);
  return asUser(data);
}

/** Enable/disable a user (soft access control; no row deletion). */
export async function setUserActive(
  id: string,
  isActive: boolean,
): Promise<DatabaseUser> {
  return updateUser(id, { is_active: isActive });
}
