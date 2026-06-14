'use client';

import { useState } from 'react';
import type { LeadStage, LeadStageOutcome, OrgUser } from '@/src/types/db';
import { FollowUpScheduleModal, type FollowUpDetails } from './FollowUpScheduleModal';

interface Props {
  leadId: string;
  currentStage: string;
  stages: LeadStage[];
  orgUsers: OrgUser[];
  currentUserId: string;
  stageOutcomes?: LeadStageOutcome[];
  onStageChanged: (newStage: string) => void;
}

export function StatusChangeTrigger({
  leadId,
  currentStage,
  stages,
  orgUsers,
  currentUserId,
  stageOutcomes,
  onStageChanged,
}: Props) {
  const [pendingStage, setPendingStage] = useState<LeadStage | null>(null);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function handleStageSelect(stageName: string) {
    if (stageName === currentStage) return;
    const selected = stages.find((s) => s.name === stageName);
    if (!selected) return;

    setError(null);

    if (selected.followupRequired || selected.isRejected) {
      setPendingStage(selected);
      setIsModalOpen(true);
    } else {
      commitStageChange({ newStage: stageName });
    }
  }

  async function commitStageChange(payload: {
    newStage: string;
    outcomeId?: number;
    outcomeComment?: string;
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
        throw new Error(err.error ?? 'Failed to update stage');
      }
      onStageChanged(payload.newStage);
    } catch (err: any) {
      setError(err.message ?? 'Something went wrong');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="relative">
      <select
        value={currentStage}
        disabled={submitting}
        onChange={(e) => handleStageSelect(e.target.value)}
        className="rounded border border-gray-300 px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 disabled:cursor-not-allowed disabled:opacity-50"
      >
        {stages.map((s) => (
          <option key={s.id} value={s.name}>
            {s.label}
            {s.followupRequired ? ' *' : ''}
          </option>
        ))}
      </select>

      {error && <p className="mt-1 text-xs text-red-600">{error}</p>}

      {pendingStage && (
        <FollowUpScheduleModal
          open={isModalOpen}
          newStage={pendingStage}
          orgUsers={orgUsers}
          currentUserId={currentUserId}
          stageOutcomes={pendingStage.isRejected ? stageOutcomes : undefined}
          onConfirm={async (details: FollowUpDetails) => {
            await commitStageChange({
              newStage: pendingStage.name,
              ...details,
            });
            setIsModalOpen(false);
            setPendingStage(null);
          }}
          onCancel={() => {
            setIsModalOpen(false);
            setPendingStage(null);
          }}
        />
      )}
    </div>
  );
}
