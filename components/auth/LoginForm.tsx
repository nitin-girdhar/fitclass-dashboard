'use client';

/**
 * Email/password sign-in form for the FitClass CRM.
 *
 *  - Validates client-side with the shared `loginSchema` so the rules cannot
 *    drift from the server (which uses the same schema).
 *  - Submits as JSON to POST /api/auth/login. On 200, the server has set the
 *    HTTP-only fc_session cookie — we just route the user forward and call
 *    router.refresh() so server components pick up the new session.
 *  - The session is NEVER stored client-side (no localStorage, no JS-readable
 *    cookie). The browser sends the HTTP-only cookie automatically on every
 *    subsequent request.
 *  - Accessible: <label htmlFor>, autoComplete hints, aria-describedby for
 *    field errors, aria-busy on the submit button, role="alert" on errors.
 */
import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { loginSchema } from '@/src/lib/validations/auth';

interface Props {
  /** Safe (same-origin) callback path to navigate to after login. */
  callbackUrl: string;
}

interface FieldErrors {
  email?: string;
  password?: string;
}

export default function LoginForm({ callbackUrl }: Props) {
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({});
  const [serverError, setServerError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [pending, startTransition] = useTransition();
  const busy = submitting || pending;

  const handleSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setFieldErrors({});
    setServerError(null);

    const parsed = loginSchema.safeParse({ email, password });
    if (!parsed.success) {
      const next: FieldErrors = {};
      for (const issue of parsed.error.issues) {
        const key = issue.path[0];
        if (key === 'email' && !next.email) next.email = issue.message;
        if (key === 'password' && !next.password) next.password = issue.message;
      }
      setFieldErrors(next);
      return;
    }

    setSubmitting(true);
    try {
      const res = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(parsed.data),
      });

      if (!res.ok) {
        const data = (await res.json().catch(() => null)) as
          | { error?: string }
          | null;
        setServerError(data?.error ?? 'Sign-in failed. Please try again.');
        setSubmitting(false);
        return;
      }

      // Server has set the fc_session HTTP-only cookie. Navigate and refresh
      // so server components pick up the new session on this request cycle.
      startTransition(() => {
        router.replace(callbackUrl);
        router.refresh();
      });
    } catch (err) {
      setServerError(
        err instanceof Error ? err.message : 'Network error. Please try again.',
      );
      setSubmitting(false);
    }
  };

  return (
    <form
      onSubmit={handleSubmit}
      className="flex flex-col gap-5"
      noValidate
    >
      {serverError && (
        <div
          role="alert"
          className="flex items-start gap-2.5 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700"
        >
          <svg
            className="mt-0.5 h-4 w-4 shrink-0"
            viewBox="0 0 20 20"
            fill="currentColor"
            aria-hidden
          >
            <path
              fillRule="evenodd"
              d="M10 18a8 8 0 1 0 0-16 8 8 0 0 0 0 16ZM9 9a1 1 0 0 1 2 0v3a1 1 0 1 1-2 0V9Zm1-4a1 1 0 1 0 0 2 1 1 0 0 0 0-2Z"
              clipRule="evenodd"
            />
          </svg>
          <span>{serverError}</span>
        </div>
      )}

      <Field
        id="email"
        label="Email"
        type="email"
        autoComplete="email"
        value={email}
        onChange={setEmail}
        disabled={busy}
        error={fieldErrors.email}
        required
      />

      <Field
        id="password"
        label="Password"
        type="password"
        autoComplete="current-password"
        value={password}
        onChange={setPassword}
        disabled={busy}
        error={fieldErrors.password}
        required
      />

      <button
        type="submit"
        disabled={busy}
        aria-busy={busy}
        className="mt-2 inline-flex items-center justify-center gap-2 rounded-xl bg-[#0b6cbf] px-5 py-3 text-sm font-semibold text-white shadow-sm transition-all duration-150 hover:bg-[#095699] focus:outline-none focus-visible:ring-2 focus-visible:ring-[#0b6cbf] focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-70"
      >
        {busy ? (
          <>
            <span
              className="h-4 w-4 animate-spin rounded-full border-2 border-white/40 border-t-white"
              aria-hidden
            />
            Signing in…
          </>
        ) : (
          'Sign in'
        )}
      </button>
    </form>
  );
}

interface FieldProps {
  id: string;
  label: string;
  type: 'email' | 'password';
  autoComplete: string;
  value: string;
  onChange: (v: string) => void;
  disabled: boolean;
  error?: string;
  required?: boolean;
}

function Field({
  id,
  label,
  type,
  autoComplete,
  value,
  onChange,
  disabled,
  error,
  required,
}: FieldProps) {
  const errorId = `${id}-error`;
  return (
    <div className="flex flex-col gap-1.5">
      <label
        htmlFor={id}
        className="text-xs font-semibold text-[#0F172A]"
      >
        {label}
      </label>
      <input
        id={id}
        name={id}
        type={type}
        autoComplete={autoComplete}
        required={required}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        disabled={disabled}
        aria-invalid={error ? true : undefined}
        aria-describedby={error ? errorId : undefined}
        className="rounded-xl border border-[#E2E8F0] bg-white px-3.5 py-2.5 text-sm text-[#0F172A] shadow-sm transition-colors placeholder:text-[#94A3B8] focus:border-[#0b6cbf] focus:outline-none focus:ring-2 focus:ring-[#0b6cbf]/20 disabled:cursor-not-allowed disabled:bg-[#F8FAFC] disabled:text-[#64748B] aria-invalid:border-red-300 aria-invalid:focus:border-red-400 aria-invalid:focus:ring-red-200"
      />
      {error && (
        <p id={errorId} className="text-xs text-red-600">
          {error}
        </p>
      )}
    </div>
  );
}
