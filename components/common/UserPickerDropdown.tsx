'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import type { SessionUser } from '@/src/types/auth';
import { ROLE_LABELS } from '@/src/features/auth/constants';
import { useDismissible } from '@/hooks/useDropdown';

interface Props {
  id?: string;
  value: string;
  onChange: (userId: string) => void;
  users: SessionUser[];
  disabled?: boolean;
  placeholder?: string;
  /** When true an empty option (emptyLabel) is selectable as a real choice. */
  allowEmpty?: boolean;
  emptyLabel?: string;
}

const getRoleLabel = (role: string) =>
  (ROLE_LABELS as Record<string, string>)[role] ?? role;

const userLine = (u: SessionUser) =>
  u.name ? `${u.name} (${u.email})` : u.email;

type Rect = { top: number; left: number; width: number };

export default function UserPickerDropdown({
  id,
  value,
  onChange,
  users,
  disabled,
  placeholder = 'Select a user…',
  allowEmpty = false,
  emptyLabel = '— None —',
}: Props) {
  const btnRef = useRef<HTMLButtonElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState('');
  const [rect, setRect] = useState<Rect | null>(null);

  useDismissible(open, [btnRef, listRef], () => setOpen(false));

  const selected = useMemo(
    () => (value ? (users.find((u) => u.id === value) ?? null) : null),
    [value, users],
  );

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return users;
    return users.filter(
      (u) =>
        (u.name ?? '').toLowerCase().includes(q) ||
        u.email.toLowerCase().includes(q),
    );
  }, [users, search]);

  const openDropdown = () => {
    if (!btnRef.current || disabled) return;
    const r = btnRef.current.getBoundingClientRect();
    const DROPDOWN_H = 280;
    const spaceBelow = window.innerHeight - r.bottom - 4;
    const top =
      spaceBelow >= DROPDOWN_H ? r.bottom + 4 : r.top - DROPDOWN_H - 4;
    setRect({ top: Math.max(4, top), left: r.left, width: r.width });
    setOpen(true);
  };

  useEffect(() => {
    if (open) {
      queueMicrotask(() => searchRef.current?.focus());
    } else {
      setSearch('');
    }
  }, [open]);

  const handleSelect = (id: string) => {
    onChange(id);
    setOpen(false);
  };

  return (
    <>
      <button
        ref={btnRef}
        id={id}
        type="button"
        disabled={disabled}
        onClick={() => (open ? setOpen(false) : openDropdown())}
        aria-haspopup="listbox"
        aria-expanded={open}
        className="flex w-full items-center justify-between gap-2 rounded-xl border border-[#E2E8F0] bg-white px-3 py-2 text-left shadow-sm focus:border-[#0b6cbf] focus:outline-none focus:ring-2 focus:ring-[#0b6cbf]/20 disabled:cursor-not-allowed disabled:bg-[#F8FAFC]"
      >
        <span className="flex min-w-0 flex-col">
          {selected ? (
            <>
              <span className="truncate text-sm text-[#0F172A]">
                {userLine(selected)}
              </span>
              <span className="truncate text-[11px] text-[#64748B]">
                {getRoleLabel(selected.role)}
              </span>
            </>
          ) : allowEmpty && value === '' ? (
            <span className="text-sm text-[#0F172A]">{emptyLabel}</span>
          ) : (
            <span className="text-sm text-[#94A3B8]">{placeholder}</span>
          )}
        </span>
        <svg
          className={`h-4 w-4 shrink-0 text-[#94A3B8] transition-transform ${open ? 'rotate-180' : ''}`}
          fill="none"
          viewBox="0 0 24 24"
          stroke="currentColor"
          strokeWidth={2}
        >
          <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
        </svg>
      </button>

      {open &&
        rect &&
        typeof document !== 'undefined' &&
        createPortal(
          <div
            ref={listRef}
            role="listbox"
            style={{
              position: 'fixed',
              top: rect.top,
              left: rect.left,
              width: rect.width,
              zIndex: 9999,
              maxHeight: 280,
            }}
            className="overflow-hidden rounded-xl border border-[#E2E8F0] bg-white shadow-lg"
          >
            <div className="border-b border-[#F1F5F9] p-2">
              <input
                ref={searchRef}
                type="search"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search…"
                className="w-full rounded-lg border border-[#E2E8F0] px-2.5 py-1.5 text-sm text-[#0F172A] focus:border-[#0b6cbf] focus:outline-none focus:ring-2 focus:ring-[#0b6cbf]/20"
              />
            </div>
            <div className="max-h-[228px] overflow-y-auto">
              {allowEmpty && (
                <button
                  type="button"
                  role="option"
                  aria-selected={value === ''}
                  onClick={() => handleSelect('')}
                  className={`w-full px-3 py-2 text-left text-sm transition-colors hover:bg-[#F8FAFC] ${
                    value === ''
                      ? 'bg-[#EFF6FF] font-medium text-[#0b6cbf]'
                      : 'text-[#0F172A]'
                  }`}
                >
                  {emptyLabel}
                </button>
              )}
              {filtered.length === 0 ? (
                <div className="px-3 py-6 text-center text-xs text-[#64748B]">
                  {search ? `No matches for "${search}"` : 'No users available'}
                </div>
              ) : (
                filtered.map((u) => (
                  <button
                    key={u.id}
                    type="button"
                    role="option"
                    aria-selected={u.id === value}
                    onClick={() => handleSelect(u.id)}
                    className={`w-full px-3 py-2 text-left transition-colors hover:bg-[#F8FAFC] ${
                      u.id === value ? 'bg-[#EFF6FF]' : ''
                    }`}
                  >
                    <span className="block truncate text-sm font-medium text-[#0F172A]">
                      {userLine(u)}
                    </span>
                    <span className="block truncate text-[11px] text-[#64748B]">
                      {getRoleLabel(u.role)}
                    </span>
                  </button>
                ))
              )}
            </div>
          </div>,
          document.body,
        )}
    </>
  );
}
