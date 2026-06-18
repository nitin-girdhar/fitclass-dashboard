'use client';

import { useEffect, useRef, useState, useCallback } from 'react';
import type { Lead, StatsData, UpdatePayload } from '@/types';
import type { AssignmentView } from '@/src/features/assignments/serializers';

function parseDate(s: string): number {
  if (!s) return 0;
  const d = new Date(s);
  return isNaN(d.getTime()) ? 0 : d.getTime();
}

function sortNewestFirst(leads: Lead[]): Lead[] {
  return [...leads].sort((a, b) => {
    const diff = parseDate(b.createdTime) - parseDate(a.createdTime);
    return diff !== 0 ? diff : b.rowIndex - a.rowIndex;
  });
}

export interface FailReason { id: number; name: string; label: string; stage_id: number; requires_comment: boolean; }

interface UseLeadsReturn {
  leads: Lead[];
  total: number;
  stats: StatsData;
  loading: boolean;
  error: string | null;
  headers: string[];
  statusOptions: string[];
  statusLabelMap: Record<string, string>;
  requiresFollowupStatuses: string[];
  rejectionStatuses: string[];
  failReasons: FailReason[];
  stageNameToId: Record<string, number>;
  assignments: Record<number, AssignmentView>;
  updateLead: (payload: UpdatePayload) => Promise<void>;
  refetch: () => Promise<void>;
  page: number;
  pageSize: number;
  setPage: (p: number) => void;
  setPageSize: (ps: number) => void;
}

export function useLeads(orgIds?: string[], platforms?: string[], assignedTo?: string): UseLeadsReturn {
  const [leads, setLeads]             = useState<Lead[]>([]);
  const [total, setTotal]             = useState(0);
  const [page, setPageState]          = useState(1);
  const [pageSize, setPageSizeState]  = useState(25);
  const [loading, setLoading]         = useState(true);
  const [error, setError]             = useState<string | null>(null);
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);
  const [headers, setHeaders]         = useState<string[]>([]);
  const [statusOptions, setStatusOptions] = useState<string[]>([]);
  const [statusLabelMap, setStatusLabelMap] = useState<Record<string, string>>({});
  const [assignments, setAssignments] = useState<Record<number, AssignmentView>>({});
  const [requiresFollowupStatuses, setRequiresFollowupStatuses] = useState<string[]>([]);
  const [rejectionStatuses, setRejectionStatuses] = useState<string[]>([]);
  const [failReasons, setFailReasons] = useState<FailReason[]>([]);
  const [stageNameToId, setStageNameToId] = useState<Record<string, number>>({});

  const orgIdsRef      = useRef(orgIds);
  const platformsRef   = useRef(platforms);
  const assignedToRef  = useRef(assignedTo);
  const pageRef        = useRef(page);
  const pageSizeRef    = useRef(pageSize);
  orgIdsRef.current    = orgIds;
  platformsRef.current = platforms;
  assignedToRef.current = assignedTo;
  pageRef.current      = page;
  pageSizeRef.current  = pageSize;

  // Reset to page 1 when filters change
  const setPage = useCallback((p: number) => setPageState(p), []);
  const setPageSize = useCallback((ps: number) => {
    setPageSizeState(ps);
    setPageState(1);
  }, []);

  const fetchData = useCallback(async (silent = false) => {
    if (!silent) setLoading(true);
    try {
      const params = new URLSearchParams();
      const ids = orgIdsRef.current;
      if (ids && ids.length > 0) params.set('orgIds', ids.join(','));
      const plats = platformsRef.current;
      if (plats && plats.length > 0) params.set('platforms', plats.join(','));
      if (assignedToRef.current) params.set('assignedTo', assignedToRef.current);
      params.set('page', String(pageRef.current));
      params.set('pageSize', String(pageSizeRef.current));
      const res = await fetch(`/api/leads?${params}`, { cache: 'no-store' });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);

      const json: {
        leads: Lead[];
        total?: number;
        headers: string[];
        statusOptions: string[];
        statusLabelMap?: Record<string, string>;
        requiresFollowupStatuses?: string[];
        rejectionStatuses?: string[];
        failReasons?: FailReason[];
        stageNameToId?: Record<string, number>;
        assignments?: Record<number, AssignmentView>;
      } = await res.json();

      if (Array.isArray(json.headers)) setHeaders(json.headers);
      if (Array.isArray(json.statusOptions)) setStatusOptions(json.statusOptions);
      if (json.statusLabelMap && typeof json.statusLabelMap === 'object') {
        setStatusLabelMap(json.statusLabelMap);
      }
      if (Array.isArray(json.requiresFollowupStatuses)) {
        setRequiresFollowupStatuses(json.requiresFollowupStatuses);
      }
      if (Array.isArray(json.rejectionStatuses)) {
        setRejectionStatuses(json.rejectionStatuses);
      }
      if (Array.isArray(json.failReasons)) {
        setFailReasons(json.failReasons);
      }
      if (json.stageNameToId && typeof json.stageNameToId === 'object') {
        setStageNameToId(json.stageNameToId);
      }
      setAssignments(json.assignments ?? {});
      const loadedLeads = sortNewestFirst(json.leads ?? []);
      setLeads(loadedLeads);
      setTotal(json.total ?? loadedLeads.length);
      setLastUpdated(new Date());
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unknown error');
    } finally {
      if (!silent) setLoading(false);
    }
  }, []);

  // When filters change: reset display state and go back to page 1.
  // setPage(1) triggers the page effect below which calls fetchData.
  useEffect(() => {
    setLeads([]);
    setTotal(0);
    setLoading(true);
    setLastUpdated(null);
    setPage(1);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [orgIds?.join(','), platforms?.join(','), assignedTo]);

  // Fetch whenever page or pageSize changes (also fires on initial mount).
  useEffect(() => {
    fetchData(false);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [page, pageSize, fetchData]);

  const updateLead = useCallback(
    async (payload: UpdatePayload) => {
      // Optimistic update
      setLeads((prev) =>
        prev.map((l) =>
          l.rowIndex === payload.rowIndex ? { ...l, [payload.field]: payload.value } : l,
        ),
      );

      if (!payload.leadId) {
        await fetchData(true);
        throw new Error('Cannot update lead: missing leadId');
      }

      let res: Response;
      if (payload.field === 'Status') {
        res = await fetch(`/api/leads/${payload.leadId}/status`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            newStage: payload.value,
            ...(payload.followUp          ? { followUp: payload.followUp }                 : {}),
            ...(payload.outcomeId != null ? { outcomeId: payload.outcomeId }               : {}),
            ...(payload.outcomeComment    ? { outcomeComment: payload.outcomeComment }     : {}),
            ...(payload.transitionNote    ? { transitionNote: payload.transitionNote }     : {}),
          }),
        });
      } else {
        // Comments → stored as metadata.remarks
        res = await fetch(`/api/leads/${payload.leadId}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ metadata: { remarks: payload.value } }),
        });
      }

      if (!res.ok) {
        await fetchData(true);
        const body = await res.json().catch(() => ({}));
        throw new Error((body as any).error ?? `HTTP ${res.status}`);
      }
    },
    [fetchData],
  );

  const refetch = useCallback(() => fetchData(true), [fetchData]);

  return {
    leads,
    total,
    stats: { total, lastUpdated },
    loading,
    error,
    headers,
    statusOptions,
    statusLabelMap,
    requiresFollowupStatuses,
    rejectionStatuses,
    failReasons,
    stageNameToId,
    assignments,
    updateLead,
    refetch,
    page,
    pageSize,
    setPage,
    setPageSize,
  };
}
