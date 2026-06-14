/**
 * Assignment-based lead permissions.
 *
 * Composes role + branch scope + ownership. Foundation only — Phase 2E does
 * NOT wire these into the legacy CRM data routes. The matrix is:
 *
 *                 view                       modify                     assign
 *   admin         all                        all                        all
 *   manager       in-branch                  in-branch                  in-branch
 *   sales         in-branch AND owner        in-branch AND owner        ✗
 *
 * "owner" means `assignment.assigned_to === user.id`. Unassigned leads are
 * visible/modifiable by admin and by managers in the branch — sales sees
 * only what is explicitly theirs.
 *
 * `LeadContext` is intentionally minimal — pass whatever you have. The
 * Sheets engine doesn't know about assignments today; once /api/leads joins
 * the assignments table (Phase 2E+), populate `assignedToUserId` from there.
 */
import type { SessionUser } from "@/src/types/auth";
import { canAccessLeadBranch } from "./branches";
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
 * manager). The owner check is reserved for `sales_executive` ONLY — the
 * only operational role that "receives" individual leads.
 *
 * Previously this used `isSalesRole(user.role)` which lumped SSE in with
 * SE; SSEs saw an empty dashboard unless leads happened to be assigned to
 * themselves. The whole point of the SSE role is to DISTRIBUTE work — they
 * cannot distribute what they cannot see.
 */
export function canViewLead(
  user: SessionUser | null | undefined,
  lead: LeadContext,
): boolean {
  if (!user) return false;
  const rank = user.rank;
  if (rank >= RANKS.ADMIN) return true; // admin tier → unrestricted
  if (!canAccessLeadBranch(user, lead.branch)) return false;
  if (rank >= RANKS.SSE) return true; // manager tier + SSE → branch-wide
  if (rank >= RANKS.sales_representative)
    return isOwner(user, lead) || !lead.assignedToUserId; // SE → own + unassigned
  return false;
}

export function canModifyLead(
  user: SessionUser | null | undefined,
  lead: LeadContext,
): boolean {
  // Same surface area as view today; split kept so future rules (e.g. a
  // "read-only" role) only change one helper.
  return canViewLead(user, lead);
}

export function canAssignLead(
  user: SessionUser | null | undefined,
  lead: LeadContext,
): boolean {
  if (!user) return false;
  const rank = user.rank;
  if (rank >= RANKS.ADMIN) return true; // admin tier → unrestricted
  if (rank >= RANKS.SSE) return canAccessLeadBranch(user, lead.branch); // manager + SSE → branch-scoped
  return false;
}

/**
 * Who is the actor allowed to assign WORK TO?
 *
 *   actor \ target           │ admin │ manager │ sr.sales │ sales
 *   ─────────────────────────┼───────┼─────────┼──────────┼───────
 *   admin                    │   ✗   │    ✓    │    ✓     │   ✓     ← Phase 2L
 *   manager                  │   ✗   │    ✗    │    ✓     │   ✓
 *   senior_sales_executive   │   ✗   │    ✗    │    ✗     │   ✓
 *   sales_executive          │   ✗   │    ✗    │    ✗     │   ✗
 *
 * PLUS in every row: `actorId === targetUserId` → ALWAYS false
 * (no user can assign a lead to themselves).
 *
 * ── Phase 2L: admins are non-operational ───────────────────────────────────
 *  Admins are PLATFORM OPERATORS — they configure users, branches, and
 *  workflow rules; they don't receive operational leads. Letting an admin
 *  hold lead ownership would:
 *   1. Hide the lead from sales-pipeline metrics (analytics rows aggregated
 *      by sales tier would silently drop admin-owned leads).
 *   2. Create a workflow back-channel: a manager could "park" a difficult
 *      lead on an admin to escape responsibility / audit pressure.
 *   3. Confuse SLA / first-response tracking, since admins are not on the
 *      sales-floor rotation.
 *  Easier to ban admins as targets than to special-case every downstream
 *  consumer.
 *
 * ── Self-assignment is forbidden ───────────────────────────────────────────
 *  An assignment routes work between users. Routing to yourself is a no-op
 *  in the operational model AND a known abuse vector:
 *   - A manager grabbing a hot lead by self-assigning bypasses fair
 *     distribution.
 *   - A self-assign + immediate status-change ("converted") would let an
 *     actor manufacture personal pipeline credit without an upstream
 *     handoff in the audit log.
 *  Note: the role-routing matrix above already incidentally blocks every
 *  same-role self-assign (admin→admin, manager→manager, SSE→SSE are all
 *  ✗). The id check is the explicit guard that survives any future relax
 *  of the role matrix.
 *
 * ── Phase 2I: SSE team-lead layer (unchanged) ──────────────────────────────
 *  Senior Sales Executive remains a "lightweight team lead" within their
 *  branch — can route work DOWN to Sales Executives only.
 *
 * Pure 4-argument predicate — composes cleanly with `requireMinimumRoleApi`,
 * which already proves the actor's role is what they claim via a verified
 * JWT + Node-side DB re-read.
 */
/**
 * Phase 2W: who is the actor allowed to assign WORK TO?
 *
 *   actor \ target           │ admin │ manager │ sr.sales │ sales
 *   ─────────────────────────┼───────┼─────────┼──────────┼───────
 *   admin                    │   ✗   │    ✓    │    ✓     │   ✓
 *   manager                  │   ✗   │    ✗    │    ✓     │   ✓
 *   senior_sales_executive   │   ✗   │    ✗    │    ✗     │   ✓
 *   sales_executive          │   ✗   │    ✗    │    ✗     │   ✗
 *
 *   PLUS: target.role === 'admin' → ✗  (admins never receive leads)
 *   PLUS: actor.id === target.id → ✗  (no self-assignment)
 *
 * ── Why admin is never a target ────────────────────────────────────────────
 *  Admins are platform operators, not pipeline owners. Routing a lead to an
 *  admin hides it from sales analytics and creates an audit back-channel
 *  (managers parking awkward leads on an admin). Banning here is simpler
 *  than special-casing every downstream consumer.
 *
 * ── Why self-assignment is forbidden ───────────────────────────────────────
 *  An assignment routes work between users. Self-routing is a no-op in the
 *  operational model and a known abuse vector (a manager grabbing a hot
 *  lead, or self-assign + immediate "converted" to manufacture credit).
 *
 * ── Why role-hierarchy is the gate ─────────────────────────────────────────
 *  Only one rule: actor must outrank target. SSE → manager would invert the
 *  org chart; manager → manager would let peers shuffle work without admin
 *  oversight. SE cannot assign at all.
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
  // (manager→manager ✓, manager→SSE ✓, SSE→SSE ✓, SSE→SE ✓, SE→anyone ✗)
  return actorRank >= targetRank;
}

/**
 * Is `assignee` a VALID OWNER for a lead in `leadBranch`?
 *
 * Rule (Phase 2K):
 *   - empty allowed_branches → unrestricted, always valid
 *   - non-empty           → branch MUST appear on the list
 *
 * ── Why this rule applies regardless of who is assigning ────────────────────
 *  This predicate is about the (lead, assignee) pair, NOT about the actor.
 *  Even an admin actor must not be allowed to assign a "Sec 83" lead to a
 *  user who doesn't have "Sec 83" in their scope: the assignee's own
 *  `canViewLeadData` would then deny them visibility on the lead they
 *  supposedly own. The result is a GHOST ASSIGNMENT — visible to admins /
 *  managers in the assignments page, invisible to the actual owner. That's
 *  a worst-case RBAC failure mode: it looks correct in admin views and
 *  silently strands work.
 *
 * ── Why this is distinct from `canAccessLeadBranch` ────────────────────────
 *  `canAccessLeadBranch(user, branch)` returns true for ANY admin — it
 *  answers "can this user read/manage data in this branch?". Admins are
 *  always allowed to do that.
 *
 *  `canAssignLeadToBranch(assignee, branch)` does NOT special-case admin —
 *  it answers "is this user a legitimate OWNER for work in this branch?".
 *  An admin with empty allowed_branches passes (they're unrestricted); an
 *  admin with restricted branches would only pass for those branches,
 *  matching the rule the spec calls for.
 *
 * ── Why dropdown filtering alone is insufficient ───────────────────────────
 *  The inline picker excludes invalid users from the dropdown for UX, but a
 *  crafted POST/PATCH from DevTools or curl bypasses the UI entirely. The
 *  authoritative gate is this predicate, applied inside the assignment
 *  API handlers, after the role-routing matrix.
 */
export function canAssignLeadToBranch(
  assignee: SessionUser,
  leadBranch: string,
): boolean {
  if (assignee.allowed_branches.length === 0) return true;
  return assignee.allowed_branches.includes(leadBranch);
}
