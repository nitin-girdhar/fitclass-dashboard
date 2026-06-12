/**
 * Composite lead identifier used as a stable key for assignment lookups
 * when no DB UUID is available.
 *
 * Format: `${dashboardId}::${branchName}::${rowIndex}`
 *
 * DB-sourced leads always carry a UUID (lead.leadId); this composite is
 * a fallback only. A single change here propagates to all call sites.
 */

const SEPARATOR = '::';

export function makeLeadId(
  dashboardId: string,
  branchName: string,
  rowIndex: number | string,
): string {
  return `${dashboardId}${SEPARATOR}${branchName}${SEPARATOR}${rowIndex}`;
}
