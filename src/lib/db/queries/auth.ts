/**
 * Auth-specific DB queries.
 * These run under service_role (no RLS) because at login time the org
 * context is not yet established.
 */
import { withServiceTx } from "../transaction";
import type { User } from "@/src/types/db";

/**
 * Look up an active user by email. Optionally scoped to a specific org.
 * Returns the user with role name joined from user_roles.
 */
export async function findUserByEmail(
  email: string,
  orgId?: string,
): Promise<(User & { role: string }) | null> {
  return withServiceTx(async (tx) => {
    const rows = orgId
      ? await tx.unsafe(
          `SELECT u.*, ur.name AS role
           FROM users u
           JOIN user_roles ur ON ur.id = u.role_id
           WHERE u.email = $1 AND u.org_id = $2 AND NOT u.is_deleted AND u.is_active
           LIMIT 1`,
          [email, orgId],
        )
      : await tx.unsafe(
          `SELECT u.*, ur.name AS role
           FROM users u
           JOIN user_roles ur ON ur.id = u.role_id
           WHERE u.email = $1 AND NOT u.is_deleted AND u.is_active
           LIMIT 1`,
          [email],
        );
    return (rows[0] as (User & { role: string })) ?? null;
  });
}

/**
 * Look up an active user by ID.
 */
export async function findUserById(
  id: string,
): Promise<(User & { role: string }) | null> {
  return withServiceTx(async (tx) => {
    const rows = await tx.unsafe(
      `SELECT u.*, ur.name AS role
       FROM users u
       JOIN user_roles ur ON ur.id = u.role_id
       WHERE u.id = $1 AND NOT u.is_deleted
       LIMIT 1`,
      [id],
    );
    return (rows[0] as (User & { role: string })) ?? null;
  });
}

/**
 * Stamp the last login time for a user.
 */
export async function stampLastLogin(
  userId: string,
  orgId: string,
): Promise<void> {
  return withServiceTx(async (tx) => {
    await tx`
      UPDATE users
      SET last_login_at = CLOCK_TIMESTAMP()
      WHERE id = ${userId} AND org_id = ${orgId}
    `;
  });
}

/**
 * Update password hash and reset the password watermark.
 * Returns the new password_changed_at epoch seconds for JWT minting.
 */
export async function updatePasswordHash(
  userId: string,
  orgId: string,
  passwordHash: string,
): Promise<number> {
  return withServiceTx(async (tx) => {
    const [row] = await tx`
      UPDATE users
      SET password_hash        = ${passwordHash},
          password_changed_at  = CLOCK_TIMESTAMP()
      WHERE id = ${userId} AND org_id = ${orgId}
      RETURNING EXTRACT(EPOCH FROM password_changed_at)::bigint AS pwd_epoch
    `;
    if (!row) throw new Error(`User ${userId} not found in org ${orgId}`);
    return Number(row.pwd_epoch);
  });
}
