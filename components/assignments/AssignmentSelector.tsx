'use client';

import type { SessionUser } from '@/src/types/auth';
import UserPickerDropdown from '@/components/common/UserPickerDropdown';

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
  label = 'Assigned To',
}: Props) {
  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor={id} className="text-xs font-semibold text-[#0F172A]">
        {label}
      </label>
      <UserPickerDropdown
        id={id}
        value={value}
        onChange={onChange}
        users={users}
        disabled={disabled}
        placeholder="Select a user…"
      />
    </div>
  );
}
