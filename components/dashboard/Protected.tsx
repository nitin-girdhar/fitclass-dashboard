'use client';

/**
 * UX-only permission wrapper.
 *
 *   <Protected user={user} roles={['admin']}>
 *     <DeleteAllUsersButton />
 *   </Protected>
 *
 *   <Protected user={user} minRole="manager" fallback={<UpgradeHint />}>
 *     <AssignDialog />
 *   </Protected>
 *
 * SECURITY NOTE: this component HIDES UI; it does not AUTHORISE. A user with
 * DevTools can re-mount any subtree. The server action / API behind the
 * hidden control MUST re-check authorization (src/lib/permissions/server.ts
 * for pages, src/lib/auth/session.ts + predicates for APIs).
 */
import type { ReactNode } from 'react';
import type { SessionUser, UserRole } from '@/src/types/auth';
import { hasMinimumRole } from '@/src/lib/permissions';

interface Props {
  user: SessionUser | null;
  /** Allow-list of exact roles. Combined with `minRole` if both supplied. */
  roles?: readonly UserRole[];
  /** Hierarchical floor (uses ROLE_RANK). */
  minRole?: UserRole;
  /** What to render when the user doesn't qualify. Defaults to nothing. */
  fallback?: ReactNode;
  children: ReactNode;
}

export default function Protected({
  user,
  roles,
  minRole,
  fallback = null,
  children,
}: Props) {
  if (!user) return <>{fallback}</>;
  const allowedByList = roles ? roles.includes(user.role) : true;
  const allowedByMin = minRole ? hasMinimumRole(user, minRole) : true;
  if (!allowedByList || !allowedByMin) return <>{fallback}</>;
  return <>{children}</>;
}
