/**
 * Org-scope resolution for server-side data queries.
 *
 * Returns the list of org UUIDs a given actor is permitted to see records for.
 * Three tiers:
 *   super_admin  → null     (no filter — sees all tenants)
 *   tenant_admin → all org IDs in user_org_access for this user (DB-enforced list)
 *   everyone else → their single current org from the session
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
 *   null      → no filter (super_admin — sees all tenants)
 *   string[]  → restrict to these org IDs (may be empty if actor has no access)
 */
export async function resolveActorOrgIds(
  actor: SessionUser,
): Promise<string[] | null> {
  const rank = actor.rank;

  if (rank >= RANKS.SUPER_ADMIN) return null; // all tenants — no restriction

  if (rank >= RANKS.TENANT_ADMIN) {
    // Query user_org_access directly — explicit, auditable, no derivation
    const orgs: { orgId: string }[] = await withServiceTx(async (tx) =>
      tx.unsafe(
        `SELECT uoa.org_id AS "orgId"
         FROM user_org_access uoa
         JOIN organizations o ON o.id = uoa.org_id
         WHERE uoa.user_id  = $1
           AND uoa.is_active = true
           AND NOT o.is_deleted
         ORDER BY o.name`,
        [actor.id],
      ),
    );
    return orgs.map((r) => r.orgId);
  }

  // org_admin and below — scoped to their current session org only
  return [actor.orgId];
}
