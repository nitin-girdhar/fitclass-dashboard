'use client';

/**
 * <select> for picking the assignee from a list of active users.
 *
 * Server-side authorization re-checks (see /api/assignments) — this list is
 * pre-filtered for UX (showing only plausible candidates) but anyone could
 * `curl` an assignment to any active user id; the server rejects mismatched
 * branch scope with a 403.
 */
import type { SessionUser } from '@/src/types/auth';

interface Props {
  id: string;
  value: string;
  onChange: (userId: string) => void;
  users: SessionUser[];
  disabled?: boolean;
  label?: string;
}

export default function AssignmentSelector({
  id,
  value,
  onChange,
  users,
  disabled,
  label = 'Assignee',
}: Props) {
  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor={id} className="text-xs font-semibold text-[#0F172A]">
        {label}
      </label>
      <select
        id={id}
        value={value}
        disabled={disabled}
        onChange={(e) => onChange(e.target.value)}
        className="rounded-xl border border-[#E2E8F0] bg-white px-3 py-2.5 text-sm text-[#0F172A] shadow-sm focus:border-[#0b6cbf] focus:outline-none focus:ring-2 focus:ring-[#0b6cbf]/20 disabled:cursor-not-allowed disabled:bg-[#F8FAFC]"
      >
        <option value="" disabled>
          Select a user…
        </option>
        {users.map((u) => (
          <option key={u.id} value={u.id}>
            {u.name ? `${u.name} (${u.email})` : u.email} · {u.role}
          </option>
        ))}
      </select>
    </div>
  );
}
