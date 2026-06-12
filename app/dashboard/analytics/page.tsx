/**
 * /dashboard/analytics — admin-only placeholder. Backend lands in Phase 2E+.
 */
import { requireMinimumRole } from '@/src/lib/permissions/server';
import Placeholder from '@/components/dashboard/Placeholder';

export const dynamic = 'force-dynamic';

export default async function AnalyticsPage() {
  await requireMinimumRole('admin'); // org_admin, admin, tenant_admin, super_admin
  return (
    <Placeholder
      title="Analytics"
      body="Pipeline performance, conversion funnels and branch comparisons will land in Phase 2E once the activities table is feeding the events stream."
    />
  );
}
