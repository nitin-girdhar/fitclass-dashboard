import { User } from "@/src/types/db";
import { withServiceTx } from "../db/transaction";
import type { OrgAccess, UserRole } from "@/src/types/auth";

export interface DbUser extends User {}

const USER_SELECT = `
  u.id,
  u.org_id                  AS "orgId",
  u.first_name              AS "firstName",
  u.middle_name             AS "middleName",
  u.last_name               AS "lastName",
  u.full_name               AS "fullName",
  u.email,
  u.role_id                 AS "roleId",
  ur.name                   AS "role",
  ur.rank                   AS "rank",
  ur.label                  AS "roleLabel",
  u.manager_id              AS "managerId",
  u.is_active               AS "isActive",
  u.password_hash              AS "passwordHash",
  u.password_changed_at        AS "passwordChangedAt",
  u.force_password_change      AS "forcePasswordChange",
  u.last_login_at              AS "lastLoginAt",
  u.is_deleted              AS "isDeleted",
  u.created_at              AS "createdAt",
  u.updated_at              AS "updatedAt",
  o.name                    AS "orgName",
  o.tenant_id               AS "tenantId",
  t.name                    AS "tenantName"
`;

/**
 * Get user by email. Since email is unique per org, this returns the first match.
 * Provide orgId for exact scoping (recommended in production).
 */
export async function getUserByEmail(
  email: string,
  orgId?: string,
): Promise<DbUser | null> {
  return withServiceTx(async (tx) => {
    let rows: DbUser[];

    if (orgId) {
      rows = await tx.unsafe(
        `SELECT ${USER_SELECT}
         FROM users u
         JOIN user_roles ur ON ur.id = u.role_id
         LEFT JOIN organizations o ON o.id = u.org_id
         LEFT JOIN tenants t ON t.id = o.tenant_id
         WHERE u.email = $1 AND u.org_id = $2 AND NOT u.is_deleted
         LIMIT 1`,
        [email, orgId],
      );
    } else {
      rows = await tx.unsafe(
        `SELECT ${USER_SELECT}
         FROM users u
         JOIN user_roles ur ON ur.id = u.role_id
         LEFT JOIN organizations o ON o.id = u.org_id
         LEFT JOIN tenants t ON t.id = o.tenant_id
         WHERE u.email = $1 AND NOT u.is_deleted
         LIMIT 1`,
        [email],
      );
    }

    return rows[0] ?? null;
  });
}

/**
 * Get user by ID.
 */
export async function getUserById(id: string): Promise<DbUser | null> {
  return withServiceTx(async (tx) => {
    const rows: DbUser[] = await tx.unsafe(
      `SELECT ${USER_SELECT}
       FROM users u
       JOIN user_roles ur ON ur.id = u.role_id
       LEFT JOIN organizations o ON o.id = u.org_id
       LEFT JOIN tenants t ON t.id = o.tenant_id
       WHERE u.id = $1 AND NOT u.is_deleted
       LIMIT 1`,
      [id],
    );
    return rows[0] ?? null;
  });
}

/**
 * Return all active org access rows for a user — used during login
 * to build the org picker when a user belongs to multiple orgs.
 */
export async function getUserOrgAccess(userId: string): Promise<OrgAccess[]> {
  return withServiceTx(async (tx) => {
    const rows = await tx.unsafe(
      `SELECT
         uoa.org_id        AS "orgId",
         o.name            AS "orgName",
         ur.name           AS "role",
         ur.rank           AS "rank",
         ur.label          AS "roleLabel"
       FROM user_org_access uoa
       JOIN organizations o  ON o.id    = uoa.org_id
       JOIN user_roles    ur ON ur.id   = uoa.role_id
       WHERE uoa.user_id  = $1
         AND uoa.is_active = true
         AND NOT o.is_deleted
       ORDER BY o.name`,
      [userId],
    );
    return rows as OrgAccess[];
  });
}

/**
 * Update last login timestamp for a user.
 */
export async function updateLastLogin(
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
