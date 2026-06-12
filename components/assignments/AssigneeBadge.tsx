/**
 * Small chip showing the current owner of a lead. Server-renderable.
 *
 * Accepts a MINIMAL display shape (`{ name, email }`) instead of the full
 * `SessionUser` — callers can pass either. The narrower contract means
 * any place that has just a name+email pair (e.g. the new
 * `assignee_name`/`assignee_email` fields on `AssignmentView` after
 * Phase 2U) can render the badge directly, without first having to look
 * the user up in a candidate list.
 */

interface AssigneeLike {
  name: string | null;
  email: string;
}

interface Props {
  user: AssigneeLike | null;
  className?: string;
}

export default function AssigneeBadge({ user, className = '' }: Props) {
  if (!user) {
    return (
      <span
        className={`inline-flex items-center gap-1.5 rounded-full border border-slate-200 bg-slate-50 px-2 py-0.5 text-[11px] font-semibold text-slate-500 ${className}`.trim()}
      >
        <span className="h-1.5 w-1.5 rounded-full bg-slate-400" />
        Unassigned
      </span>
    );
  }

  const label = user.name ?? user.email;
  const initial = label.charAt(0).toUpperCase();

  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full border border-[#BFDBFE] bg-[#EFF6FF] px-2 py-0.5 text-[11px] font-semibold text-[#0b6cbf] ${className}`.trim()}
      title={user.email}
    >
      <span className="flex h-4 w-4 items-center justify-center rounded-full bg-[#0b6cbf] text-[9px] font-bold text-white">
        {initial}
      </span>
      <span className="max-w-[140px] truncate">{label}</span>
    </span>
  );
}
