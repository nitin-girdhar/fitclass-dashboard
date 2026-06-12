/**
 * /dashboard/team — manager+ placeholder.
 */
import { requireMinimumRole } from '@/src/lib/permissions/server';
import Placeholder from '@/components/dashboard/Placeholder';

export const dynamic = 'force-dynamic';

export default async function TeamPage() {
  await requireMinimumRole('manager');
  return (
    <Placeholder
      title="Team"
      body="Members of your branch and their current pipeline load. Lands in Phase 2E alongside the assignments UI."
    />
  );
}
