/**
 * Shared authentication & RBAC types.
 *
 * Framework-agnostic and dependency-free so it can be imported from anywhere
 * (server, client, Edge, tests) without pulling in heavy modules.
 *
 * The single source of truth for the role union is the `ROLES` tuple in
 * `@/src/features/auth/constants`. `UserRole` is derived from it so adding a
 * role in one place updates the type everywhere — no drift.
 */
import type { ROLES } from '@/src/features/auth/constants';

/** admin | manager | sales — extend via the ROLES tuple, not here. */
export type UserRole = (typeof ROLES)[number];

/**
 * The authenticated user as exposed to application code (server + client).
 * Intentionally minimal — no password hash, no internal columns ever leak
 * into this shape.
 */
export interface SessionUser {
  id: string;
  email: string;
  role: UserRole;
  /**
   * Privilege rank sourced from user_roles.rank in PostgreSQL (via JWT).
   * Higher = more access. Use this for all server-side permission checks
   * instead of looking up ROLE_RANK[user.role] from constants.
   * Defaults to 0 on legacy Supabase path.
   */
  rank: number;
  orgId: string;
  /** Human-readable org name. Populated on local-auth path; null for Supabase. */
  orgName?: string | null;
  /** Human-readable tenant name. Populated on local-auth path; null for Supabase. */
  tenantName?: string | null;
  /** Human-readable role label from user_roles.label. Populated on local-auth path. */
  roleLabel?: string;
  /** Full display name (generated from first/middle/last). */
  name: string | null;
  /** Individual name components — populated from the admin users list; absent from JWT. */
  first_name?: string | null;
  middle_name?: string | null;
  last_name?: string | null;
  /** Manager (adjacency-list hierarchy). Populated from the admin users list. */
  manager_id?: string | null;
  manager_name?: string | null;
  /** Last successful login — informational display only. */
  last_login_at?: string | null;
  /** Mobile number. */
  mobile?: string | null;
  /**
   * Branch scopes for non-admin users (sheet/tab names). An EMPTY array means
   * unrestricted — admins are always unrestricted regardless of this field.
   * This is the foundation for branch-scoped RBAC; `canAccessBranch` in
   * src/lib/permissions/index.ts is the only place that interprets it today.
   */
  allowed_branches: string[];
  /**
   * Whether the user's account is enabled. Always `true` for the CURRENT
   * authenticated session (inactive users cannot log in), but may be `false`
   * for OTHER users surfaced via admin endpoints like GET /api/users.
   */
  is_active: boolean;
  /**
   * When true, the user must set a new password before reaching protected
   * routes. Set by admin reset; cleared once the user chooses their own.
   */
  force_password_change: boolean;
}

/** Credentials submitted to the (future) login endpoint. */
export interface LoginPayload {
  email: string;
  password: string;
}

/**
 * The signed JWT body. Custom claims are kept flat and minimal to keep the
 * token small. `iat` / `exp` are added/managed by the signing library and are
 * optional on the way in.
 */
export interface JwtPayload {
  /** Subject — the user's primary id. */
  sub: string;
  email: string;
  role: UserRole;
  /** Privilege rank from user_roles.rank — baked in at login time. */
  rank: number;
  /** Organisation the user belongs to. */
  orgId: string;
  /**
   * Password watermark — epoch SECONDS of `users.password_changed_at` at sign
   * time. The session resolver rejects the token if the row's current
   * password_changed_at is newer than this. This is what makes a password
   * reset invalidate every previously-issued token.
   */
  pwd_iat: number;
  /** Issued-at (epoch seconds) — set by the signer. */
  iat?: number;
  /** Expiry (epoch seconds) — set by the signer. */
  exp?: number;
}

/** Discriminated result for verification helpers — no throwing on bad tokens. */
export type JwtVerifyResult =
  | { valid: true; payload: JwtPayload }
  | { valid: false; error: string };
