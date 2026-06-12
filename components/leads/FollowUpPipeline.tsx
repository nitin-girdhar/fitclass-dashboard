'use client';

import { useEffect, useState, useCallback } from 'react';
import type { FollowUpEnriched } from '@/src/types/db';

interface Props {
  /** Pre-filter to a specific rep (undefined = show all for the org). */
  assignedRepId?: string;
  /** Show only overdue entries. */
  overdueOnly?: boolean;
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleString('en-IN', {
    day: 'numeric',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function OverdueBadge({ minutes }: { minutes: number }) {
  const hrs = Math.floor(minutes / 60);
  const mins = minutes % 60;
  const label = hrs > 0 ? `${hrs}h ${mins}m overdue` : `${mins}m overdue`;
  return (
    <span className="inline-block rounded-full bg-red-100 px-2 py-0.5 text-xs font-medium text-red-700">
      {label}
    </span>
  );
}

export function FollowUpPipeline({ assignedRepId, overdueOnly }: Props) {
  const [pipeline, setPipeline] = useState<FollowUpEnriched[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchPipeline = useCallback(() => {
    setLoading(true);
    setError(null);
    const params = new URLSearchParams();
    if (assignedRepId) params.set('assignedRepId', assignedRepId);
    if (overdueOnly) params.set('overdueOnly', 'true');

    fetch(`/api/follow-ups?${params}`)
      .then((r) => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        return r.json();
      })
      .then((d) => setPipeline(d.pipeline ?? []))
      .catch((err) => setError(err.message ?? 'Failed to load follow-ups'))
      .finally(() => setLoading(false));
  }, [assignedRepId, overdueOnly]);

  useEffect(() => {
    fetchPipeline();
  }, [fetchPipeline]);

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12 text-sm text-gray-400">
        Loading follow-ups…
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex items-center justify-center py-12 text-sm text-red-500">
        {error}
      </div>
    );
  }

  if (!pipeline.length) {
    return (
      <div className="flex items-center justify-center py-12 text-sm text-gray-400">
        {overdueOnly ? 'No overdue follow-ups.' : 'No pending follow-ups.'}
      </div>
    );
  }

  return (
    <div className="overflow-x-auto rounded-lg border border-gray-200">
      <table className="min-w-full divide-y divide-gray-200 text-sm">
        <thead className="bg-gray-50">
          <tr>
            <th className="px-4 py-3 text-left font-medium text-gray-500">Lead</th>
            <th className="px-4 py-3 text-left font-medium text-gray-500">Assigned To</th>
            <th className="px-4 py-3 text-left font-medium text-gray-500">Status</th>
            <th className="px-4 py-3 text-left font-medium text-gray-500">Scheduled</th>
            <th className="px-4 py-3 text-left font-medium text-gray-500">Last Interaction</th>
            <th className="px-4 py-3 text-left font-medium text-gray-500">Notes</th>
            <th className="px-4 py-3" />
          </tr>
        </thead>
        <tbody className="divide-y divide-gray-100 bg-white">
          {pipeline.map((item) => (
            <tr
              key={item.followUpId}
              className={item.isOverdue ? 'bg-red-50' : undefined}
            >
              <td className="px-4 py-3">
                <p className="font-medium text-gray-900">{item.leadFullName}</p>
                {item.leadPhone && (
                  <p className="text-xs text-gray-400">{item.leadPhone}</p>
                )}
                <span className="mt-0.5 inline-block rounded-full bg-gray-100 px-2 py-0.5 text-xs text-gray-600">
                  {item.leadStatus.replace(/_/g, ' ')}
                </span>
              </td>
              <td className="px-4 py-3">
                <p className="text-gray-700">{item.assignedRepName}</p>
                <p className="text-xs text-gray-400">{item.assignedRepEmail}</p>
              </td>
              <td className="px-4 py-3">
                {item.isOverdue ? (
                  <OverdueBadge minutes={item.minutesOverdue ?? 0} />
                ) : (
                  <span className="inline-block rounded-full bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-700">
                    {item.followUpStatus.replace(/_/g, ' ')}
                  </span>
                )}
              </td>
              <td className="whitespace-nowrap px-4 py-3 text-gray-600">
                {formatDate(item.scheduledAt)}
              </td>
              <td className="px-4 py-3 text-gray-500">
                {item.lastInteractionAt ? (
                  <>
                    <p className="text-xs">{formatDate(item.lastInteractionAt)}</p>
                    {item.lastInteractionType && (
                      <p className="text-xs text-gray-400">{item.lastInteractionType}</p>
                    )}
                  </>
                ) : (
                  <span className="text-xs text-gray-300">—</span>
                )}
              </td>
              <td className="max-w-[200px] px-4 py-3 text-xs text-gray-500">
                {item.notes ?? <span className="text-gray-300">—</span>}
              </td>
              <td className="px-4 py-3">
                <a
                  href={`/dashboard/leads?leadId=${item.leadId}`}
                  className="text-xs font-medium text-indigo-600 hover:underline"
                >
                  View lead
                </a>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
