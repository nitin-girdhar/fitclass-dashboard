'use client';

import { useState } from 'react';
import type { TimelineEvent } from '@/src/types/db';

interface Props {
  followUp: TimelineEvent;
  onClose: () => void;
  onUpdated: () => void;
}

type Action = 'complete' | 'reschedule' | 'add_note';

function defaultRescheduleAt(): string {
  const d = new Date();
  d.setDate(d.getDate() + 1);
  d.setHours(10, 0, 0, 0);
  return d.toISOString().slice(0, 16);
}

export function FollowUpActionModal({ followUp, onClose, onUpdated }: Props) {
  const [action, setAction] = useState<Action>('complete');
  const [notes, setNotes] = useState('');
  const [scheduledAt, setScheduledAt] = useState(defaultRescheduleAt);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const nowIso = new Date().toISOString().slice(0, 16);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);

    if (action === 'reschedule' && !scheduledAt) {
      setError('Please set a new date and time.');
      return;
    }
    if (action === 'add_note' && !notes.trim()) {
      setError('Please enter a note.');
      return;
    }

    if (!followUp.followupId) {
      setError('Follow-up ID missing — cannot update this entry.');
      return;
    }

    setLoading(true);
    try {
      const body: Record<string, unknown> = { action };
      if (action === 'reschedule') body.scheduledAt = new Date(scheduledAt).toISOString();
      if (notes.trim()) body.notes = notes.trim();

      const res = await fetch(
        `/api/leads/${followUp.leadId}/follow-ups/${followUp.followupId}`,
        {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        },
      );

      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error ?? 'Failed to update follow-up');
      }

      onUpdated();
    } catch (err: any) {
      setError(err.message ?? 'Something went wrong');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <div className="w-full max-w-md rounded-xl bg-white shadow-2xl">

        <div className="flex items-center justify-between border-b border-gray-200 px-6 py-4">
          <h2 className="text-lg font-semibold text-gray-900">Update Follow-Up</h2>
          <button
            onClick={onClose}
            className="rounded-md p-1 text-gray-400 hover:bg-gray-100 hover:text-gray-600"
          >
            ✕
          </button>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4 px-6 py-5">

          <div>
            <label className="mb-2 block text-sm font-medium text-gray-700">Action</label>
            <div className="flex gap-2">
              {(['complete', 'reschedule', 'add_note'] as Action[]).map((a) => (
                <button
                  key={a}
                  type="button"
                  onClick={() => setAction(a)}
                  className={`flex-1 rounded-md border px-3 py-2 text-sm font-medium transition-colors ${
                    action === a
                      ? 'border-indigo-600 bg-indigo-50 text-indigo-700'
                      : 'border-gray-300 bg-white text-gray-700 hover:bg-gray-50'
                  }`}
                >
                  {a === 'complete' ? 'Complete' : a === 'reschedule' ? 'Reschedule' : 'Add Note'}
                </button>
              ))}
            </div>
          </div>

          {action === 'reschedule' && (
            <div>
              <label className="mb-1 block text-sm font-medium text-gray-700">
                New date &amp; time <span className="text-red-500">*</span>
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
          )}

          <div>
            <label className="mb-1 block text-sm font-medium text-gray-700">
              {action === 'add_note' ? (
                <>Note <span className="text-red-500">*</span></>
              ) : (
                <>Notes <span className="text-xs font-normal text-gray-400">(optional)</span></>
              )}
            </label>
            <textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder={
                action === 'complete'
                  ? 'What was the outcome of this follow-up?'
                  : action === 'reschedule'
                  ? 'Why is this being rescheduled?'
                  : 'Add a note to this follow-up…'
              }
              rows={3}
              className="w-full resize-none rounded-md border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
            />
          </div>

          {error && (
            <p className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-600">
              {error}
            </p>
          )}

          <div className="flex gap-3 pt-1">
            <button
              type="button"
              onClick={onClose}
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
              ) : (
                'Save'
              )}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
