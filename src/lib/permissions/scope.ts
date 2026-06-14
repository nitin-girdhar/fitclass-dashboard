/**
 * Org-scope resolution for server-side data queries.
 *
 * Returns the list of org UUIDs a given actor is permitted to see records for.
 * Three tiers:
 *   super_admin  → null  (no filter — sees all tenants)
 *   tenant_admin → all org IDs within their tenant
 *   everyone else (org_admin and below) → their own single org
 *
 * SERVER-ONLY (uses withServiceTx).
 */
import { withServiceTx } from "@/src/lib/db/transaction";
import type { SessionUser } from "@/src/types/auth";
import { RANKS } from "./ranks";

/**
 * Resolves the set of org IDs visible to `actor`.
 *
 * Returns:
 *   null      → no filter (super_admin)
 *   string[]  → restrict to these org IDs (may be empty if actor has no org)
 */
export async function resolveActorOrgIds(
  actor: SessionUser,
): Promise<string[] | null> {
  const rank = actor.rank;

  if (rank >= RANKS.SUPER_ADMIN) return null; // all tenants — no restriction

  if (rank >= RANKS.TENANT_ADMIN) {
    // All orgs that share the same tenant as the actor's org
    const orgs: { id: string }[] = await withServiceTx(async (tx) =>
      tx.unsafe(
        `SELECT id FROM organizations
         WHERE tenant_id = (
           SELECT tenant_id FROM organizations
           WHERE id = $1::uuid AND NOT is_deleted
         )
           AND NOT is_deleted
         ORDER BY name`,
        [actor.orgId],
      ),
    );
    return orgs.map((r) => r.id);
  }

  // org_admin, org_manager, senior_sales_executive, sales_representative, read_only
  return [actor.orgId];
}
