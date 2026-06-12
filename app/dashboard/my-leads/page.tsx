import { requireSessionPage } from '@/src/lib/permissions/server';
import { listMyAssignments } from '@/src/features/assignments/queries';
import { toAssignmentViews } from '@/src/features/assignments/serializers';
import AssignmentsClient from '@/components/assignments/AssignmentsClient';

export const dynamic = 'force-dynamic';

export default async function MyLeadsPage() {
  const actor = await requireSessionPage('/dashboard/my-leads');

  const rows = await listMyAssignments(actor.id);
  const assignments = toAssignmentViews(rows);

  return (
    <div className="mx-auto w-full max-w-6xl p-4 sm:p-6">
      <AssignmentsClient
        actor={actor}
        assignments={assignments}
        candidates={[]}
        title="My Leads"
        subtitle={`${assignments.length} lead${assignments.length !== 1 ? 's' : ''} assigned to you`}
        hideCreate
      />
    </div>
  );
}
