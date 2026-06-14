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
 * Who is the actor allowed to assign WORK TO?
 *
 *   actor \ target           │ admin │ manager │ sr.sales │ sales
 *   ─────────────────────────┼───────┼─────────┼──────────┼───────
 *   admin                    │   ✗   │    ✓    │    ✓     │   ✓
 *   manager                  │   ✗   │    ✗    │    ✓     │   ✓
 *   senior_sales_executive   │   ✗   │    ✗    │    ✗     │   ✓
 *   sales_representative     │   ✗   │    ✗    │    ✗     │   ✗
 *
 *   PLUS: target.rank >= ADMIN → ✗  (admins never receive leads)
 *   PLUS: actor.id === target.id → ✗  (no self-assignment)
 *
 * Pure 4-argument predicate — composes cleanly with `requireMinimumRoleApi`.
 */
export function canAssignToUser(
  actorRank: number,
  targetRank: number,
  actorId: string,
  targetUserId: string,
): boolean {
  if (targetRank <= RANKS.READ_ONLY) return false;
  // Admin-tier users are never assignment targets (non-operational)
  if (targetRank >= RANKS.ADMIN) return false;
  // Admin tier can assign to any non-admin-tier, non-read_only user
  if (actorRank >= RANKS.ADMIN) return true;
  // Below admin: actor must have same rank or higher than target
  return actorRank >= targetRank;
}
