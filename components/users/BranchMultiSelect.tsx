'use client';

/**
 * Combobox-style branch picker for the admin user-management surface.
 *
 * ── Data contract ────────────────────────────────────────────────────────────
 *  The caller provides `branches`, `loading`, and `error` — typically from
 *  `useAllBranches()`. This component is pure UI: it never fetches, which
 *  allows the parent to share one fetch across multiple pickers or to cache
 *  the result across route navigations.
 *
 * ── Why exact-string matching matters ────────────────────────────────────────
 *  Branch enforcement in `canAccessLeadBranch` uses strict equality. A typo
 *  or case mismatch silently denies a user access to every lead in that
 *  branch. Selecting from the canonical list (not free-text input) is the
 *  only safe UX.
 */
import { useMemo } from 'react';
import { useDropdown } from '@/hooks/useDropdown';

interface Props {
  id: string;
  value: string[];
  onChange: (next: string[]) => void;
  /** Canonical branch list — provide via useAllBranches() in the parent. */
  branches: string[];
  loading?: boolean;
  error?: string | null;
  disabled?: boolean;
  label?: string;
  helperText?: string;
}

export default function BranchMultiSelect({
  id,
  value,
  onChange,
  branches,
  loading = false,
  error = null,
  disabled,
  label = 'Allowed branches',
  helperText = 'Leave empty to grant access to all branches.',
}: Props) {
  const { open, setOpen, search, setSearch, rootRef, searchInputRef } = useDropdown();

  const options = useMemo(() => {
    const selected = new Set(value);
    const q = search.trim().toLowerCase();
    return branches
      .filter((b) => !selected.has(b))
      .filter((b) => (q ? b.toLowerCase().includes(q) : true));
  }, [branches, value, search]);

  const add = (branch: string) => {
    if (value.includes(branch)) return;
    onChange([...value, branch]);
    setSearch('');
    searchInputRef.current?.focus();
  };

  const remove = (branch: string) => {
    onChange(value.filter((b) => b !== branch));
  };

  return (
    <div ref={rootRef} className="relative flex flex-col gap-1.5">
      <label htmlFor={id} className="text-xs font-semibold text-[#0F172A]">
        {label}
      </label>

      {/* Display + opener */}
      <button
        type="button"
        id={id}
        onClick={() => { if (!disabled) setOpen((v) => !v); }}
        disabled={disabled}
        aria-haspopup="listbox"
        aria-expanded={open}
        className="flex min-h-[42px] w-full flex-wrap items-center gap-1.5 rounded-xl border border-[#E2E8F0] bg-white p-2 text-left shadow-sm transition-colors focus:border-[#0b6cbf] focus:outline-none focus:ring-2 focus:ring-[#0b6cbf]/20 disabled:cursor-not-allowed disabled:bg-[#F8FAFC] aria-expanded:border-[#0b6cbf] aria-expanded:ring-2 aria-expanded:ring-[#0b6cbf]/20"
      >
        {value.map((b) => (
          <span
            key={b}
            className="flex items-center gap-1 rounded-full border border-[#BFDBFE] bg-[#EFF6FF] px-2 py-0.5 text-xs font-semibold text-[#0b6cbf]"
          >
            {b}
            {!disabled && (
              <span
                role="button"
                tabIndex={-1}
                onClick={(e) => { e.stopPropagation(); remove(b); }}
                aria-label={`Remove ${b}`}
                className="ml-0.5 cursor-pointer text-[#0b6cbf]/70 hover:text-[#0b6cbf]"
              >
                ×
              </span>
            )}
          </span>
        ))}
        <span className="px-1 text-sm text-[#94A3B8]">
          {value.length === 0 ? 'Click to add branches' : 'Add more…'}
        </span>
      </button>

      {/* Dropdown */}
      {open && (
        <div
          role="listbox"
          className="absolute top-full z-50 mt-1 w-full overflow-hidden rounded-xl border border-[#E2E8F0] bg-white shadow-lg"
        >
          <div className="border-b border-[#F1F5F9] p-2">
            <input
              ref={searchInputRef}
              type="search"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search branches…"
              className="w-full rounded-lg border border-[#E2E8F0] bg-white px-3 py-1.5 text-sm text-[#0F172A] focus:border-[#0b6cbf] focus:outline-none focus:ring-2 focus:ring-[#0b6cbf]/20"
            />
          </div>

          <div className="max-h-64 overflow-y-auto">
            {loading && (
              <div className="px-4 py-6 text-center text-xs text-[#64748B]">Loading branches…</div>
            )}
            {!loading && error && (
              <div className="px-4 py-6 text-center text-xs text-red-600">{error}</div>
            )}
            {!loading && !error && branches.length === 0 && (
              <div className="px-4 py-6 text-center text-xs text-[#64748B]">No branches found.</div>
            )}
            {!loading && !error && branches.length > 0 && options.length === 0 && (
              <div className="px-4 py-6 text-center text-xs text-[#64748B]">
                {search ? `No branches match "${search}".` : 'All branches already selected.'}
              </div>
            )}
            {!loading && !error && options.map((branch) => (
              <button
                key={branch}
                type="button"
                role="option"
                aria-selected={false}
                onClick={() => add(branch)}
                className="flex w-full items-center justify-between px-3 py-2 text-left text-sm text-[#0F172A] transition-colors hover:bg-[#F8FAFC]"
              >
                <span className="truncate">{branch}</span>
                <span className="text-[10px] font-semibold uppercase tracking-wide text-[#0b6cbf]">
                  Add
                </span>
              </button>
            ))}
          </div>
        </div>
      )}

      {helperText && (
        <p className="text-[11px] text-[#64748B]">{helperText}</p>
      )}
    </div>
  );
}
