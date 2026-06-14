/**
 * Pure RBAC predicates — runtime-agnostic (server, client, Edge, tests).
 *
 * THIS FILE IS THE *POLICY*, NOT THE *ENFORCEMENT*. These functions answer
 * "is this allowed?" — they DO NOT redirect, throw, or return HTTP responses.
 * Enforcement happens at two places:
 *   - server pages/layouts → src/lib/permissions/server.ts (requireRole...)
 *   - API route handlers   → src/lib/auth/session.ts (requireSession) +
 *                            these predicates + your own NextResponse
 *
 * WHY FRONTEND-ONLY RBAC IS INSECURE:
 *   Anything we hide in the browser is still reachable by typing the URL,
 *   editing JS in DevTools, or calling the API directly with curl. The UI
 *   uses these predicates to hide buttons the user can't act on (UX);
 *   the SERVER must re-check before performing the action (security).
 *
 * No I/O, no async — every predicate is sync and side-effect-free so it can
 * be called inside render and tight loops without thought.
 */
import type { SessionUser, UserRole } from "@/src/types/auth";
import { ROLE_RANK, isSalesRole } from "@/src/features/auth/constants";
import { RANKS } from "./ranks";
export { isSalesRole };

// ── Role identity / hierarchy ────────────────────────────────────────────────

export function hasRole(
  user: SessionUser | null | undefined,
  role: UserRole,
): boolean {
  return !!user && user.role === role;
}

/**
 * True when the user's privilege rank is >= the minimum required rank.
 * Uses user.rank (from DB via JWT) for the actor; ROLE_RANK for the min threshold.
 */
export function hasMinimumRole(
  user: SessionUser | null | undefined,
  min: UserRole,
): boolean {
  if (!user) return false;
  return user.rank >= ROLE_RANK[min];
}

// ── Action-level permissions ─────────────────────────────────────────────────
// These wrap role checks behind intent-named helpers so call sites read like
// the product requirement, not like an org chart. When permissions later
// become more granular (e.g. per-feature flags from the DB), the call sites
// don't change — only the body of the helper does.

/**
 * Whether the actor has ANY user-creation authority at all (Phase 2W).
 *
 * Admin + manager can mint users; SSE + SE cannot. This is the gate for the
 * user-creation API surface. The VIEW gate is `canManageUsersView` below —
 * SSE can list users (to see their team) without being able to create them.
 */
export function canManageUsers(user: SessionUser | null | undefined): boolean {
  if (!user) return false;
  return user.rank >= RANKS.MANAGER;
}

/**
 * View-only gate for the user-management surface (Phase 2W).
 *
 * SSE can list users in their branch (so they see who reports to them),
 * but the row-level `canCreateUser` predicate decides whether the Edit
 * button is shown — for SSE it is always false. SE has no surface at all.
 */
export function canManageUsersView(
  user: SessionUser | null | undefined,
): boolean {
  if (!user) return false;
  return user.rank >= RANKS.SSE;
}

/**
 * Hierarchical user-creation authority (Phase 2W — final spec).
 *
 *   actor \ target │ sr_mgr │ manager │ sse │ sales_representative
 *   ───────────────┼────────┼─────────┼─────┼──────────
 *   admin (80)     │   ✓    │    ✓    │  ✓  │    ✓
 *   sr_manager(70) │   ✗    │    ✓    │  ✓  │    ✓
 *   manager (60)   │   ✗    │    ✗    │  ✓  │    ✓
 *   sse / below    │   ✗    │    ✗    │  ✗  │    ✗
 *
 * Rule: actor must strictly outrank target (actorRank > targetRank).
 * Minimum actor rank is MANAGER (60) — SSE and below cannot create users.
 * No one can create a peer or superior.
 *
 * ── Same rule covers EDIT, not just CREATE ─────────────────────────────────
 *  Editing a user's role is asserting a new role assignment. The PATCH
 *  handler calls this TWICE: against the target's CURRENT role (may the
 *  actor touch this user at all?) and against the patch's NEW role (may
 *  the actor place them there?). Both must be true.
 */
export function canCreateUser(actorRank: number, targetRank: number): boolean {
  // Actor must strictly outrank target — no one can create a peer or superior.
  // MANAGER (60) is the minimum rank that can create any user at all.
  if (actorRank < RANKS.MANAGER) return false;
  return actorRank > targetRank;
}

/**
 * Who is the actor allowed to SEE in the user-management surface? (Phase 2W)
 *
 *  - org_admin+ → all users in org
 *  - org_manager → themselves + any non-admin in org
 *  - SSE → themselves + SE in org (view-only)
 *  - SE → only themselves
 *
 * Org scoping is enforced by the DB query (listUsers scoped by org_id).
 * This predicate applies the role-hierarchy filter within the already-scoped list.
 */
export function canViewUser(
  actor: SessionUser | null | undefined,
  target: { id: string; rank: number },
): boolean {
  if (!actor) return false;
  if (actor.rank >= RANKS.ADMIN) return true;
  if (target.id === actor.id) return true;
  if (target.rank >= RANKS.ADMIN) return false;
  if (actor.rank >= RANKS.MANAGER) return true;
  if (actor.rank === RANKS.SSE)
    return target.rank <= RANKS.sales_representative;
  return false;
}

/** Assign leads to other users. Managers and above. */
export function canAssignLeads(user: SessionUser | null | undefined): boolean {
  if (!user) return false;
  return user.rank >= RANKS.MANAGER;
}

/**
 * Branch-scoped data access. Org scoping is enforced via RLS and the DB
 * query layer, so any authenticated user can access data in their org.
 * Returns true for any non-null user.
 */
export function canAccessBranch(
  user: SessionUser | null | undefined,
  _branch: string,
): boolean {
  return !!user;
}

/** Read analytics dashboards. Admin tier today; revisit for managers later. */
export function canViewAnalytics(
  user: SessionUser | null | undefined,
): boolean {
  if (!user) return false;
  return user.rank >= RANKS.ADMIN; // org_admin, admin, tenant_admin, super_admin
}
