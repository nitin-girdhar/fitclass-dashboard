/**
 * Shared lead card-filter logic.
 *
 * Single source of truth for how the dashboard's stat-card filter
 * (all / new / callAttempted / …) maps to lead Status values. Used by BOTH
 * the AG Grid render path (LeadsTable) AND the export path (so the downloaded
 * file matches exactly what the active filter shows on screen).
 */
import type { Lead } from '@/types';
import type { CardFilter } from '@/components/dashboard/LeadDashboardShell';

export const FILTER_STATUSES: Record<CardFilter, string[] | null> = {
  all:            null,
  new:            ['new'],
  callAttempted:  ['contacting'],
  unqualified:    ['unqualified'],
  visitScheduled: ['qualified'],
  converted:      ['converted'],
  followUp:       null, // resolved at runtime from lead_stage.followup_required
  unassigned:     null, // resolved at runtime: assignedUserId === null
};

/**
 * Apply the active card-filter to a lead list. `all` returns the list as-is.
 * `followUp` uses the dynamic DB list. `unassigned` checks the assignedUserId field.
 */
export function applyLeadFilter(
  leads: readonly Lead[],
  filter: CardFilter,
  followupRequiredStages?: string[],
): Lead[] {
  if (filter === 'followUp') {
    const set = new Set(followupRequiredStages ?? []);
    return leads.filter((l) => set.has(l.Status ?? ''));
  }
  if (filter === 'unassigned') {
    return leads.filter((l) => !(l as any).assignedUserId);
  }
  const allowed = FILTER_STATUSES[filter];
  if (!allowed) return [...leads];
  const set = new Set(allowed);
  return leads.filter((l) => set.has(l.Status ?? ''));
}
