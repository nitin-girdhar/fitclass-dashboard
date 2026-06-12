/**
 * Branch-scope permission helpers.
 *
 * Branches are org names from the PostgreSQL organizations table (e.g. "Indiranagar").
 * Each non-admin user can be scoped to one or more branches via `users.allowed_branches`.
 * Admins are unrestricted.
 *
 * Empty `allowed_branches` is treated as UNRESTRICTED (new-DB org scope).
 */
import type { SessionUser } from '@/src/types/auth';
import { RANKS } from './ranks';

/**
 * Filter a list of branch names down to the ones a user may access.
 * Stable order: returns branches in their input order.
 */
export function filterAllowedBranches(
  user: SessionUser | null | undefined,
  branches: readonly string[],
): string[] {
  if (!user) return [];
  if (user.rank >= RANKS.ADMIN) return [...branches]; // admin tier → unrestricted
  if (user.allowed_branches.length === 0) return [...branches]; // legacy unrestricted / new-DB org scope
  const allowed = new Set(user.allowed_branches);
  return branches.filter((b) => allowed.has(b));
}

/**
 * True if the user may read/write data scoped to the given branch.
 * Mirrors `canAccessBranch` in ./index.ts; kept here so the assignments
 * module imports a single helper rather than mixing concerns.
 */
export function canAccessLeadBranch(
  user: SessionUser | null | undefined,
  branch: string,
): boolean {
  if (!user) return false;
  if (user.rank >= RANKS.ADMIN) return true; // admin tier → unrestricted
  if (user.allowed_branches.length === 0) return true; // legacy unrestricted / new-DB org scope
  return user.allowed_branches.includes(branch);
}

/**
 * Throw-style guard for server handlers that prefer assertions to branches.
 * Use INSIDE a try/catch that converts BranchAccessError to a 403 response.
 */
export class BranchAccessError extends Error {
  readonly branch: string;
  constructor(branch: string) {
    super(`Access to branch "${branch}" denied`);
    this.name = 'BranchAccessError';
    this.branch = branch;
  }
}

export function assertBranchAccess(
  user: SessionUser | null | undefined,
  branch: string,
): void {
  if (!canAccessLeadBranch(user, branch)) {
    throw new BranchAccessError(branch);
  }
}
