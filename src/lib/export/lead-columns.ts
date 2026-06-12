'use client';

/**
 * Export column definitions for the Leads / My Leads surfaces.
 *
 * The spec fixes the exported columns:
 *   Date · Campaign · Name · Phone · Address · Buyer Intent · Interested In ·
 *   Primary Fitness Goal · Status · Remarks · Assignee
 *
 * Most map to the semantic fields on `Lead`. "Buyer Intent" and "Interested
 * In" are not first-class semantic fields, so we read them positionally from
 * `rawCells` using the live header row (the same header array the grid uses).
 * Assignee is resolved from the per-row assignment map the shell already holds
 * (denormalised name/email from the Phase 2U JOIN — never a raw UUID).
 */
import type { Lead } from '@/types';
import type { AssignmentView } from '@/src/features/assignments/serializers';
import type { ExportColumn } from './export';

/** Read a cell from rawCells by matching one of several candidate header names. */
function cellByHeader(
  lead: Lead,
  headers: readonly string[],
  candidates: readonly string[],
): string {
  for (const name of candidates) {
    const idx = headers.indexOf(name);
    if (idx !== -1) {
      const v = lead.rawCells?.[idx];
      if (v !== undefined && String(v).trim() !== '') return String(v).trim();
    }
  }
  return '';
}

/**
 * Build the lead export columns bound to the live `headers` row and the
 * per-row assignment map. `assignments` is keyed by `lead.rowIndex`, exactly
 * as the grid receives it.
 */
export function buildLeadExportColumns(
  headers: readonly string[],
  assignments: Record<number, AssignmentView>,
): ExportColumn<Lead>[] {
  return [
    { header: 'Date', value: (l) => l.createdTime },
    {
      header: 'Campaign',
      value: (l) => l.campaignName || cellByHeader(l, headers, ['Campaign', 'Campaign Name']),
    },
    { header: 'Name', value: (l) => l.fullName },
    { header: 'Phone', value: (l) => l.phoneNumber },
    {
      header: 'Address',
      value: (l) => l.address || cellByHeader(l, headers, ['Address', 'Selected Branch']),
    },
    {
      header: 'Buyer Intent',
      value: (l) => cellByHeader(l, headers, ['Buyer Intent', 'Intent']),
    },
    {
      header: 'Interested In',
      value: (l) =>
        l.membershipInterest ||
        cellByHeader(l, headers, ['Interested In', 'Membership Selected', 'Membership Interest']),
    },
    {
      header: 'Primary Fitness Goal',
      value: (l) =>
        l.fitnessGoal || cellByHeader(l, headers, ['Primary Fitness Goal', 'Fitness Goal']),
    },
    { header: 'Status', value: (l) => l.Status },
    { header: 'Remarks', value: (l) => l.Comments },
    {
      header: 'Assignee',
      value: (l) => {
        const a = assignments[l.rowIndex];
        if (!a) return '';
        return a.assignee_name ?? a.assignee_email ?? '';
      },
    },
  ];
}
