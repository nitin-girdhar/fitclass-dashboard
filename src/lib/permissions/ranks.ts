/**
 * Privilege rank thresholds — single source of truth for magic numbers.
 *
 * Mirrors the `rank` column values in the `user_roles` table seed
 * (databse-model/02_lookup_tables.sql). Import RANKS here instead of
 * defining local constants in each permission module.
 *
 * If a rank value ever changes in the DB migration, update here — no other
 * permission file should need to change.
 */
export const RANKS = {
  READ_ONLY: 0, // read_only
  sales_representative: 20, // sales_representative / sales_executive (legacy alias)
  SSE: 40, // senior_sales_executive
  MANAGER: 60, // org_manager / manager (legacy alias)
  SR_MANAGER: 70, // org_sr_manager
  ADMIN: 80, // org_admin / admin (legacy alias)
  TENANT_ADMIN: 90, // tenant_admin
  SUPER_ADMIN: 100, // super_admin
} as const;
