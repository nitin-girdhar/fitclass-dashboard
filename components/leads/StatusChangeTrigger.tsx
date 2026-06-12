'use client';

import { useState } from 'react';
import type { LeadStatus } from '@/src/types/db';
import { FollowUpScheduleModal, type FollowUpDetails } from './FollowUpScheduleModal';

interface OrgUser {
  id: string;
  fullName: string;
  email: string;
}

interface Props {
  leadId: string;
  currentStatus: string;
  statuses: LeadStatus[];
  orgUsers: OrgUser[];
  currentUserId: string;
  failReasons?: { id: number; name: string; label: string; description: string | null }[];
  onStatusChanged: (newStatus: string) => void;
}

export function StatusChangeTrigger({
  leadId,
  currentStatus,
  statuses,
  orgUsers,
  currentUserId,
  failReasons,
  onStatusChanged,
}: Props) {
  const [pendingStatus, setPendingStatus] = useState<LeadStatus | null>(null);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function handleStatusSelect(statusName: string) {
    if (statusName === currentStatus) return;
    const selected = statuses.find((s) => s.name === statusName);
    if (!selected) return;

    setError(null);

    // Open modal when: status requires a follow-up OR is a rejection status (needs fail reason + note).
    // Everything else commits directly with no extra input needed.
    if (selected.requiresFollowup || selected.isRejection) {
      setPendingStatus(selected);
      setIsModalOpen(true);
    } else {
      commitStatusChange({ newStatus: statusName });
    }
  }

  async function commitStatusChange(payload: {
    newStatus: string;
    failReasonId?: number;
    transitionNote?: string;
    followUp?: { assignedUserId: string; scheduledAt: string; notes?: string };
  }) {
    setSubmitting(true);
    setError(null);
    try {
      const res = await fetch(`/api/leads/${leadId}/status`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error ?? 'Failed to update status');
      }
      onStatusChanged(payload.newStatus);
    } catch (err: any) {
      setError(err.message ?? 'Something went wrong');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="relative">
      <select
        value={currentStatus}
        disabled={submitting}
        onChange={(e) => handleStatusSelect(e.target.value)}
        className="rounded border border-gray-300 px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 disabled:cursor-not-allowed disabled:opacity-50"
      >
        {statuses.map((s) => (
          <option key={s.id} value={s.name}>
            {s.label}
            {s.requiresFollowup ? ' *' : ''}
          </option>
        ))}
      </select>

      {error && <p className="mt-1 text-xs text-red-600">{error}</p>}

      {pendingStatus && (
        <FollowUpScheduleModal
          open={isModalOpen}
          newStatus={pendingStatus}
          orgUsers={orgUsers}
          currentUserId={currentUserId}
          failReasons={pendingStatus.isRejection ? failReasons : undefined}
          onConfirm={async (details: FollowUpDetails) => {
            await commitStatusChange({
              newStatus: pendingStatus.name,
              ...details,
            });
            setIsModalOpen(false);
            setPendingStatus(null);
          }}
          onCancel={() => {
            setIsModalOpen(false);
            setPendingStatus(null);
          }}
        />
      )}
    </div>
  );
}
