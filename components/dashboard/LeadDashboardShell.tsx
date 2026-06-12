'use client';

/**
 * Lead-management surface — the unified replacement for the legacy CRM at `/`.
 *
 * Mounts inside `/dashboard/leads` and inherits the dashboard layout's auth
 * gate, sidebar nav, and user menu.
 *
 * ── Layout contract (read this before touching) ─────────────────────────────
 * The shell is a **clean flex column** that exactly fills its parent
 * `<main>` (height 100%). Every chrome section is `shrink-0`, the bottom
 * grid region is `flex-1 min-h-0 overflow-hidden`, and AG Grid handles its
 * own internal scrolling.
 *
 * INVARIANTS that must hold:
 *  1. `<main>` in the dashboard layout is `flex flex-col overflow-y-auto`
 *     with NO padding — full-bleed pages would otherwise need negative-
 *     margin escape hatches that break sticky positioning and overflow
 *     bookkeeping (this was the Phase 2G overlap bug).
 *  2. NO `position: sticky` in this shell. The shell fills `<main>` exactly,
 *     so there is nothing to "stick" against — adding sticky here would
 *     reintroduce z-index stacking against the chrome below it.
 *  3. NO `h-[calc(100% + Xrem)]`. Height is `100%`; period.
 *
 * ── Composition rule for future sections ────────────────────────────────────
 * New chrome rows above the grid go between the existing ones with the same
 * `shrink-0 border-b bg-white` recipe. New full-bleed surfaces go as siblings
 * to the grid region inside the flex-1 slot.
 */
import { useEffect, useMemo, useState } from 'react';
import { useBranches, type DynamicBranch } from '@/hooks/useBranches';
import { useLeads } from '@/hooks/useLeads';
import { useLocationFilters } from '@/hooks/useLocationFilters';
import { useLeadSources } from '@/hooks/useLeadSources';
import LocationFilters from '@/components/dashboard/LocationFilters';
import StatsCards from '@/components/StatsCards';
import LeadsTable from '@/components/LeadsTable';
import DownloadButton from '@/components/common/DownloadButton';
import type { SessionUser } from '@/src/types/auth';
import { applyLeadFilter } from '@/src/lib/leads/filter';
import { buildLeadExportColumns } from '@/src/lib/export/lead-columns';
import { buildFilename, exportRows, type ExportFormat } from '@/src/lib/export/export';

const INLINE_ASSIGN_ROLES: ReadonlyArray<SessionUser['role']> = [
  'super_admin', 'tenant_admin', 'org_admin', 'admin',
  'org_manager', 'manager', 'senior_sales_executive',
];

export type CardFilter =
  | 'all'
  | 'new'
  | 'callAttempted'
  | 'unqualified'
  | 'visitScheduled'
  | 'converted'
  | 'followUp'
  | 'unassigned';

const FILTER_LABELS: Record<CardFilter, string> = {
  all:            'All Leads',
  new:            'New Leads',
  callAttempted:  'Call Attempted',
  unqualified:    'Unqualified Leads',
  visitScheduled: 'Visit Scheduled',
  converted:      'Converted',
  followUp:       'Follow-up Required',
  unassigned:     'Unassigned Leads',
};

interface Props {
  actor: SessionUser;
}

const DASHBOARD_ID = 'meta-leads';

export default function LeadDashboardShell({ actor }: Props) {
  const [activeFilter, setActiveFilter] = useState<CardFilter>('all');

  // ── Location filters (cascading country → state → city) ─────────────────
  const {
    countries, states, cities,
    selectedCountries, selectedStates, selectedCities,
    setSelectedCountries, setSelectedStates, setSelectedCities,
    loadingCountries, loadingStates, loadingCities,
  } = useLocationFilters();

  // Build location filter for branches API
  const locationFilter = useMemo(() => ({
    cityIds:    selectedCities.map((c) => c.id),
    stateIds:   selectedCities.length === 0 ? selectedStates.map((s) => s.id)   : undefined,
    countryIds: selectedStates.length === 0 && selectedCities.length === 0
      ? selectedCountries.map((c) => c.id)
      : undefined,
  }), [selectedCountries, selectedStates, selectedCities]);

  // ── Branches (orgs), filtered by selected location ───────────────────────
  const { branches, loading: branchesLoading, error: branchesError } =
    useBranches(locationFilter);

  // ── Selected branches (multi-select) ────────────────────────────────────
  const [selectedBranches, setSelectedBranches] = useState<DynamicBranch[]>([]);

  // ── Lead sources (platforms) ─────────────────────────────────────────────
  const { sources: leadSources, loading: sourcesLoading } = useLeadSources();
  const [selectedSources, setSelectedSources] = useState<string[]>([]);

  // Auto-clear branch selection when the available branch list changes
  useEffect(() => {
    if (selectedBranches.length === 0) return;
    const availableIds = new Set(branches.map((b) => b.id));
    const stillValid = selectedBranches.filter((b) => availableIds.has(b.id));
    if (stillValid.length !== selectedBranches.length) {
      setSelectedBranches(stillValid);
    }
  }, [branches]); // eslint-disable-line react-hooks/exhaustive-deps

  // orgIds to pass to the leads API: selected branch org UUIDs (or empty = session org)
  const orgIds = useMemo(
    () => selectedBranches.length > 0 ? selectedBranches.map((b) => b.id) : undefined,
    [selectedBranches],
  );

  // platforms filter derived from selected lead sources
  const platforms = useMemo(
    () => selectedSources.length > 0 ? selectedSources : undefined,
    [selectedSources],
  );

  // Primary branch for display and inline-assignment purposes
  const primaryBranch = selectedBranches[0] ?? branches[0] ?? null;

  // ── Leads ─────────────────────────────────────────────────────────────────
  const {
    leads, stats, loading, error,
    headers, statusOptions, statusLabelMap, requiresFollowupStatuses,
    rejectionStatuses, failReasons,
    assignments, refetch,
    updateLead,
  } = useLeads(orgIds, platforms);

  // ── Inline-assignment candidate cache ────────────────────────────────────
  const [candidates, setCandidates] = useState<SessionUser[]>([]);
  const canInlineAssign = INLINE_ASSIGN_ROLES.includes(actor.role);
  const currentOrgId = primaryBranch?.id ?? actor.orgId;

  useEffect(() => {
    if (!canInlineAssign || !currentOrgId) {
      setCandidates([]);
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(
          `/api/users/assignable?orgId=${encodeURIComponent(currentOrgId)}`,
          { cache: 'no-store' },
        );
        if (!res.ok) { if (!cancelled) setCandidates([]); return; }
        const data = (await res.json()) as { users?: SessionUser[] };
        if (cancelled) return;
        setCandidates(Array.isArray(data.users) ? data.users : []);
      } catch {
        if (!cancelled) setCandidates([]);
      }
    })();
    return () => { cancelled = true; };
  }, [canInlineAssign, currentOrgId]);

  const handleFilterChange = (filter: CardFilter) => {
    setActiveFilter((prev) => (prev === filter ? 'all' : filter));
  };

  // ── Export ───────────────────────────────────────────────────────────────
  const exportLeads = (format: ExportFormat) => {
    const rows = applyLeadFilter(leads, activeFilter, requiresFollowupStatuses);
    const columns = buildLeadExportColumns(headers, assignments);
    const branchLabel = selectedBranches.length === 1
      ? selectedBranches[0].name
      : selectedBranches.length > 1
        ? `${selectedBranches.length}-branches`
        : primaryBranch?.name ?? '';
    const filename = buildFilename([
      branchLabel,
      activeFilter === 'all' ? '' : FILTER_LABELS[activeFilter],
    ]);
    exportRows(rows, columns, filename, format);
  };

  const exportableCount = applyLeadFilter(leads, activeFilter, requiresFollowupStatuses).length;

  // Display label for the toolbar
  const branchLabel = selectedBranches.length === 0
    ? (primaryBranch?.name ?? '—')
    : selectedBranches.length === 1
      ? selectedBranches[0].name
      : `${selectedBranches.length} branches`;

  return (
    <div className="flex w-full flex-1 flex-col bg-[#F8FAFC] lg:min-h-0">

      {/* ── Location + branch filters ───────────────────────────────────────── */}
      <LocationFilters
        countries={countries}
        states={states}
        cities={cities}
        selectedCountries={selectedCountries}
        selectedStates={selectedStates}
        selectedCities={selectedCities}
        onCountriesChange={setSelectedCountries}
        onStatesChange={setSelectedStates}
        onCitiesChange={setSelectedCities}
        loadingCountries={loadingCountries}
        loadingStates={loadingStates}
        loadingCities={loadingCities}
        branches={branches}
        selectedBranches={selectedBranches}
        onBranchesChange={setSelectedBranches}
        loadingBranches={branchesLoading}
        leadSources={leadSources}
        selectedSources={selectedSources}
        onSourcesChange={setSelectedSources}
        loadingSources={sourcesLoading}
      />

      {branchesError && (
        <div className="mx-4 mt-2 shrink-0 rounded-lg border border-orange-100 bg-orange-50 px-4 py-2 text-xs text-[#EA580C] sm:mx-5">
          Could not load branches: {branchesError}
        </div>
      )}

      {/* ── Stats cards ────────────────────────────────────────────────────── */}
      <div className="shrink-0 border-b border-[#E2E8F0] bg-white">
        <StatsCards
          stats={stats}
          leads={leads}
          requiresFollowupStatuses={requiresFollowupStatuses}
          actor={actor}
          activeFilter={activeFilter}
          onFilterChange={handleFilterChange}
        />
      </div>

      {/* ── Per-branch toolbar ─────────────────────────────────────────────── */}
      <div className="flex shrink-0 items-center justify-between gap-2 border-b border-[#E2E8F0] bg-white px-4 py-1.5 sm:px-5 sm:py-2">
        <div className="flex min-w-0 items-center gap-2.5">
          <span className="shrink-0 text-sm font-semibold text-[#0F172A]">
            {branchLabel}
          </span>
          {!loading && (
            <span className="shrink-0 rounded-full border border-[#E2E8F0] bg-[#F1F5F9] px-2 py-0.5 text-xs font-medium tabular-nums text-[#64748B]">
              {leads.length} total
            </span>
          )}
          {activeFilter !== 'all' && (
            <span className="flex shrink-0 items-center gap-1 rounded-full border border-[#BFDBFE] bg-[#EFF6FF] px-2.5 py-0.5 text-xs font-medium text-[#0b6cbf]">
              Showing: {FILTER_LABELS[activeFilter]}
              <button
                type="button"
                onClick={() => setActiveFilter('all')}
                className="ml-0.5 transition-colors hover:text-[#1e3a5f]"
                title="Clear filter"
                aria-label="Clear filter"
              >
                ×
              </button>
            </span>
          )}
        </div>
        <div className="flex shrink-0 items-center gap-2">
          {error && (
            <span className="rounded-lg border border-orange-100 bg-orange-50 px-3 py-1.5 text-xs text-[#EA580C]">
              {error}
            </span>
          )}
          <DownloadButton
            onExport={exportLeads}
            rowCount={exportableCount}
            disabled={loading}
          />
        </div>
      </div>

      {/* ── Grid region ────────────────────────────────────────────────────────
          Desktop (≥lg): `flex-1 min-h-0 overflow-hidden` — the canonical
          "fill remaining vertical space and clip" recipe so the AG Grid
          gets an exact bounded height. `min-h-0` is critical there.
          Mobile/tablet: no min-h-0 / overflow-hidden — the wrapper grows
          with its content (a stacked card list) inside document scroll.
      */}
      <div className="flex w-full flex-1 flex-col p-2 sm:px-5 sm:py-3 lg:min-h-0 lg:overflow-hidden">
        <div className="flex w-full flex-1 flex-col rounded-xl border border-[#E2E8F0] bg-white shadow-sm lg:min-h-0 lg:overflow-hidden">
          <LeadsTable
            leads={leads}
            loading={loading || branchesLoading}
            statusFilter={activeFilter}
            onUpdate={updateLead}
            dashboardId={DASHBOARD_ID}
            activeBranchName={primaryBranch?.name ?? ''}
            newLeadRowKeys={new Set()}
            headers={headers}
            statusOptions={statusOptions}
            statusLabelMap={statusLabelMap}
            actor={actor}
            assignments={assignments}
            assignmentCandidates={candidates}
            onAssignmentChanged={refetch}
            requiresFollowupStatuses={requiresFollowupStatuses}
            rejectionStatuses={rejectionStatuses}
            failReasons={failReasons}
          />
        </div>
      </div>
    </div>
  );
}
