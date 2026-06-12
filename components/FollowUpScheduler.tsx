'use client';

import { useState } from 'react';
import { createPortal } from 'react-dom';
import type { SessionUser } from '@/src/types/auth';

export interface FollowUpData {
  // Follow-up scheduling (when requires_followup)
  assignedUserId?: string;
  scheduledAt?: string;
  notes?: string | null;
  // Rejection (when is_rejection)
  failReasonId?: number;
  transitionNote?: string;
}

interface FailReason { id: number; name: string; label: string; }

interface Props {
  statusName: string;
  statusLabel?: string;
  isRejection?: boolean;
  failReasons?: FailReason[];
  candidates: SessionUser[];
  onConfirm: (data: FollowUpData) => void;
  onCancel: () => void;
}

export default function FollowUpScheduler({
  statusName, statusLabel, isRejection, failReasons,
  candidates, onConfirm, onCancel,
}: Props) {
  const displayLabel = statusLabel ?? statusName;

  // Follow-up fields
  const [assignedUserId, setAssignedUserId] = useState(candidates[0]?.id ?? '');
  const [scheduledAt, setScheduledAt] = useState(() => {
    const d = new Date();
    d.setDate(d.getDate() + 1);
    d.setHours(10, 0, 0, 0);
    return d.toISOString().slice(0, 16);
  });
  const [notes, setNotes] = useState('');
  const [notesError, setNotesError] = useState(false);

  // Rejection fields
  const [failReasonId, setFailReasonId] = useState<number | ''>('');
  const [transitionNote, setTransitionNote] = useState('');
  const [failReasonError, setFailReasonError] = useState(false);

  const handleConfirm = () => {
    if (isRejection) {
      if (!failReasonId) { setFailReasonError(true); return; }
      onConfirm({
        failReasonId: Number(failReasonId),
        transitionNote: transitionNote.trim() || undefined,
      });
      return;
    }
    // Follow-up path
    if (!assignedUserId || !scheduledAt) return;
    if (!notes.trim()) { setNotesError(true); return; }
    setNotesError(false);
    onConfirm({ assignedUserId, scheduledAt: new Date(scheduledAt).toISOString(), notes: notes.trim() });
  };

  if (typeof document === 'undefined') return null;

  return createPortal(
    <div className="fixed inset-0 z-[200] flex items-center justify-center bg-black/40 backdrop-blur-[2px]">
      <div className="mx-4 w-full max-w-md overflow-hidden rounded-2xl bg-white shadow-2xl">

        {/* Header */}
        <div className="border-b border-[#F1F5F9] px-6 py-4">
          <h2 className="text-base font-bold text-[#0F172A]">
            {isRejection ? 'Confirm Rejection' : 'Schedule Follow-up'}
          </h2>
          <p className="mt-0.5 text-sm text-[#64748B]">
            {isRejection
              ? <>Moving lead to <span className="font-semibold text-[#0F172A]">{displayLabel}</span> — a reason is required.</>
              : <>Status changed to <span className="font-semibold text-[#0F172A]">{displayLabel}</span> — a follow-up is required.</>
            }
          </p>
        </div>

        {/* Form */}
        <div className="flex flex-col gap-4 px-6 py-5">
          {isRejection ? (
            <>
              {/* Fail reason */}
              <div className="flex flex-col gap-1.5">
                <label className="text-xs font-semibold uppercase tracking-wide text-[#64748B]">
                  Reason for failure <span className="text-red-500">*</span>
                </label>
                <select
                  value={failReasonId}
                  onChange={(e) => { setFailReasonId(Number(e.target.value)); setFailReasonError(false); }}
                  className={`w-full rounded-lg border px-3 py-2 text-sm text-[#0F172A] focus:outline-none focus:ring-2 ${
                    failReasonError
                      ? 'border-red-400 focus:border-red-500 focus:ring-red-200'
                      : 'border-[#E2E8F0] focus:border-[#0b6cbf] focus:ring-[#0b6cbf]/20'
                  }`}
                >
                  <option value="" disabled>Select a reason…</option>
                  {(failReasons ?? []).map((r) => (
                    <option key={r.id} value={r.id}>{r.label}</option>
                  ))}
                </select>
                {failReasonError && (
                  <p className="text-xs text-red-500">Please select a reason before saving.</p>
                )}
              </div>

              {/* Transition note (optional) */}
              <div className="flex flex-col gap-1.5">
                <label className="text-xs font-semibold uppercase tracking-wide text-[#64748B]">
                  Note <span className="font-normal normal-case text-[#94A3B8]">(optional)</span>
                </label>
                <textarea
                  value={transitionNote}
                  onChange={(e) => setTransitionNote(e.target.value)}
                  placeholder={`Why is this lead being moved to ${displayLabel}?`}
                  rows={2}
                  className="w-full resize-none rounded-lg border border-[#E2E8F0] px-3 py-2 text-sm text-[#0F172A] placeholder:text-[#CBD5E1] focus:border-[#0b6cbf] focus:outline-none focus:ring-2 focus:ring-[#0b6cbf]/20"
                />
              </div>
            </>
          ) : (
            <>
              {/* Assignee */}
              <div className="flex flex-col gap-1.5">
                <label className="text-xs font-semibold uppercase tracking-wide text-[#64748B]">
                  Assign Follow-up To
                </label>
                <select
                  value={assignedUserId}
                  onChange={(e) => setAssignedUserId(e.target.value)}
                  className="w-full rounded-lg border border-[#E2E8F0] px-3 py-2 text-sm text-[#0F172A] focus:border-[#0b6cbf] focus:outline-none focus:ring-2 focus:ring-[#0b6cbf]/20"
                >
                  {candidates.length === 0 && <option value="">No assignees available</option>}
                  {candidates.map((u) => (
                    <option key={u.id} value={u.id}>{u.name ?? u.email}</option>
                  ))}
                </select>
              </div>

              {/* Date/time */}
              <div className="flex flex-col gap-1.5">
                <label className="text-xs font-semibold uppercase tracking-wide text-[#64748B]">
                  Schedule Date &amp; Time
                </label>
                <input
                  type="datetime-local"
                  value={scheduledAt}
                  onChange={(e) => setScheduledAt(e.target.value)}
                  className="w-full rounded-lg border border-[#E2E8F0] px-3 py-2 text-sm text-[#0F172A] focus:border-[#0b6cbf] focus:outline-none focus:ring-2 focus:ring-[#0b6cbf]/20"
                />
              </div>

              {/* Notes */}
              <div className="flex flex-col gap-1.5">
                <label className="text-xs font-semibold uppercase tracking-wide text-[#64748B]">
                  Notes <span className="font-normal normal-case text-red-500">*</span>
                </label>
                <textarea
                  value={notes}
                  onChange={(e) => { setNotes(e.target.value); if (e.target.value.trim()) setNotesError(false); }}
                  placeholder="Add notes for this follow-up…"
                  rows={3}
                  className={`w-full resize-none rounded-lg border px-3 py-2 text-sm text-[#0F172A] placeholder:text-[#CBD5E1] focus:outline-none focus:ring-2 ${
                    notesError
                      ? 'border-red-400 focus:border-red-500 focus:ring-red-200'
                      : 'border-[#E2E8F0] focus:border-[#0b6cbf] focus:ring-[#0b6cbf]/20'
                  }`}
                />
                {notesError && (
                  <p className="text-xs text-red-500">Notes are required before saving.</p>
                )}
              </div>
            </>
          )}
        </div>

        {/* Actions */}
        <div className="flex justify-end gap-3 border-t border-[#F1F5F9] px-6 py-4">
          <button
            type="button"
            onClick={onCancel}
            className="rounded-lg border border-[#E2E8F0] px-4 py-2 text-sm font-semibold text-[#475569] transition-colors hover:bg-[#F8FAFC]"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={handleConfirm}
            disabled={!isRejection && (!assignedUserId || !scheduledAt)}
            className="rounded-lg bg-[#0b6cbf] px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-[#0a5fa8] disabled:cursor-not-allowed disabled:opacity-60"
          >
            {isRejection ? 'Confirm' : 'Confirm & Save'}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
