/**
 * User WRITE layer. SERVER-ONLY.
 *
 * Uses withServiceTx (service role, bypasses RLS). Emails are normalised to
 * lowercase. Callers pass an ALREADY-HASHED password for createUser; updateUser
 * accepts raw password_hash for admin-driven resets, or use the higher-level
 * pgUsersQueries.updateUser when the plaintext password needs to be hashed.
 */
import { withServiceTx } from "@/src/lib/db/transaction";
import { fromPgError, DatabaseError, notFound } from "@/src/lib/db/errors";
import type {
  DatabaseUser,
  DatabaseUserInsert,
  DatabaseUserUpdate,
} from "@/src/types/database";

function mapRow(r: any, roleOverride?: string): DatabaseUser {
  return {
    id: r.id as string,
    name: (r.name ?? r.full_name ?? r.email) as string,
    email: r.email as string,
    password_hash: (r.password_hash ?? "") as string,
    role: (r.role ?? roleOverride ?? "sales_representative") as any,
    rank: Number(r.rank ?? 0),
    allowed_branches: [],
    is_active: Boolean(r.is_active),
    password_changed_at: String(r.password_changed_at ?? r.created_at ?? ""),
    force_password_change: Boolean(r.force_password_change),
    created_at: String(r.created_at ?? ""),
    updated_at: String(r.updated_at ?? r.created_at ?? ""),
  };
}

/**
 * Insert a new user. `password_hash` must already be a bcrypt hash.
 *
 * `org_id` is required for multi-tenant setups. If omitted the row is
 * inserted with org_id = NULL, which is only valid for bootstrap scenarios
 * (e.g. the seed-admin script before any org exists).
 */
export async function createUser(
  input: DatabaseUserInsert & { org_id?: string },
): Promise<DatabaseUser> {
  return withServiceTx(async (tx) => {
    try {
      let roleId: number | null = null;
      if (input.role) {
        const [roleRow] = await tx.unsafe(
          `SELECT id FROM user_roles WHERE name = $1 LIMIT 1`,
          [input.role],
        );
        if (!roleRow) {
          throw new DatabaseError(
            "not_found",
            `Role '${input.role}' not found`,
          );
        }
        roleId = (roleRow as any).id;
      }

      const rows = await tx.unsafe(
        `INSERT INTO users
           (org_id, full_name, email, password_hash, role_id, is_active,
            force_password_change, password_changed_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, CLOCK_TIMESTAMP())
         RETURNING id, full_name AS name, email, password_hash, is_active,
                   force_password_change, password_changed_at, created_at, updated_at`,
        [
          input.org_id ?? null,
          input.name,
          input.email.trim().toLowerCase(),
          input.password_hash,
          roleId,
          input.is_active ?? true,
          input.force_password_change ?? false,
        ],
      );

      if (!rows.length)
        throw new DatabaseError("unknown", "Insert returned no rows");
      return mapRow(rows[0], input.role);
    } catch (err) {
      if (err instanceof DatabaseError) throw err;
      throw fromPgError(err);
    }
  });
}

/**
 * Patch mutable user columns by primary key. Dynamic SET built from the
 * patch object — only provided fields are written.
 */
export async function updateUser(
  id: string,
  patch: DatabaseUserUpdate,
): Promise<DatabaseUser> {
  return withServiceTx(async (tx) => {
    try {
      const sets: string[] = [];
      const params: unknown[] = [];
      let idx = 1;

      if (patch.name !== undefined) {
        sets.push(`full_name = $${idx++}`);
        params.push(patch.name);
      }
      if (patch.password_hash !== undefined) {
        sets.push(`password_hash = $${idx++}`);
        params.push(patch.password_hash);
      }
      if (patch.is_active !== undefined) {
        sets.push(`is_active = $${idx++}`);
        params.push(patch.is_active);
      }
      if (patch.password_changed_at !== undefined) {
        sets.push(`password_changed_at = $${idx++}`);
        params.push(new Date(patch.password_changed_at));
      }
      if (patch.force_password_change !== undefined) {
        sets.push(`force_password_change = $${idx++}`);
        params.push(patch.force_password_change);
      }
      if (patch.role !== undefined) {
        const [roleRow] = await tx.unsafe(
          `SELECT id FROM user_roles WHERE name = $1 LIMIT 1`,
          [patch.role],
        );
        if (!roleRow) {
          throw new DatabaseError(
            "not_found",
            `Role '${patch.role}' not found`,
          );
        }
        sets.push(`role_id = $${idx++}`);
        params.push((roleRow as any).id);
      }

      if (sets.length === 0)
        throw new DatabaseError("unknown", "No fields to update");

      params.push(id);
      const rows = await tx.unsafe(
        `UPDATE users
         SET ${sets.join(", ")}
         WHERE id = $${idx} AND NOT is_deleted
         RETURNING id, full_name AS name, email, password_hash, is_active,
                   force_password_change, password_changed_at, created_at, updated_at`,
        params,
      );

      if (!rows.length) throw notFound("User");
      return mapRow(rows[0], patch.role);
    } catch (err) {
      if (err instanceof DatabaseError) throw err;
      throw fromPgError(err);
    }
  });
}

/** Enable/disable a user (soft access control; no row deletion). */
export async function setUserActive(
  id: string,
  isActive: boolean,
): Promise<DatabaseUser> {
  return updateUser(id, { is_active: isActive });
}
