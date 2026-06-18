/**
 * Assignment-based lead permissions.
 *
 * Composes role + ownership. The visibility/modify/assign matrix:
 *
 *                 view                       modify                     assign
 *   admin         all                        all                        all
 *   manager       branch-wide                branch-wide                branch-wide
 *   sales         own + unassigned           own                        ✗
 *
 * "owner" means `assignment.assigned_to === user.id`. Access is org-scoped
 * by RLS — these predicates apply within the already-scoped dataset.
 */
import type { SessionUser } from "@/src/types/auth";
import { RANKS } from "./ranks";

export interface LeadContext {
  /** Sheet tab name (= branch identifier). */
  branch: string;
  /** users.id of the current assignee, or null when unassigned. */
  assignedToUserId?: string | null;
}

function isOwner(user: SessionUser, lead: LeadContext): boolean {
  return !!lead.assignedToUserId && lead.assignedToUserId === user.id;
}

/**
 * Phase 2R: SSE is a team lead with branch-wide visibility (same as
 * manager). The owner check is reserved for `sales_representative` ONLY — the
 * only operational role that "receives" individual leads.
 */
export function canViewLead(
  user: SessionUser | null | undefined,
  lead: LeadContext,
): boolean {
  if (!user) return false;
  const rank = user.rank;
  if (rank >= RANKS.ADMIN) return true; // admin tier → unrestricted
  if (rank >= RANKS.SSE) return true; // manager tier + SSE → branch-wide
  if (rank >= RANKS.sales_representative)
    return isOwner(user, lead) || !lead.assignedToUserId; // SE → own + unassigned
  return false;
}

export function canModifyLead(
  user: SessionUser | null | undefined,
  lead: LeadContext,
): boolean {
  return canViewLead(user, lead);
}

export function canAssignLead(
  user: SessionUser | null | undefined,
  _lead: LeadContext,
): boolean {
  if (!user) return false;
  const rank = user.rank;
  if (rank >= RANKS.ADMIN) return true; // admin tier → unrestricted
  if (rank >= RANKS.SSE) return true; // manager + SSE can assign
  return false;
}

/**
 * Who is the actor allowed to assign leads TO?
 *
 * Eligible targets: READ_ONLY < rank < ADMIN
 *   (org_sr_manager, org_manager, senior_sales_executive, sales_representative)
 * Ineligible targets: super_admin, tenant_admin, org_admin (non-operational),
 *                     read_only (view-only), self (no self-assignment)
 *
 *   actor \ target       │ sr_mgr(70) │ manager(60) │ sse(40) │ sales(20)
 *   ─────────────────────┼────────────┼─────────────┼─────────┼──────────
 *   admin (≥80)          │     ✓      │      ✓      │    ✓    │    ✓
 *   org_sr_manager (70)  │     ✓*     │      ✓      │    ✓    │    ✓
 *   org_manager (60)     │     ✗      │      ✓*     │    ✓    │    ✓
 *   sse (40)             │     ✗      │      ✗      │    ✓*   │    ✓
 *   sales_rep (20)       │     ✗      │      ✗      │    ✗    │    ✓*
 *   (* same-rank peer — allowed; self — always ✗)
 *
 * Pure predicate — enforced both in the API routes and the UI filter.
 */
export function canAssignToUser(
  actorRank: number,
  targetRank: number,
  actorId: string,
  targetUserId: string,
): boolean {
  // Self-assignment never allowed
  if (actorId === targetUserId) return false;
  // read_only is view-only — never a valid assignee
  if (targetRank <= RANKS.READ_ONLY) return false;
  // Admin-tier (org_admin and above) are non-operational — never receive leads
  if (targetRank >= RANKS.ADMIN) return false;
  // Admin-tier actors can assign to any eligible target
  if (actorRank >= RANKS.ADMIN) return true;
  // Non-admin: can only assign to peers or lower (no upward assignment)
  return actorRank >= targetRank;
}
