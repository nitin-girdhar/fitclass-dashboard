/**
 * Supabase provider wrapper — legacy auth source.
 * Adapts existing Supabase getUserByEmail/getUserById to new DbUser interface.
 */
import { getSupabaseAdmin } from "@/src/lib/db/supabase";
import type { DatabaseUser } from "@/src/types/database";
import type { DbUser } from "./db-user";

/**
 * Convert DatabaseUser (Supabase schema) to DbUser (PostgreSQL schema) interface.
 * This maps the old user structure to the new one for compatibility.
 */
function databaseUserToDbUser(user: DatabaseUser): DbUser {
  return {
    id: user.id,
    orgId: "", // Supabase schema doesn't have org isolation; use empty
    firstName: user.name.split(" ")[0] || "",
    lastName: user.name.split(" ").slice(1).join(" ") || "",
    middleName: null,
    fullName: user.name,
    email: user.email,
    roleId: 0, // Supabase uses role string, not ID; map later or use 0
    managerId: null,
    isActive: user.is_active,
    passwordHash: user.password_hash,
    passwordChangedAt: user.password_changed_at,
    lastLoginAt: null,
    isDeleted: false,
    createdAt: user.created_at,
    updatedAt: user.updated_at,
  };
}

/**
 * Look up a user by email (Supabase legacy path).
 */
export async function getUserByEmailFromSupabase(
  email: string,
): Promise<DbUser | null> {
  const normalised = email.trim().toLowerCase();

  try {
    const { data, error } = await getSupabaseAdmin()
      .from("users")
      .select("*")
      .eq("email", normalised)
      .maybeSingle();

    if (error) {
      console.error("[Supabase] getUserByEmail error:", error);
      return null;
    }
    return data ? databaseUserToDbUser(data as DatabaseUser) : null;
  } catch (err) {
    console.error("[Supabase] getUserByEmail exception:", err);
    return null;
  }
}

/**
 * Look up a user by ID (Supabase legacy path).
 */
export async function getUserByIdFromSupabase(
  id: string,
): Promise<DbUser | null> {
  try {
    const { data, error } = await getSupabaseAdmin()
      .from("users")
      .select("*")
      .eq("id", id)
      .maybeSingle();

    if (error) {
      console.error("[Supabase] getUserById error:", error);
      return null;
    }
    return data ? databaseUserToDbUser(data as DatabaseUser) : null;
  } catch (err) {
    console.error("[Supabase] getUserById exception:", err);
    return null;
  }
}

/**
 * Update last login timestamp (Supabase legacy path).
 */
export async function updateLastLoginFromSupabase(
  userId: string,
): Promise<void> {
  try {
    await getSupabaseAdmin()
      .from("users")
      .update({ last_login_at: new Date().toISOString() })
      .eq("id", userId);
  } catch (err) {
    console.error("[Supabase] updateLastLogin exception:", err);
  }
}
