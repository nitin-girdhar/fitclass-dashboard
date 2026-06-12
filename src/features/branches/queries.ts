import { withServiceTx } from '@/src/lib/db/transaction';

async function listBranchesFromPostgres(orgIds?: string[] | null): Promise<string[]> {
  return withServiceTx(async (tx) => {
    if (orgIds && orgIds.length === 0) return [];
    if (orgIds) {
      const rows = await tx.unsafe(
        `SELECT name FROM organizations WHERE id = ANY($1::uuid[]) AND NOT is_deleted ORDER BY name`,
        [orgIds],
      );
      return (rows as any[]).map((r) => r.name as string);
    }
    const rows = await tx`SELECT name FROM organizations WHERE NOT is_deleted ORDER BY name`;
    return (rows as any[]).map((r) => r.name as string);
  });
}

/**
 * Union of every branch name scoped by orgIds.
 *   null/undefined → all orgs
 *   []             → empty (actor has no accessible orgs)
 *   [uuid, ...]    → only those orgs
 */
export async function listAllBranches(orgIds?: string[] | null): Promise<string[]> {
  return listBranchesFromPostgres(orgIds);
}

export type BranchValidationResult =
  | { ok: true }
  | { ok: false; invalid: string[] };

/**
 * Verify every submitted branch exists in the canonical list. Returns a
 * discriminated union so callers branch cleanly into 400 responses.
 */
export async function validateBranches(
  submitted: readonly string[],
): Promise<BranchValidationResult> {
  if (submitted.length === 0) return { ok: true };
  const canonical = new Set(await listAllBranches());
  const invalid = submitted.filter((b) => !canonical.has(b));
  if (invalid.length > 0) return { ok: false, invalid };
  return { ok: true };
}
