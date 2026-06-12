/**
 * User queries — CRUD operations on users and org hierarchy views.
 */
import { withOrgTx, withTenantTx, withServiceTx } from "../transaction";
import { resolveLookupId } from "./lookups";
import type { User } from "@/src/types/db";
import * as bcrypt from "bcryptjs";

if (!process.env.BCRYPT_ROUNDS) throw new Error('BCRYPT_ROUNDS env var is not set');
const BCRYPT_ROUNDS = parseInt(process.env.BCRYPT_ROUNDS, 10);

/**
 * Get all users in an org.
 */
export async function getUsers(orgId: string, userId: string) {
  return withOrgTx(orgId, userId, async (tx) => {
    return tx`
      SELECT u.*, ur.name as role_name,
             m.full_name as manager_name,
             COUNT(ml.id) FILTER (WHERE NOT ml.is_deleted) as assigned_leads_count
      FROM users u
      JOIN user_roles ur ON ur.id = u.role_id
      LEFT JOIN users m ON m.id = u.manager_id
      LEFT JOIN marketing_leads ml ON ml.assigned_user_id = u.id
      WHERE u.org_id = ${orgId} AND NOT u.is_deleted
      GROUP BY u.id, ur.name, m.full_name
      ORDER BY ur.id, u.full_name
    `;
  });
}

/**
 * Get user by ID within org.
 */
export async function getUserById(
  orgId: string,
  userId: string,
  targetUserId: string,
) {
  return withOrgTx(orgId, userId, async (tx) => {
    const [user] = await tx`
      SELECT u.*, ur.name as role_name, m.full_name as manager_name
      FROM users u
      JOIN user_roles ur ON ur.id = u.role_id
      LEFT JOIN users m ON m.id = u.manager_id
      WHERE u.id = ${targetUserId} AND u.org_id = ${orgId} AND NOT u.is_deleted
    `;
    return user || null;
  });
}

/**
 * Get org chart for an org.
 */
export async function getOrgChart(orgId: string, userId: string) {
  return withOrgTx(orgId, userId, async (tx) => {
    return tx`
      SELECT * FROM vw_user_org_chart 
      WHERE org_id = ${orgId} 
      ORDER BY hierarchy_level, full_name
    `;
  });
}

/**
 * Get team members (reports) under a manager.
 */
export async function getTeamMembers(orgId: string, managerId: string) {
  return withOrgTx(orgId, managerId, async (tx) => {
    return tx`
      SELECT member_id, member_full_name, member_email, member_role, depth
      FROM vw_user_team_members
      WHERE manager_id = ${managerId} AND org_id = ${orgId} AND is_active = TRUE
      ORDER BY depth, member_full_name
    `;
  });
}

/**
 * Create a new user.
 */
export async function createUser(orgId: string, userId: string, data: any) {
  return withOrgTx(orgId, userId, async (tx) => {
    const roleId = await resolveLookupId("user_roles", data.roleName);
    const passwordHash = data.password
      ? await bcrypt.hash(data.password, BCRYPT_ROUNDS)
      : null;

    const [result] = await tx`
      INSERT INTO users
        (org_id, first_name, middle_name, last_name, email, mobile, role_id,
         manager_id, password_hash, password_changed_at, is_active, force_password_change)
      VALUES
        (${orgId}, ${data.firstName}, ${data.middleName ?? null}, ${data.lastName || ''},
         ${data.email}, ${data.mobile ?? null}, ${roleId}, ${data.managerId ?? null},
         ${passwordHash}, CLOCK_TIMESTAMP(), ${data.isActive ?? true},
         ${data.forcePasswordChange ?? true})
      RETURNING id
    `;
    return result;
  });
}

/**
 * Update a user.
 */
export async function updateUser(
  orgId: string,
  userId: string,
  targetUserId: string,
  data: any,
) {
  return withOrgTx(orgId, userId, async (tx) => {
    const updates: any = {};

    if (data.firstName !== undefined) updates.first_name = data.firstName;
    if (data.lastName !== undefined) updates.last_name = data.lastName;
    if (data.middleName !== undefined) updates.middle_name = data.middleName;
    if (data.email !== undefined) updates.email = data.email;
    if (data.mobile !== undefined) updates.mobile = data.mobile;
    if (data.forcePasswordChange !== undefined) updates.force_password_change = data.forcePasswordChange;
    if (data.role !== undefined)
      updates.role_id = await resolveLookupId("user_roles", data.role);
    if (data.is_active !== undefined) updates.is_active = data.is_active;
    // Camelcase API fields (take precedence if both are sent)
    if (data.roleName !== undefined)
      updates.role_id = await resolveLookupId("user_roles", data.roleName);
    if (data.isActive !== undefined) updates.is_active = data.isActive;
    if (data.managerId !== undefined) updates.manager_id = data.managerId;
    // allowed_branches: no-op in PostgreSQL path (scoping is by org_id)

    if (data.password !== undefined) {
      updates.password_hash = await bcrypt.hash(data.password, BCRYPT_ROUNDS);
      updates.password_changed_at = new Date();
    }

    // Role change: bump password_changed_at so any existing JWT for this user
    // fails the pwd_iat watermark check on the next request. Forces a fresh
    // login that mints a token with the correct rank. Skipped if a password
    // change already set it above (both cause the same invalidation effect).
    const roleChanging = data.role !== undefined || data.roleName !== undefined;
    if (roleChanging && updates.password_changed_at === undefined) {
      updates.password_changed_at = new Date();
    }

    if (Object.keys(updates).length === 0) return null;

    const [result] = await tx`
      UPDATE users
      SET ${tx(updates)}
      WHERE id = ${targetUserId} AND org_id = ${orgId} AND NOT is_deleted
      RETURNING id, password_changed_at
    `;
    return result;
  });
}

/**
 * Soft-delete a user.
 */
export async function deleteUser(
  orgId: string,
  userId: string,
  targetUserId: string,
) {
  return withOrgTx(orgId, userId, async (tx) => {
    await tx`DELETE FROM users WHERE id = ${targetUserId} AND org_id = ${orgId}`;
  });
}
