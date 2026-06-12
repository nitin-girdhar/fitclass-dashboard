/**
 * Auth provider abstraction layer.
 * Switches between Supabase and PostgreSQL-native auth based on AUTH_PROVIDER env var.
 */
import {
  getUserByEmail as getDbUserByEmail,
  getUserById as getDbUserById,
  updateLastLogin as dbUpdateLastLogin,
} from "./db-user";
import type { DbUser } from "./db-user";

const AUTH_PROVIDER = process.env.AUTH_PROVIDER ?? "supabase";

/**
 * Get user by email and optional org ID.
 * Returns null if not found.
 */
export async function getUserByEmailFromProvider(
  email: string,
  orgId?: string,
): Promise<DbUser | null> {
  if (AUTH_PROVIDER === "local") {
    return getDbUserByEmail(email, orgId);
  }
  // For supabase provider, delegate to supabase-provider
  const { getUserByEmailFromSupabase } = await import("./supabase-provider");
  return getUserByEmailFromSupabase(email);
}

/**
 * Get user by ID.
 * Returns null if not found.
 */
export async function getUserByIdFromProvider(
  id: string,
): Promise<DbUser | null> {
  if (AUTH_PROVIDER === "local") {
    return getDbUserById(id);
  }
  const { getUserByIdFromSupabase } = await import("./supabase-provider");
  return getUserByIdFromSupabase(id);
}

/**
 * Update last login timestamp for a user.
 */
export async function updateLastLoginFromProvider(
  userId: string,
  orgId: string,
): Promise<void> {
  if (AUTH_PROVIDER === "local") {
    return dbUpdateLastLogin(userId, orgId);
  }
  const { updateLastLoginFromSupabase } = await import("./supabase-provider");
  return updateLastLoginFromSupabase(userId);
}
