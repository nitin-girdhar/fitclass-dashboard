/**
 * Lead-level permissions — adapted for PostgreSQL org hierarchy.
 *
 * Maps PostgreSQL user_roles to permission levels:
 *  - super_admin, tenant_admin, org_admin → full access
 *  - org_manager, senior_sales_executive → branch/team-level
 *  - sales_representative → individual leads
 *  - read_only → view-only
 */
import type { SessionUser } from "@/src/types/auth";

/** Minimal lead facts needed for permission checks. */
export interface LeadContext {
  /** Organization ID */
  orgId?: string;
  /** Branch name — org identifier for permission checks. */
  branch?: string;
  /** users.id of the current owner, or null when unassigned. */
  assignedToUserId?: string | null;
}

function isOwner(user: SessionUser, lead: LeadContext): boolean {
  return !!lead.assignedToUserId && lead.assignedToUserId === user.id;
}

/**
 * Can the user SEE this lead in a listing or detail view?
 */
export function canViewLeadData(
  user: SessionUser | null | undefined,
  lead: LeadContext,
): boolean {
  if (!user || user.role === "read_only") return false;

  const adminRoles = ["super_admin", "tenant_admin", "org_admin"];
  if (adminRoles.includes(user.role)) return true;

  const managerRoles = ["org_manager", "senior_sales_executive"];
  if (managerRoles.includes(user.role)) return true;

  if (user.role === "sales_representative") {
    return lead.assignedToUserId === user.id || !lead.assignedToUserId;
  }

  return false;
}

/**
 * Can the user EDIT lead fields (status, comments, etc.)?
 */
export function canEditLead(
  user: SessionUser | null | undefined,
  lead: LeadContext,
): boolean {
  if (!user || user.role === "read_only") return false;

  const adminRoles = ["super_admin", "tenant_admin", "org_admin"];
  if (adminRoles.includes(user.role)) return true;

  const managerRoles = ["org_manager", "senior_sales_executive"];
  if (managerRoles.includes(user.role)) return true;

  if (user.role === "sales_representative") {
    return lead.assignedToUserId === user.id;
  }

  return false;
}

/**
 * Can the user assign/reassign this lead?
 */
export function canAssignLead(
  user: SessionUser | null | undefined,
  lead: LeadContext,
): boolean {
  if (!user || user.role === "read_only") return false;

  const adminRoles = ["super_admin", "tenant_admin", "org_admin"];
  if (adminRoles.includes(user.role)) return true;

  const managerRoles = ["org_manager", "senior_sales_executive"];
  if (managerRoles.includes(user.role)) return true;

  // sales_representative can only self-assign from unassigned pool
  if (user.role === "sales_representative") {
    return !lead.assignedToUserId;
  }

  return false;
}

/**
 * Can the user create or modify ad campaigns?
 */
export function canCreateCampaign(
  user: SessionUser | null | undefined,
): boolean {
  if (!user || user.role === "read_only") return false;

  const allowed = [
    "super_admin",
    "tenant_admin",
    "org_admin",
    "org_manager",
  ];
  return allowed.includes(user.role);
}

/**
 * Can the user manage users (create, update roles, deactivate)?
 */
export function canManageUsers(user: SessionUser | null | undefined): boolean {
  if (!user) return false;

  const allowed = ["super_admin", "tenant_admin", "org_admin"];
  return allowed.includes(user.role);
}
