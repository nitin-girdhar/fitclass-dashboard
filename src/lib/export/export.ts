'use client';

/**
 * Client-side table export.
 *
 * ── Why client-side ─────────────────────────────────────────────────────────
 * Every data surface already holds its rows in memory (AG Grid's filtered
 * rows, the Users/Assignments client-filtered arrays). Re-querying server-side
 * would (a) duplicate the RBAC + branch + filter logic that already shaped the
 * on-screen data and (b) risk the file diverging from what the user sees. So
 * the export operates on the EXACT rows the caller passes — which are the rows
 * already filtered by role, branch, search, status, and sort. There is no way
 * for the export to widen visibility: it can only serialise what it's handed.
 *
 * ── Formats ─────────────────────────────────────────────────────────────────
 * SheetJS (`xlsx`) generates both a real `.xlsx` workbook and `.csv` from the
 * same array-of-objects, so the column order/headers stay identical across
 * formats. Column order is taken from `columns` (not object key order) so the
 * output matches the on-screen column order deterministically.
 */
import * as XLSX from 'xlsx';

export type ExportFormat = 'xlsx' | 'csv';

/** A column definition: the header label + how to read it off a row. */
export interface ExportColumn<T> {
  /** Header text shown in the first row of the sheet. */
  header: string;
  /** Pull the cell value from a row. Returned value is stringified for output. */
  value: (row: T) => string | number | null | undefined;
}

/**
 * Build the worksheet rows as an array of header-keyed objects, preserving the
 * declared column order via an explicit header list passed to `json_to_sheet`.
 */
function toAoA<T>(rows: readonly T[], columns: ReadonlyArray<ExportColumn<T>>): (string | number)[][] {
  const headerRow = columns.map((c) => c.header);
  const body = rows.map((row) =>
    columns.map((c) => {
      const v = c.value(row);
      if (v === null || v === undefined) return '';
      return v;
    }),
  );
  return [headerRow, ...body];
}

/**
 * Serialise `rows` to the chosen format and trigger a browser download.
 * No-op safety: an empty `rows` array still produces a header-only file so the
 * user gets feedback rather than a silent failure.
 */
export function exportRows<T>(
  rows: readonly T[],
  columns: ReadonlyArray<ExportColumn<T>>,
  filename: string,
  format: ExportFormat = 'xlsx',
): void {
  const aoa = toAoA(rows, columns);
  const worksheet = XLSX.utils.aoa_to_sheet(aoa);

  if (format === 'csv') {
    const csv = XLSX.utils.sheet_to_csv(worksheet);
    // Prepend a UTF-8 BOM so Excel opens non-ASCII (names, ₹, etc.) correctly.
    downloadBlob(
      new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8;' }),
      `${filename}.csv`,
    );
    return;
  }

  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, worksheet, 'Export');
  const buf = XLSX.write(workbook, { bookType: 'xlsx', type: 'array' }) as ArrayBuffer;
  downloadBlob(
    new Blob([buf], {
      type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    }),
    `${filename}.xlsx`,
  );
}

function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  // Revoke on the next tick so the click has committed.
  setTimeout(() => URL.revokeObjectURL(url), 0);
}

/**
 * Slugify a label for use in a filename segment:
 *   "Sec 83"        → "sec-83"
 *   "Ashok Vihar"   → "ashok-vihar"
 *   "Meta Leads"    → "meta-leads"
 */
export function slugify(input: string): string {
  return input
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

/** Today's date as YYYY-MM-DD in the user's local timezone. */
export function todayStamp(): string {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

/**
 * Compose a filename (without extension) from slugified segments + date.
 * Empty/blank segments are dropped so we never get "leads--2026-05-29".
 *   buildFilename(['meta-leads', 'Sec 83']) → "meta-leads-sec-83-2026-05-29"
 */
export function buildFilename(segments: ReadonlyArray<string>): string {
  const parts = segments
    .map((s) => slugify(s))
    .filter((s) => s.length > 0);
  parts.push(todayStamp());
  return parts.join('-');
}
