/**
 * Auth provider — unified PostgreSQL path.
 *
 * All user look-ups and last-login updates go directly to the PostgreSQL DB
 * via db-user.ts. There is one execution path regardless of environment.
 */
import {
  getUserByEmail as getDbUserByEmail,
  getUserById as getDbUserById,
  updateLastLogin as dbUpdateLastLogin,
} from "./db-user";
import type { DbUser } from "./db-user";

export async function getUserByEmailFromProvider(
  email: string,
  orgId?: string,
): Promise<DbUser | null> {
  return getDbUserByEmail(email, orgId);
}

export async function getUserByIdFromProvider(id: string): Promise<DbUser | null> {
  return getDbUserById(id);
}

export async function updateLastLoginFromProvider(
  userId: string,
  orgId: string,
): Promise<void> {
  return dbUpdateLastLogin(userId, orgId);
}
