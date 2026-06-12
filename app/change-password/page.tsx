/**
 * /change-password — self-service password change.
 *
 * Reachable by any authenticated user. Two entry paths:
 *   - Voluntary: a user picks "change password" (future nav entry).
 *   - Forced: the dashboard layout redirects here when
 *     `force_password_change` is set (admin reset / new account). They cannot
 *     reach the dashboard until they complete this form.
 *
 * Lives OUTSIDE /dashboard so the forced-change redirect can't loop. Auth is
 * enforced here directly (middleware does not gate this path).
 */
import { redirect } from 'next/navigation';
import { getSessionFromRequest } from '@/src/lib/auth/session';
import ChangePasswordForm from '@/components/auth/ChangePasswordForm';

export const dynamic = 'force-dynamic';

export default async function ChangePasswordPage() {
  const session = await getSessionFromRequest();
  if (!session) {
    redirect('/login?callbackUrl=%2Fchange-password');
  }

  return (
    <div className="flex min-h-screen w-full items-center justify-center bg-[#F8FAFC] px-4 py-12">
      <div className="w-full max-w-sm">
        <header className="mb-6 text-center">
          <h1 className="text-xl font-bold tracking-tight text-[#0F172A]">
            {session.force_password_change ? 'Set a new password' : 'Change password'}
          </h1>
          <p className="mt-1 text-sm text-[#64748B]">
            {session.force_password_change
              ? 'Your password was reset by an administrator. Choose a new one to continue.'
              : 'Update the password for your account.'}
          </p>
        </header>
        <ChangePasswordForm forced={session.force_password_change} />
      </div>
    </div>
  );
}
