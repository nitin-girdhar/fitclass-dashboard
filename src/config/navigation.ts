/**
 * Dashboard navigation.
 *
 * Role → visible nav items:
 *
 *  super_admin / tenant_admin / org_admin
 *    → Leads · Assignments · Users · Analytics
 *
 *  org_sr_manager / org_manager
 *    → Leads · Assignments · Users
 *
 *  senior_sales_executive
 *    → Leads · Assignments · Users · My Leads
 *
 *  sales_representative
 *    → Leads · My Leads
 *
 *  read_only
 *    → Leads
 *
 *  Visibility here is UX ONLY — every destination listed enforces its own
 *  access on the server.
 */
import type { UserRole } from "@/src/types/auth";
import { ROLE_TIERS } from "@/src/features/auth/constants";

export interface NavItem {
  id: string;
  label: string;
  href: string;
  /** Explicit allow-list of roles that may SEE this item. */
  roles: readonly UserRole[];
}

// ── Role tier aliases ─────────────────────────────────────────────────────────
// Sourced from constants.ts — add new roles there, not here.
const ADMIN_ROLES = ROLE_TIERS.ADMIN;
const MANAGER_ROLES = ROLE_TIERS.MANAGER;
const SSE_ROLES = ROLE_TIERS.SSE;
const SE_ROLES = ROLE_TIERS.SE;
const READ_ONLY_ROLES = ROLE_TIERS.READ_ONLY;

export const DASHBOARD_NAV: readonly NavItem[] = [
  {
    id: "leads",
    label: "Leads",
    href: "/dashboard/leads",
    roles: [
      ...ADMIN_ROLES,
      ...MANAGER_ROLES,
      ...SSE_ROLES,
      ...SE_ROLES,
      ...READ_ONLY_ROLES,
    ],
  },
  {
    id: "assignments",
    label: "Assignments",
    href: "/dashboard/assignments",
    roles: [...ADMIN_ROLES, ...MANAGER_ROLES, ...SSE_ROLES],
  },
  {
    id: "users",
    label: "Users",
    href: "/dashboard/users",
    roles: [...ADMIN_ROLES, ...MANAGER_ROLES, ...SSE_ROLES],
  },
  {
    id: "analytics",
    label: "Analytics",
    href: "/dashboard/analytics",
    roles: [...ADMIN_ROLES],
  },
  {
    id: "my-leads",
    label: "My Leads",
    href: "/dashboard/my-leads",
    roles: [...SSE_ROLES, ...SE_ROLES],
  },
] as const;

export function navItemsForRole(role: UserRole): NavItem[] {
  return DASHBOARD_NAV.filter((item) => item.roles.includes(role));
}
