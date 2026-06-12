'use client';

import { useEffect, useState, useCallback } from 'react';
import type { TimelineEvent } from '@/src/types/db';
import { FollowUpActionModal } from './FollowUpActionModal';

interface Props {
  leadId: string;
}

function StatusBadge({ status }: { status: string }) {
  const label = status.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
  const colourMap: Record<string, string> = {
    new: 'bg-gray-100 text-gray-700',
    contacted: 'bg-blue-100 text-blue-700',
    qualified: 'bg-indigo-100 text-indigo-700',
    on_hold: 'bg-yellow-100 text-yellow-700',
    nurturing: 'bg-purple-100 text-purple-700',
    converted: 'bg-green-100 text-green-700',
    failed: 'bg-red-100 text-red-700',
  };
  return (
    <span className={`inline-block rounded-full px-2 py-0.5 text-xs font-medium ${colourMap[status] ?? 'bg-gray-100 text-gray-700'}`}>
      {label}
    </span>
  );
}

function FollowUpStatusBadge({ status }: { status: string }) {
  const label = status.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
  const colourMap: Record<string, string> = {
    pending: 'bg-amber-100 text-amber-700',
    completed: 'bg-green-100 text-green-700',
    missed: 'bg-red-100 text-red-700',
    rescheduled: 'bg-blue-100 text-blue-700',
  };
  return (
    <span className={`inline-block rounded-full px-2 py-0.5 text-xs font-medium ${colourMap[status] ?? 'bg-gray-100 text-gray-700'}`}>
      {label}
    </span>
  );
}

function dotColour(event: TimelineEvent): string {
  if (event.eventType === 'status_change') return 'bg-indigo-500';
  if (event.followupStatus === 'completed') return 'bg-green-500';
  if (event.followupStatus === 'missed') return 'bg-red-400';
  return 'bg-amber-400';
}

function cardBorder(event: TimelineEvent): string {
  if (event.eventType === 'follow_up') {
    if (event.followupStatus === 'pending') return 'border-amber-200 bg-amber-50';
    if (event.followupStatus === 'missed') return 'border-red-200 bg-red-50';
  }
  return 'border-gray-200 bg-white';
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleString('en-IN', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

export function LeadTimeline({ leadId }: Props) {
  const [events, setEvents] = useState<TimelineEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [activeFollowUp, setActiveFollowUp] = useState<TimelineEvent | null>(null);

  const fetchTimeline = useCallback(() => {
    setLoading(true);
    fetch(`/api/leads/${leadId}/timeline`)
      .then((r) => r.json())
      .then((d) => setEvents(d.timeline ?? []))
      .finally(() => setLoading(false));
  }, [leadId]);

  useEffect(() => {
    fetchTimeline();
  }, [fetchTimeline]);

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12 text-sm text-gray-400">
        Loading timeline…
      </div>
    );
  }

  if (!events.length) {
    return (
      <div className="flex items-center justify-center py-12 text-sm text-gray-400">
        No activity yet on this lead.
      </div>
    );
  }

  return (
    <div className="relative">
      {/* Vertical connector line */}
      <div className="absolute bottom-0 left-5 top-0 w-0.5 bg-gray-200" />

      <ul className="space-y-4 pl-12">
        {events.map((event) => (
          <li key={event.eventId} className="relative">
            {/* Timeline dot */}
            <span
              className={`absolute -left-7 flex h-4 w-4 items-center justify-center rounded-full ring-4 ring-white ${dotColour(event)}`}
            />

            <div className={`rounded-lg border px-4 py-3 ${cardBorder(event)}`}>
              <div className="flex items-start justify-between gap-2">
                <div>
                  {event.eventType === 'status_change' ? (
                    <p className="text-sm font-medium text-gray-900">
                      Status changed
                      {event.oldStatus && (
                        <span className="font-normal text-gray-500">
                          {' '}from <StatusBadge status={event.oldStatus} />
                        </span>
                      )}
                      <span className="font-normal text-gray-500"> to </span>
                      <StatusBadge status={event.newStatus!} />
                    </p>
                  ) : (
                    <p className="text-sm font-medium text-gray-900">
                      Follow-up{' '}
                      <FollowUpStatusBadge status={event.followupStatus!} />
                    </p>
                  )}
                  <p className="mt-0.5 text-xs text-gray-400">
                    {event.actorName ?? 'System'} · {formatDate(event.eventAt)}
                  </p>
                </div>

                {event.eventType === 'follow_up' &&
                  ['pending', 'missed'].includes(event.followupStatus ?? '') && (
                    <button
                      onClick={() => setActiveFollowUp(event)}
                      className="shrink-0 rounded-md border border-gray-300 bg-white px-2.5 py-1 text-xs font-medium text-gray-700 hover:bg-gray-50"
                    >
                      Update
                    </button>
                  )}
              </div>

              {event.eventType === 'follow_up' && event.assignedToName && (
                <p className="mt-1.5 text-xs text-gray-500">
                  Assigned to{' '}
                  <span className="font-medium">{event.assignedToName}</span>
                  {event.scheduledAt && (
                    <> · Due {formatDate(event.scheduledAt)}</>
                  )}
                </p>
              )}

              {event.newFailReason && (
                <p className="mt-1.5 text-xs text-red-600">
                  Reason: {event.newFailReason.replace(/_/g, ' ')}
                </p>
              )}

              {event.note && (
                <p className="mt-2 rounded border-l-2 border-gray-300 bg-gray-50 px-3 py-2 text-sm text-gray-600">
                  {event.note}
                </p>
              )}
            </div>
          </li>
        ))}
      </ul>

      {activeFollowUp && (
        <FollowUpActionModal
          followUp={activeFollowUp}
          onClose={() => setActiveFollowUp(null)}
          onUpdated={() => {
            setActiveFollowUp(null);
            fetchTimeline();
          }}
        />
      )}
    </div>
  );
}
