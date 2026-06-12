import { withServiceTx } from "../transaction";
import type { LookupItem } from "@/src/types/db";

// Module-level cache: tableName → Map<name, id>
const _cache: Map<string, Map<string, number>> = new Map();

// Tables that are safe to query by name — allowlist guards against injection.
const LOOKUP_TABLES = new Set([
  "lead_statuses",
  "marketing_platforms",
  "user_roles",
  "campaign_statuses",
  "follow_up_statuses",
  "lead_fail_reasons",
  "interaction_types",
  "countries",
  "states",
  "cities",
  "org_types",
  "tenant_domains",
  "tenant_plan_types",
]);

/**
 * Get all lookup tables in one batched query.
 */
export async function getAllLookups() {
  return withServiceTx(async (tx) => {
    const [
      statuses,
      platforms,
      roles,
      campaignStatuses,
      followUpStatuses,
      failReasons,
      interactionTypes,
      countries,
      states,
    ] = await Promise.all([
      tx`SELECT id, name, description, label, requires_followup, is_rejection FROM lead_statuses ORDER BY id`,
      tx`SELECT id, name, description FROM marketing_platforms ORDER BY id`,
      tx`SELECT id, name, label, description FROM user_roles ORDER BY rank DESC`,
      tx`SELECT id, name, description FROM campaign_statuses ORDER BY id`,
      tx`SELECT id, name, description FROM follow_up_statuses ORDER BY id`,
      tx`SELECT id, name, description, label FROM lead_fail_reasons ORDER BY id`,
      tx`SELECT id, name, description FROM interaction_types ORDER BY id`,
      tx`SELECT id, name, description FROM countries ORDER BY name`,
      tx`SELECT id, name, description FROM states ORDER BY name`,
    ]);

    // Populate module cache while we have the data
    for (const [key, rows] of [
      ["lead_statuses", statuses],
      ["marketing_platforms", platforms],
      ["user_roles", roles],
      ["campaign_statuses", campaignStatuses],
      ["follow_up_statuses", followUpStatuses],
      ["lead_fail_reasons", failReasons],
      ["interaction_types", interactionTypes],
      ["countries", countries],
      ["states", states],
    ] as const) {
      const m = new Map<string, number>();
      for (const r of rows as LookupItem[]) m.set(r.name, r.id);
      _cache.set(key, m);
    }

    return {
      leadStatuses: statuses as LookupItem[],
      marketingPlatforms: platforms as LookupItem[],
      userRoles: roles as LookupItem[],
      campaignStatuses: campaignStatuses as LookupItem[],
      followUpStatuses: followUpStatuses as LookupItem[],
      leadFailReasons: failReasons as LookupItem[],
      interactionTypes: interactionTypes as LookupItem[],
      countries: countries as LookupItem[],
      states: states as LookupItem[],
    };
  });
}

/**
 * Resolve a lookup ID by name.
 * Uses module-level cache; falls back to a direct DB query on a miss.
 */
export async function resolveLookupId(
  tableName: string,
  name: string,
): Promise<number> {
  if (!LOOKUP_TABLES.has(tableName)) {
    throw new Error(`Invalid lookup table: ${tableName}`);
  }

  const cached = _cache.get(tableName)?.get(name);
  if (cached !== undefined) return cached;

  return withServiceTx(async (tx) => {
    // Safe: tableName is validated against LOOKUP_TABLES allowlist above.
    const rows = await tx.unsafe(
      `SELECT id FROM ${tableName} WHERE name = $1 LIMIT 1`,
      [name],
    );
    const row = rows[0] as { id: number } | undefined;
    if (!row) throw new Error(`Lookup not found: ${tableName}.${name}`);

    // Store in cache for subsequent calls
    if (!_cache.has(tableName)) _cache.set(tableName, new Map());
    _cache.get(tableName)!.set(name, row.id);

    return row.id;
  });
}

/**
 * Get cities by state ID.
 */
export async function getCitiesByStateId(stateId: number) {
  return withServiceTx(async (tx) => {
    return tx`SELECT id, name FROM cities WHERE state_id = ${stateId} ORDER BY name`;
  });
}

