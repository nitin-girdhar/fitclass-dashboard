'use client';

import { useState } from 'react';
import type { LeadStage, LeadStageOutcome, OrgUser } from '@/src/types/db';
import { defaultScheduledAt } from '@/src/lib/utils/date';

export interface FollowUpDetails {
  transitionNote?: string;
  outcomeId?: number;
  outcomeComment?: string;
  /** Absent when the new stage does not require a follow-up (e.g. 'unqualified'). */
  followUp?: {
    assignedUserId: string;
    scheduledAt: string;
    notes?: string;
  };
}

interface Props {
  open: boolean;
  newStage: LeadStage;
  orgUsers: OrgUser[];
  currentUserId: string;
  stageOutcomes?: LeadStageOutcome[];
  onConfirm: (details: FollowUpDetails) => Promise<void>;
  onCancel: () => void;
}

export function FollowUpScheduleModal({
  open,
  newStage,
  orgUsers,
  currentUserId,
  stageOutcomes,
  onConfirm,
  onCancel,
}: Props) {
  const [assignedUserId, setAssignedUserId] = useState(currentUserId);
  const [scheduledAt, setScheduledAt] = useState(defaultScheduledAt);
  const [followUpNotes, setFollowUpNotes] = useState('');
  const [transitionNote, setTransitionNote] = useState('');
  const [outcomeId, setOutcomeId] = useState<number | undefined>();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!open) return null;

  const needsFollowUp = newStage.followupRequired;
  const isRejected = newStage.isRejected;
  const stageLabel = newStage.label;
  const nowIso = new Date().toISOString().slice(0, 16);

  async function handleSubmit(e: React.BaseSyntheticEvent) {
    e.preventDefault();
    setError(null);

    if (isRejected && !outcomeId) {
      setError('Please select a reason for rejecting this lead.');
      return;
    }
    if (needsFollowUp && !assignedUserId) {
      setError('Please select a team member to assign this follow-up to.');
      return;
    }
    if (needsFollowUp && !scheduledAt) {
      setError('Please set a follow-up date and time.');
      return;
    }

    setLoading(true);
    try {
      const details: FollowUpDetails = {
        transitionNote: transitionNote || undefined,
        outcomeId,
      };
      if (needsFollowUp) {
        details.followUp = {
          assignedUserId,
          scheduledAt: new Date(scheduledAt).toISOString(),
          notes: followUpNotes || undefined,
        };
      }
      await onConfirm(details);
    } catch (err: any) {
      setError(err.message ?? 'Something went wrong. Please try again.');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <div className="w-full max-w-lg rounded-xl bg-white shadow-2xl">

        <div className="flex items-center justify-between border-b border-gray-200 px-6 py-4">
          <div>
            <h2 className="text-lg font-semibold text-gray-900">
              {needsFollowUp ? 'Schedule Follow-Up' : 'Confirm Stage Change'}
            </h2>
            <p className="mt-0.5 text-sm text-gray-500">
              Moving lead to{' '}
              <span className="font-medium text-indigo-600">{stageLabel}</span>
            </p>
          </div>
          <button
            onClick={onCancel}
            className="rounded-md p-1 text-gray-400 hover:bg-gray-100 hover:text-gray-600"
          >
            ✕
          </button>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4 px-6 py-5">

          {/* Outcome — only for rejection stages */}
          {isRejected && stageOutcomes && (
            <div>
              <label className="mb-1 block text-sm font-medium text-gray-700">
                Reason for rejection <span className="text-red-500">*</span>
              </label>
              <select
                value={outcomeId ?? ''}
                onChange={(e) => setOutcomeId(Number(e.target.value))}
                required
                className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
              >
                <option value="" disabled>Select a reason…</option>
                {stageOutcomes.map((r) => (
                  <option key={r.id} value={r.id}>
                    {r.label}
                  </option>
                ))}
              </select>
            </div>
          )}

          {/* Transition note — always optional */}
          <div>
            <label className="mb-1 block text-sm font-medium text-gray-700">
              Note
              <span className="ml-1 text-xs font-normal text-gray-400">(optional)</span>
            </label>
            <textarea
              value={transitionNote}
              onChange={(e) => setTransitionNote(e.target.value)}
              placeholder={`Why is this lead being moved to ${stageLabel}?`}
              rows={2}
              className="w-full resize-none rounded-md border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
            />
          </div>

          {/* Follow-up section — only shown when status requires it */}
          {needsFollowUp && (
            <>
              <div className="border-t border-dashed border-gray-200 pt-4">
                <p className="mb-3 text-xs font-semibold uppercase tracking-wide text-gray-500">
                  Follow-Up Details
                </p>
              </div>

              <div>
                <label className="mb-1 block text-sm font-medium text-gray-700">
                  Assign follow-up to <span className="text-red-500">*</span>
                </label>
                <select
                  value={assignedUserId}
                  onChange={(e) => setAssignedUserId(e.target.value)}
                  required
                  className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
                >
                  <option value="" disabled>Select team member…</option>
                  {orgUsers.map((u) => (
                    <option key={u.id} value={u.id}>
                      {u.fullName} ({u.email})
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="mb-1 block text-sm font-medium text-gray-700">
                  Follow-up date &amp; time <span className="text-red-500">*</span>
                </label>
                <input
                  type="datetime-local"
                  value={scheduledAt}
                  onChange={(e) => setScheduledAt(e.target.value)}
                  required
                  min={nowIso}
                  className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
                />
              </div>

              <div>
                <label className="mb-1 block text-sm font-medium text-gray-700">
                  Follow-up instructions
                  <span className="ml-1 text-xs font-normal text-gray-400">(optional)</span>
                </label>
                <textarea
                  value={followUpNotes}
                  onChange={(e) => setFollowUpNotes(e.target.value)}
                  placeholder="What should the follow-up agent do or ask?"
                  rows={3}
                  className="w-full resize-none rounded-md border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
                />
              </div>
            </>
          )}

          {error && (
            <p className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-600">
              {error}
            </p>
          )}

          <div className="flex gap-3 pt-2">
            <button
              type="button"
              onClick={onCancel}
              disabled={loading}
              className="flex-1 rounded-md border border-gray-300 px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={loading}
              className="flex flex-1 items-center justify-center gap-2 rounded-md bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-700 disabled:opacity-50"
            >
              {loading ? (
                <>
                  <svg className="h-4 w-4 animate-spin" viewBox="0 0 24 24" fill="none">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                  </svg>
                  Saving…
                </>
              ) : needsFollowUp ? (
                'Confirm & Schedule'
              ) : (
                'Confirm'
              )}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
