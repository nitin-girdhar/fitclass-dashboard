'use client';

import { forwardRef, useCallback, useEffect, useImperativeHandle, useMemo, useRef, useState } from 'react';
import { AgGridReact } from 'ag-grid-react';
import type {
  ColDef,
  GridReadyEvent,
  CellValueChangedEvent,
  ICellEditorParams,
  ICellRendererParams,
} from 'ag-grid-community';
import { AllCommunityModule, ModuleRegistry } from 'ag-grid-community';
import type { Lead, UpdatePayload } from '@/types';
import type { CardFilter } from './dashboard/LeadDashboardShell';
import type { SessionUser } from '@/src/types/auth';
import type { AssignmentView } from '@/src/features/assignments/serializers';
import { makeLeadId } from '@/src/features/assignments/lead-id';
import { FILTER_STATUSES } from '@/src/lib/leads/filter';
import InlineAssignmentSelector from './assignments/InlineAssignmentSelector';
import FollowUpScheduler, { type FollowUpData } from './FollowUpScheduler';

ModuleRegistry.registerModules([AllCommunityModule]);

interface Props {
  leads: Lead[];
  loading: boolean;
  statusFilter?: CardFilter;
  dashboardId: string;
  activeBranchName: string;
  onUpdate: (payload: UpdatePayload) => Promise<void>;
  newLeadRowKeys: Set<string>;
  headers: string[];
  statusOptions: string[];
  /** Maps DB status name → human-readable label for display in dropdowns and badges. */
  statusLabelMap?: Record<string, string>;
  /** Current authenticated actor — drives the inline assignment picker. */
  actor: SessionUser;
  /** Per-row assignment map keyed by `lead.rowIndex`. */
  assignments: Record<number, AssignmentView>;
  /**
   * Pre-fetched candidate users for the inline picker. Owned by the shell —
   * one fetch per (branch, actor), shared across every row's selector. Empty
   * when the actor has no inline-assign authority OR before the first fetch
   * completes.
   */
  assignmentCandidates: SessionUser[];
  /** Called after an inline assignment mutation succeeds (refetch trigger). */
  onAssignmentChanged: () => void;
  /** Status names that require a follow-up to be scheduled (array or Set). */
  requiresFollowupStatuses?: Set<string> | string[];
  /** Status names that are rejections — require a fail reason (array or Set). */
  rejectionStatuses?: Set<string> | string[];
  /** Fail reason options for the rejection modal. */
  failReasons?: Array<{ id: number; name: string; label: string }>;
}

// ── Breakpoint hook ───────────────────────────────────────────────────────────
// Below the Tailwind `lg` breakpoint (1024px) we render the touch-friendly
// stacked card list instead of AG Grid. The card path:
//   - works inside natural document scroll (no rigid height contract)
//   - avoids AG Grid's horizontal-scroll-trap on narrow viewports
//   - keeps the same inline-assignment + status-edit affordances
// AG Grid is reserved for ≥1024px where there is room for the table chrome
// and the rigid `flex-1 min-h-0` shell is in effect.
function useIsMobile(): boolean {
  const [mobile, setMobile] = useState(false);
  useEffect(() => {
    const mq = window.matchMedia('(max-width: 1023px)');
    setMobile(mq.matches);
    const handler = (e: MediaQueryListEvent) => setMobile(e.matches);
    mq.addEventListener('change', handler);
    return () => mq.removeEventListener('change', handler);
  }, []);
  return mobile;
}

// ── Status config — keyed by DB name (lead_statuses.name) ────────────────────
const STATUS_CONFIG: Record<string, { bg: string; color: string; dot: string; activeBg: string; activeBorder: string }> = {
  new:       { bg: '#EFF6FF', color: '#1D4ED8', dot: '#3B82F6', activeBg: '#DBEAFE', activeBorder: '#93C5FD' },
  contacted: { bg: '#FFF7ED', color: '#C2410C', dot: '#F97316', activeBg: '#FFEDD5', activeBorder: '#FDBA74' },
  qualified: { bg: '#FAF5FF', color: '#7E22CE', dot: '#A855F7', activeBg: '#F3E8FF', activeBorder: '#D8B4FE' },
  converted: { bg: '#F0FDF4', color: '#15803D', dot: '#22C55E', activeBg: '#DCFCE7', activeBorder: '#86EFAC' },
  failed:    { bg: '#FEF2F2', color: '#B91C1C', dot: '#EF4444', activeBg: '#FEE2E2', activeBorder: '#FCA5A5' },
  on_hold:   { bg: '#FFFBEB', color: '#92400E', dot: '#F59E0B', activeBg: '#FEF3C7', activeBorder: '#FCD34D' },
  nurturing: { bg: '#F0FDFA', color: '#0F766E', dot: '#14B8A6', activeBg: '#CCFBF1', activeBorder: '#99F6E4' },
};

function StatusBadge({ value, labelMap }: { value: string; labelMap?: Record<string, string> }) {
  const cfg   = STATUS_CONFIG[value];
  const bg    = cfg?.bg    ?? '#F1F5F9';
  const color = cfg?.color ?? '#475569';
  const dot   = cfg?.dot   ?? '#94A3B8';
  const text  = labelMap?.[value] ?? value;
  return (
    <span style={{ background: bg, color }}
      className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-xs font-semibold">
      <span style={{ background: dot }} className="w-1.5 h-1.5 rounded-full shrink-0" />
      {text || '—'}
    </span>
  );
}

// ── Bottom Sheet ──────────────────────────────────────────────────────────────
interface BottomSheetProps {
  open: boolean;
  onClose: () => void;
  title: string;
  children: React.ReactNode;
}

function BottomSheet({ open, onClose, title, children }: BottomSheetProps) {
  useEffect(() => {
    if (open) {
      document.body.style.overflow = 'hidden';
    } else {
      document.body.style.overflow = '';
    }
    return () => { document.body.style.overflow = ''; };
  }, [open]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex flex-col justify-end">
      {/* Backdrop */}
      <div
        className="absolute inset-0 bg-black/40 backdrop-blur-[2px]"
        onClick={onClose}
      />
      {/* Sheet */}
      <div className="relative bg-white rounded-t-2xl shadow-2xl max-h-[80vh] flex flex-col">
        {/* Handle */}
        <div className="flex justify-center pt-3 pb-1 shrink-0">
          <div className="w-9 h-1 rounded-full bg-[#CBD5E1]" />
        </div>
        {/* Header */}
        <div className="flex items-center justify-between px-5 pb-3 pt-1 border-b border-[#F1F5F9] shrink-0">
          <span className="text-base font-semibold text-[#0F172A]">{title}</span>
          <button
            onClick={onClose}
            className="w-8 h-8 flex items-center justify-center rounded-full hover:bg-[#F1F5F9] text-[#64748B]"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>
        {/* Content — thin scrollbar so all options are reachable */}
        <div className="overflow-y-auto flex-1 px-4 py-3 pb-8 sheet-scroll">
          {children}
        </div>
      </div>
    </div>
  );
}

// ── Mobile Status Picker ──────────────────────────────────────────────────────
interface StatusPickerProps {
  lead: Lead;
  options: string[];
  labelMap?: Record<string, string>;
  onUpdate: (payload: UpdatePayload) => Promise<void>;
  requiresFollowupStatuses?: Set<string>;
  onStatusNeedsFollowUp?: (lead: Lead, newStatus: string, revertFn: () => void) => void;
}

function MobileStatusPicker({ lead, options, labelMap, onUpdate, requiresFollowupStatuses, onStatusNeedsFollowUp }: StatusPickerProps) {
  const [open, setOpen] = useState(false);
  const [current, setCurrent] = useState(lead.Status);
  const [saving, setSaving] = useState(false);

  const handleSelect = async (status: string) => {
    if (status === current) { setOpen(false); return; }

    // Intercept statuses that require a follow-up
    if (requiresFollowupStatuses?.has(status) && onStatusNeedsFollowUp) {
      const prev = current;
      setCurrent(status);
      setOpen(false);
      onStatusNeedsFollowUp(lead, status, () => setCurrent(prev));
      return;
    }

    setSaving(true);
    const prev = current;
    setCurrent(status);
    setOpen(false);
    try {
      await onUpdate({ rowIndex: lead.rowIndex, leadId: lead.leadId, field: 'Status', value: status });
    } catch {
      setCurrent(prev);
    } finally {
      setSaving(false);
    }
  };

  return (
    <>
      <button
        onClick={() => setOpen(true)}
        disabled={saving}
        className="flex items-center gap-1.5 disabled:opacity-60"
        style={{ minHeight: 44 }}
      >
        <StatusBadge value={current} labelMap={labelMap} />
        {saving ? (
          <svg className="w-3 h-3 animate-spin text-[#0A6BA8]" fill="none" viewBox="0 0 24 24">
            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z" />
          </svg>
        ) : (
          <svg className="w-3.5 h-3.5 text-[#94A3B8]" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
          </svg>
        )}
      </button>

      <BottomSheet open={open} onClose={() => setOpen(false)} title="Update Status">
        <div className="flex flex-col gap-2">
          {options.map((s) => {
            const cfg = STATUS_CONFIG[s];
            const isActive = s === current;
            return (
              <button
                key={s}
                onClick={() => handleSelect(s)}
                style={{
                  minHeight: 52,
                  background: isActive ? (cfg?.activeBg ?? '#F8FAFC') : '#F8FAFC',
                  borderColor: isActive ? (cfg?.activeBorder ?? '#E2E8F0') : '#E2E8F0',
                  color: isActive ? (cfg?.color ?? '#0F172A') : '#0F172A',
                }}
                className="flex items-center gap-3 w-full px-4 rounded-xl border text-sm font-medium text-left transition-all active:scale-[0.98]"
              >
                <span style={{ background: cfg?.dot ?? '#94A3B8' }} className="w-2.5 h-2.5 rounded-full shrink-0" />
                {labelMap?.[s] ?? s}
                {isActive && (
                  <svg className="ml-auto w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M5 13l4 4L19 7" />
                  </svg>
                )}
              </button>
            );
          })}
        </div>
      </BottomSheet>
    </>
  );
}

// ── Mobile Comments Editor ────────────────────────────────────────────────────
interface CommentsEditorProps {
  lead: Lead;
  onUpdate: (payload: UpdatePayload) => Promise<void>;
}

function MobileCommentsEditor({ lead, onUpdate }: CommentsEditorProps) {
  const [open, setOpen] = useState(false);
  const [value, setValue] = useState(lead.Comments ?? '');
  const [saved, setSaved] = useState(lead.Comments ?? '');
  const [saving, setSaving] = useState(false);

  const handleSave = async () => {
    if (value === saved) { setOpen(false); return; }
    setSaving(true);
    try {
      await onUpdate({ rowIndex: lead.rowIndex, leadId: lead.leadId, field: 'Comments', value });
      setSaved(value);
      setOpen(false);
    } finally {
      setSaving(false);
    }
  };

  return (
    <>
      <button
        onClick={() => setOpen(true)}
        className="text-left text-sm text-[#475569] leading-relaxed w-full"
        style={{ minHeight: 24 }}
      >
        {saved || <span className="text-[#CBD5E1] italic text-xs">Tap to add remarks…</span>}
      </button>

      <BottomSheet open={open} onClose={() => { setValue(saved); setOpen(false); }} title="Remarks">
        <textarea
          autoFocus
          value={value}
          onChange={(e) => setValue(e.target.value)}
          placeholder="Add remarks about this lead…"
          className="w-full border border-[#E2E8F0] rounded-xl px-4 py-3 text-sm text-[#0F172A] placeholder:text-[#CBD5E1] focus:outline-none focus:ring-2 focus:ring-[#0A6BA8]/20 focus:border-[#0A6BA8] resize-none"
          rows={5}
        />
        <button
          onClick={handleSave}
          disabled={saving}
          className="mt-3 w-full bg-[#0A6BA8] text-white text-sm font-semibold rounded-xl py-3.5 flex items-center justify-center gap-2 disabled:opacity-60 active:scale-[0.98] transition-transform"
        >
          {saving ? (
            <>
              <svg className="w-4 h-4 animate-spin" fill="none" viewBox="0 0 24 24">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z" />
              </svg>
              Saving…
            </>
          ) : 'Save Remarks'}
        </button>
      </BottomSheet>
    </>
  );
}

// ── Mobile Lead Card ──────────────────────────────────────────────────────────
interface CardProps {
  lead: Lead;
  isNew: boolean;
  headers: string[];
  activeBranchName: string;
  statusOptions: string[];
  statusLabelMap?: Record<string, string>;
  onUpdate: (payload: UpdatePayload) => Promise<void>;
  actor: SessionUser;
  dashboardId: string;
  assignment: AssignmentView | null;
  /** Shared candidate list from the shell (one fetch per branch). */
  assignmentCandidates: SessionUser[];
  onAssignmentChanged: () => void;
  requiresFollowupStatuses?: Set<string>;
  onStatusNeedsFollowUp?: (lead: Lead, newStatus: string, revertFn: () => void) => void;
}

function MobileLeadCard({
  lead, isNew, headers, activeBranchName, statusOptions, statusLabelMap, onUpdate,
  actor, dashboardId, assignment, assignmentCandidates, onAssignmentChanged,
  requiresFollowupStatuses, onStatusNeedsFollowUp,
}: CardProps) {
  const hasHeader = (name: string) => headers.includes(name);
  const branchLabel = hasHeader('Selected Branch') ? 'Selected Branch' : 'Address';
  const remarksLabel = hasHeader('Remarks') ? 'Remarks' : 'Comments';

  return (
    <div className={[
      'bg-white rounded-2xl border shadow-sm mx-4 flex flex-col gap-0 overflow-hidden transition-shadow',
      isNew ? 'border-[#93C5FD] shadow-blue-100' : 'border-[#E2E8F0]',
    ].join(' ')}>
      {isNew && (
        <div className="bg-[#DBEAFE] px-4 py-1.5 flex items-center gap-1.5">
          <span className="w-1.5 h-1.5 rounded-full bg-[#2563EB] animate-pulse" />
          <span className="text-xs font-semibold text-[#1D4ED8]">New Lead</span>
        </div>
      )}

      {/* Primary info */}
      <div className="px-4 pt-4 pb-3 flex items-start justify-between gap-3">
        <div className="flex flex-col gap-0.5 min-w-0">
          <span className="text-base font-bold text-[#0F172A] truncate">
            {lead.fullName || '—'}
          </span>
          <a
            href={`tel:${lead.phoneNumber}`}
            className="text-sm font-medium text-[#0A6BA8] flex items-center gap-1"
          >
            <svg className="w-3.5 h-3.5 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 5a2 2 0 012-2h3.28a1 1 0 01.948.684l1.498 4.493a1 1 0 01-.502 1.21l-2.257 1.13a11.042 11.042 0 005.516 5.516l1.13-2.257a1 1 0 011.21-.502l4.493 1.498A1 1 0 0121 17.72V19a2 2 0 01-2 2h-1C9.716 21 3 14.284 3 6V5z" />
            </svg>
            {lead.phoneNumber || '—'}
          </a>
        </div>
        <div className="shrink-0 pt-0.5">
          <MobileStatusPicker
            lead={lead}
            options={statusOptions}
            labelMap={statusLabelMap}
            onUpdate={onUpdate}
            requiresFollowupStatuses={requiresFollowupStatuses}
            onStatusNeedsFollowUp={onStatusNeedsFollowUp}
          />
        </div>
      </div>

      {/* Inline assignment */}
      <div className="px-4 pb-2 flex items-center gap-2">
        <span className="text-[10px] font-semibold uppercase tracking-wide text-[#94A3B8]">
          Assignee
        </span>
        <InlineAssignmentSelector
          branch={activeBranchName}
          leadId={lead.leadId ?? makeLeadId(dashboardId, activeBranchName, lead.rowIndex)}
          existing={assignment}
          actor={actor}
          candidates={assignmentCandidates}
          onChanged={onAssignmentChanged}
        />
      </div>

      <div className="h-px bg-[#F1F5F9] mx-4" />

      {/* Meta fields — show whichever fields exist in this sheet */}
      <div className="px-4 py-3 flex flex-col gap-2">
        {lead.address && (
          <div className="flex items-start gap-2">
            <span className="text-xs font-semibold text-[#94A3B8] uppercase tracking-wide w-20 shrink-0 pt-0.5">{branchLabel}</span>
            <span className="text-sm text-[#0F172A]">{lead.address}</span>
          </div>
        )}
        {lead.reason && (
          <div className="flex items-start gap-2">
            <span className="text-xs font-semibold text-[#94A3B8] uppercase tracking-wide w-20 shrink-0 pt-0.5">Reason</span>
            <span className="text-sm text-[#475569]">{lead.reason}</span>
          </div>
        )}
        {lead.campaignName && (
          <div className="flex items-start gap-2">
            <span className="text-xs font-semibold text-[#94A3B8] uppercase tracking-wide w-20 shrink-0 pt-0.5">Campaign</span>
            <span className="text-sm text-[#475569]">{lead.campaignName}</span>
          </div>
        )}
        {lead.joiningPlan && (
          <div className="flex items-start gap-2">
            <span className="text-xs font-semibold text-[#94A3B8] uppercase tracking-wide w-20 shrink-0 pt-0.5">Plan</span>
            <span className="text-sm text-[#475569]">{lead.joiningPlan}</span>
          </div>
        )}
        {lead.createdTime && (
          <div className="flex items-start gap-2">
            <span className="text-xs font-semibold text-[#94A3B8] uppercase tracking-wide w-20 shrink-0 pt-0.5">Date</span>
            <span className="text-sm text-[#64748B]">{lead.createdTime}</span>
          </div>
        )}
      </div>

      <div className="h-px bg-[#F1F5F9] mx-4" />

      {/* Remarks */}
      <div className="px-4 py-3 pb-4">
        <div className="text-xs font-semibold text-[#94A3B8] uppercase tracking-wide mb-1.5">
          {remarksLabel}
        </div>
        <MobileCommentsEditor lead={lead} onUpdate={onUpdate} />
      </div>
    </div>
  );
}

// ── AG Grid CSS ───────────────────────────────────────────────────────────────
const GRID_STYLES = `
  .ag-theme-alpine {
    --ag-font-size: 13px;
    --ag-font-family: ui-sans-serif, system-ui, sans-serif;
    --ag-header-background-color: #F8FAFC;
    --ag-header-foreground-color: #64748B;
    --ag-border-color: #E2E8F0;
    --ag-row-border-color: #F1F5F9;
    --ag-row-hover-color: #F0F9FF;
    --ag-selected-row-background-color: #EFF6FF;
    --ag-odd-row-background-color: #FFFFFF;
    --ag-background-color: #FFFFFF;
    --ag-secondary-foreground-color: #64748B;
    --ag-input-focus-border-color: #0A6BA8;
    --ag-range-selection-border-color: #0A6BA8;
    --ag-checkbox-checked-color: #0A6BA8;
  }
  .ag-theme-alpine .ag-header-cell-text {
    font-weight: 700;
    font-size: 11px;
    text-transform: uppercase;
    letter-spacing: 0.07em;
    color: #64748B;
  }
  .ag-theme-alpine .ag-header-cell {
    border-right: 1px solid #F1F5F9;
  }
  .ag-theme-alpine .editable-col-header .ag-header-cell-text::after {
    content: " ✎";
    font-size: 9px;
    color: #0A6BA8;
  }
  .ag-theme-alpine .ag-cell-inline-editing {
    border-color: #0A6BA8 !important;
    box-shadow: 0 0 0 3px rgba(10,107,168,0.12);
  }
  .ag-theme-alpine .ag-row {
    border-bottom: 1px solid #F8FAFC;
  }
  .ag-theme-alpine .ag-paging-panel {
    border-top: 1px solid #E2E8F0;
    font-size: 12px;
    color: #64748B;
    background: #F8FAFC;
    padding: 8px 16px;
  }

  /* ── Scrollbar styling ── */
  .ag-theme-alpine .ag-body-viewport,
  .ag-theme-alpine .ag-body-horizontal-scroll-viewport,
  .ag-theme-alpine .ag-body-vertical-scroll-viewport {
    scrollbar-width: thin;
    scrollbar-color: #b8c2d1 #eef2f7;
  }
  .ag-theme-alpine .ag-body-viewport::-webkit-scrollbar,
  .ag-theme-alpine .ag-body-horizontal-scroll-viewport::-webkit-scrollbar,
  .ag-theme-alpine .ag-body-vertical-scroll-viewport::-webkit-scrollbar {
    width: 8px; height: 8px;
  }
  .ag-theme-alpine .ag-body-viewport::-webkit-scrollbar-track,
  .ag-theme-alpine .ag-body-horizontal-scroll-viewport::-webkit-scrollbar-track,
  .ag-theme-alpine .ag-body-vertical-scroll-viewport::-webkit-scrollbar-track {
    background: #eef2f7; border-radius: 999px;
  }
  .ag-theme-alpine .ag-body-viewport::-webkit-scrollbar-thumb,
  .ag-theme-alpine .ag-body-horizontal-scroll-viewport::-webkit-scrollbar-thumb,
  .ag-theme-alpine .ag-body-vertical-scroll-viewport::-webkit-scrollbar-thumb {
    background: #b8c2d1; border-radius: 999px;
  }
  .ag-theme-alpine .ag-body-viewport::-webkit-scrollbar-thumb:hover,
  .ag-theme-alpine .ag-body-horizontal-scroll-viewport::-webkit-scrollbar-thumb:hover,
  .ag-theme-alpine .ag-body-vertical-scroll-viewport::-webkit-scrollbar-thumb:hover {
    background: #94a3b8;
  }
`;

// ── Status cell editor ────────────────────────────────────────────────────────
// agSelectCellEditor only shows raw DB names; this custom editor renders labels
// while still committing the DB name to the grid (what the PATCH API expects).
interface StatusEditorParams extends ICellEditorParams {
  values: string[];
  labelMap?: Record<string, string>;
}

const StatusCellEditor = forwardRef<unknown, StatusEditorParams>(function StatusCellEditor(
  { value, values, labelMap, stopEditing },
  ref,
) {
  const selectRef = useRef<HTMLSelectElement>(null);

  useImperativeHandle(ref, () => ({
    getValue: () => selectRef.current?.value ?? value,
  }));

  return (
    <select
      ref={selectRef}
      defaultValue={value}
      autoFocus
      onChange={() => stopEditing()}
      className="h-full w-full border-none bg-white px-2 outline-none"
      style={{ fontFamily: 'inherit', fontSize: '13px', color: '#0F172A' }}
    >
      {values.map((v) => (
        <option key={v} value={v}>{labelMap?.[v] ?? v}</option>
      ))}
    </select>
  );
});

// ── Dynamic column builder ────────────────────────────────────────────────────
function buildDynamicColumns(
  headers: string[],
  statusOptions: string[],
  statusLabelMap?: Record<string, string>,
): ColDef<Lead>[] {
  return headers.map((header, colIndex): ColDef<Lead> => {
    const base: ColDef<Lead> = {
      headerName: header,
      colId: `col_${colIndex}`,
      valueGetter: (p) => p.data?.rawCells?.[colIndex] ?? '',
      valueSetter: (p) => {
        if (p.data?.rawCells) p.data.rawCells[colIndex] = p.newValue ?? '';
        return true;
      },
      sortable: true,
      filter: true,
      editable: false,
      width: 140,
    };

    switch (header) {
      case 'Status':
        return {
          ...base,
          width: 160,
          editable: true,
          cellEditor: StatusCellEditor,
          cellEditorParams: { values: statusOptions, labelMap: statusLabelMap },
          cellRenderer: (p: { value: string }) => <StatusBadge value={p.value ?? ''} labelMap={statusLabelMap} />,
          cellStyle: { display: 'flex', alignItems: 'center' } as Record<string, string>,
          headerClass: 'editable-col-header',
        };

      case 'Remarks':
        return {
          ...base,
          flex: 2,
          minWidth: 180,
          width: undefined,
          editable: true,
          cellEditor: 'agTextCellEditor',
          cellStyle: { color: '#475569' },
          headerClass: 'editable-col-header',
          valueSetter: (p) => {
            if (p.data) {
              p.data.Comments = p.newValue ?? '';
              if (p.data.rawCells) p.data.rawCells[colIndex] = p.newValue ?? '';
            }
            return true;
          },
        };

      case 'Date':
        return { ...base, width: 110 };

      case 'Platform':
        return { ...base, width: 110 };

      case 'Name':
        return { ...base, flex: 1, minWidth: 130, width: undefined };

      case 'Phone Number':
        return { ...base, width: 140, sortable: false };

      case 'Email Address':
      case 'Email':
        return { ...base, flex: 1, minWidth: 180, width: undefined };

      case 'Location':
      case 'Address':
      case 'Selected Branch':
        return { ...base, flex: 1, minWidth: 140, width: undefined };

      case 'Campaign':
      case 'Campaign Name':
        return { ...base, width: 140 };

      default:
        return base;
    }
  });
}

// ── Main component ────────────────────────────────────────────────────────────
export default function LeadsTable({
  leads, loading, statusFilter = 'all', dashboardId,
  activeBranchName,
  newLeadRowKeys, headers, statusOptions, statusLabelMap,
  onUpdate,
  actor, assignments, assignmentCandidates, onAssignmentChanged,
  requiresFollowupStatuses, rejectionStatuses, failReasons,
}: Props) {
  const gridRef = useRef<AgGridReact>(null);
  const [savingRow, setSavingRow] = useState<number | null>(null);
  const isMobile = useIsMobile();
  const [pendingStatusChange, setPendingStatusChange] = useState<{
    lead: Lead;
    newStatus: string;
    isRejection: boolean;
    revertFn: () => void;
  } | null>(null);

  const followUpSet = useMemo(
    () => requiresFollowupStatuses instanceof Set
      ? requiresFollowupStatuses
      : new Set(requiresFollowupStatuses ?? []),
    [requiresFollowupStatuses],
  );

  const rejectionSet = useMemo(
    () => rejectionStatuses instanceof Set
      ? rejectionStatuses
      : new Set(rejectionStatuses ?? []),
    [rejectionStatuses],
  );

  const filtered = useMemo(() => {
    if (statusFilter === 'followUp') {
      return leads.filter(l => followUpSet.has(l.Status ?? ''));
    }
    if (statusFilter === 'unassigned') {
      return leads.filter(l => !(l as any).assignedUserId);
    }
    const allowed = FILTER_STATUSES[statusFilter];
    if (!allowed) return leads;
    const set = new Set(allowed);
    return leads.filter(l => set.has(l.Status ?? ''));
  }, [leads, statusFilter, followUpSet]);

  // ── Assignee cell (inline assignment) ─────────────────────────────────────
  const assigneeCellRenderer = useCallback(
    (params: ICellRendererParams<Lead>) => {
      const lead = params.data;
      if (!lead) return null;
      const ctx = params.context as {
        actor: SessionUser;
        assignments: Record<number, AssignmentView>;
        assignmentCandidates: SessionUser[];
        dashboardId: string;
        branch: string;
        onAssignmentChanged: () => void;
      };
      const existing = ctx.assignments[lead.rowIndex] ?? null;
      return (
        <InlineAssignmentSelector
          branch={ctx.branch}
          leadId={lead.leadId ?? makeLeadId(ctx.dashboardId, ctx.branch, lead.rowIndex)}
          existing={existing}
          actor={ctx.actor}
          candidates={ctx.assignmentCandidates}
          onChanged={ctx.onAssignmentChanged}
        />
      );
    },
    [],
  );

  const columnDefs = useMemo(() => {
    const dynamic = buildDynamicColumns(headers, statusOptions, statusLabelMap);
    const assignee: ColDef<Lead> = {
      colId: '__assignee',
      headerName: 'Assignee',
      width: 200,
      minWidth: 160,
      pinned: 'right',
      sortable: false,
      filter: false,
      editable: false,
      cellRenderer: assigneeCellRenderer,
      cellStyle: {
        display: 'flex',
        alignItems: 'center',
        paddingLeft: '12px',
        paddingRight: '12px',
        overflow: 'visible',
      },
    };
    return [...dynamic, assignee];
  }, [headers, statusOptions, statusLabelMap, assigneeCellRenderer]);

  const defaultColDef: ColDef = useMemo(() => ({
    resizable: true,
    suppressMovable: false,
    cellStyle: { fontSize: '13px', color: '#0F172A' },
  }), []);

  const gridContext = useMemo(
    () => ({
      actor,
      assignments,
      assignmentCandidates,
      dashboardId,
      branch: activeBranchName,
      onAssignmentChanged,
    }),
    [actor, assignments, assignmentCandidates, dashboardId, activeBranchName, onAssignmentChanged],
  );

  useEffect(() => {
    gridRef.current?.api?.refreshCells({
      force: true,
      columns: ['__assignee'],
    });
  }, [assignments, assignmentCandidates]);

  const onCellValueChanged = useCallback(async (event: CellValueChangedEvent<Lead>) => {
    const { data, colDef, newValue } = event;
    if (!data) return;
    if (newValue === event.oldValue) return;

    const header = colDef.headerName ?? '';
    let field: 'Status' | 'Comments' | null = null;
    if (header === 'Status') field = 'Status';
    else if (header === 'Remarks') field = 'Comments';
    if (!field) return;

    // Intercept status changes that require a follow-up or rejection modal
    if (field === 'Status' && (followUpSet.has(newValue ?? '') || rejectionSet.has(newValue ?? ''))) {
      const statusColIndex = headers.indexOf('Status');
      const oldStatus = event.oldValue ?? '';
      setPendingStatusChange({
        lead: data,
        newStatus: newValue ?? '',
        isRejection: rejectionSet.has(newValue ?? ''),
        revertFn: () => {
          if (data.rawCells && statusColIndex >= 0) data.rawCells[statusColIndex] = oldStatus;
          data.Status = oldStatus;
          gridRef.current?.api?.refreshCells({ force: true });
        },
      });
      return;
    }

    setSavingRow(data.rowIndex);
    try {
      await onUpdate({ rowIndex: data.rowIndex, leadId: data.leadId, field, value: newValue ?? '' });
    } finally {
      setSavingRow(null);
    }
  }, [onUpdate, followUpSet, rejectionSet, headers]);

  const onGridReady = useCallback((_: GridReadyEvent) => {}, []);

  const handleStatusNeedsFollowUp = useCallback(
    (lead: Lead, newStatus: string, revertFn: () => void) => {
      setPendingStatusChange({ lead, newStatus, isRejection: rejectionSet.has(newStatus), revertFn });
    },
    [rejectionSet],
  );

  const handleFollowUpConfirm = useCallback(
    async (data: FollowUpData) => {
      if (!pendingStatusChange) return;
      const { lead, newStatus, revertFn } = pendingStatusChange;
      setSavingRow(lead.rowIndex);
      try {
        await onUpdate({
          rowIndex: lead.rowIndex,
          leadId: lead.leadId,
          field: 'Status',
          value: newStatus,
          ...(data.assignedUserId ? { followUp: { assignedUserId: data.assignedUserId, scheduledAt: data.scheduledAt!, notes: data.notes } } : {}),
          ...(data.failReasonId != null ? { failReasonId: data.failReasonId } : {}),
        });
        setPendingStatusChange(null);
      } catch {
        revertFn();
        setPendingStatusChange(null);
      } finally {
        setSavingRow(null);
      }
    },
    [pendingStatusChange, onUpdate],
  );

  const handleFollowUpCancel = useCallback(() => {
    pendingStatusChange?.revertFn();
    setPendingStatusChange(null);
  }, [pendingStatusChange]);

  const getRowClass = useCallback((params: { data?: Lead }) => {
    if (!params.data) return '';
    const key = `${params.data.rowIndex}::${params.data.phoneNumber}::${params.data.fullName}`;
    return newLeadRowKeys.has(key) ? 'new-lead-row' : '';
  }, [newLeadRowKeys]);

  const followUpModal = pendingStatusChange ? (
    <FollowUpScheduler
      statusName={pendingStatusChange.newStatus}
      statusLabel={statusLabelMap?.[pendingStatusChange.newStatus] ?? pendingStatusChange.newStatus}
      isRejection={pendingStatusChange.isRejection}
      failReasons={failReasons}
      candidates={assignmentCandidates}
      onConfirm={handleFollowUpConfirm}
      onCancel={handleFollowUpCancel}
    />
  ) : null;

  if (loading) {
    return (
      <>
        {followUpModal}
        <div className="flex flex-col items-center justify-center h-64 gap-3 text-[#94A3B8]">
          <svg className="w-6 h-6 animate-spin text-[#0A6BA8]" fill="none" viewBox="0 0 24 24">
            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z" />
          </svg>
          <span className="text-sm">Loading leads…</span>
        </div>
      </>
    );
  }

  // ── Mobile card list ──────────────────────────────────────────────────────
  if (isMobile) {
    if (filtered.length === 0) {
      return (
        <>
          {followUpModal}
          <div className="flex flex-col items-center justify-center py-16 gap-3 text-[#94A3B8]">
            <svg className="w-10 h-10" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9.172 16.172a4 4 0 015.656 0M9 10h.01M15 10h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
            <span className="text-sm font-medium">No leads found</span>
          </div>
        </>
      );
    }

    return (
      <>
        {followUpModal}
        <div className="flex flex-col gap-3 py-4 pb-8">
        <div className="px-4 flex items-center justify-between">
          <span className="text-xs font-semibold text-[#64748B] uppercase tracking-wide">
            {filtered.length} lead{filtered.length !== 1 ? 's' : ''}
          </span>
        </div>
        {filtered.map((lead) => {
          const key = `${lead.rowIndex}::${lead.phoneNumber}::${lead.fullName}`;
          return (
            <MobileLeadCard
              key={lead.rowIndex}
              lead={lead}
              isNew={newLeadRowKeys.has(key)}
              headers={headers}
              activeBranchName={activeBranchName}
              statusOptions={statusOptions}
              statusLabelMap={statusLabelMap}
              onUpdate={onUpdate}
              actor={actor}
              dashboardId={dashboardId}
              assignment={assignments[lead.rowIndex] ?? null}
              assignmentCandidates={assignmentCandidates}
              onAssignmentChanged={onAssignmentChanged}
              requiresFollowupStatuses={followUpSet}
              onStatusNeedsFollowUp={handleStatusNeedsFollowUp}
            />
          );
        })}
        </div>
      </>
    );
  }

  // ── Desktop AG Grid ───────────────────────────────────────────────────────
  return (
    <>
      {followUpModal}
      <div className="ag-theme-alpine" style={{ flex: '1 1 0', minHeight: 0, width: '100%', display: 'flex', flexDirection: 'column' }}>
      <style>{GRID_STYLES}</style>

      {savingRow !== null && (
        <div className="absolute right-4 top-2 z-10 flex items-center gap-1.5 text-xs font-medium text-[#0A6BA8] bg-white border border-[#BFDBFE] px-3 py-1.5 rounded-full shadow-sm">
          <svg className="w-3 h-3 animate-spin" fill="none" viewBox="0 0 24 24">
            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z" />
          </svg>
          Saving…
        </div>
      )}

      <AgGridReact<Lead>
        ref={gridRef}
        rowData={filtered}
        columnDefs={columnDefs}
        defaultColDef={defaultColDef}
        context={gridContext}
        onGridReady={onGridReady}
        onCellValueChanged={onCellValueChanged}
        pagination
        paginationPageSize={25}
        paginationPageSizeSelector={[25, 50, 100]}
        rowHeight={48}
        headerHeight={44}
        animateRows={false}
        suppressCellFocus={false}
        enableCellTextSelection
        alwaysShowHorizontalScroll
        alwaysShowVerticalScroll
        getRowId={(params) => {
          const d = params.data as any;
          return String(d.leadId ?? d.rowIndex);
        }}
        getRowClass={getRowClass}
      />
    </div>
    </>
  );
}
