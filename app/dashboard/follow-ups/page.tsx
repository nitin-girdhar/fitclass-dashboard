/**
 * /dashboard/follow-ups — org-wide follow-up pipeline.
 *
 * Shows all pending and missed follow-ups for the org.
 * Sales reps see only their own follow-ups (enforced by the API).
 * Managers and above see the full org pipeline.
 */
import { requireSessionPage } from '@/src/lib/permissions/server';
import { FollowUpPipeline } from '@/components/leads/FollowUpPipeline';

export const dynamic = 'force-dynamic';

export default async function FollowUpsPage() {
  const actor = await requireSessionPage('/dashboard/follow-ups');

  const isSalesRep = actor.role === 'sales_rep';

  return (
    <div className="mx-auto max-w-7xl px-4 py-8 sm:px-6 lg:px-8">
      <div className="mb-6 flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Follow-Up Pipeline</h1>
          <p className="mt-1 text-sm text-gray-500">
            {isSalesRep
              ? 'Your pending and missed follow-ups'
              : 'All pending and missed follow-ups across the org'}
          </p>
        </div>
      </div>

      <div className="mb-8">
        <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-red-600">
          Overdue
        </h2>
        <FollowUpPipeline
          assignedRepId={isSalesRep ? actor.id : undefined}
          overdueOnly
        />
      </div>

      <div>
        <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-gray-500">
          All Pending &amp; Missed
        </h2>
        <FollowUpPipeline
          assignedRepId={isSalesRep ? actor.id : undefined}
        />
      </div>
    </div>
  );
}
