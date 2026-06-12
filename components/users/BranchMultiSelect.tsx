'use client';

/**
 * Combobox-style branch picker for the admin user-management surface.
 *
 * ── Why this REPLACES the free-text BranchSelector ──────────────────────────
 *  The previous chip input accepted any string the admin typed. A typo
 *  ("Indiranagar " with a trailing space, "indiranagar" lowercase, etc.)
 *  silently produced an `allowed_branches` entry that NEVER matched a real
 *  Sheets tab — so `canAccessLeadBranch` would deny access to the user
 *  forever, with no observable error at write time. Branch enforcement
 *  depends on EXACT string equality; the only safe input is one selected
 *  from the canonical list.
 *
 * ── Source of truth ─────────────────────────────────────────────────────────
 *  Branches come from GET /api/branches/all, which unions every Google
 *  Sheets tab across every configured dashboard. The server validates the
 *  user's final selection again at write time (see app/api/users routes)
 *  so even a client that bypasses this picker cannot store invalid branches.
 *
 * ── UX ──────────────────────────────────────────────────────────────────────
 *  - Chips for selected branches, each with `×` to remove.
 *  - Click the input to open a searchable dropdown of UNSELECTED branches.
 *  - Esc / outside-click closes the dropdown.
 *  - Empty selection is valid and labelled "unrestricted" in the helper
 *    text (this matches the `canAccessLeadBranch` rule).
 */
import { useEffect, useMemo, useRef, useState } from 'react';

interface Props {
  id: string;
  value: string[];
  onChange: (next: string[]) => void;
  disabled?: boolean;
  label?: string;
  helperText?: string;
}

export default function BranchMultiSelect({
  id,
  value,
  onChange,
  disabled,
  label = 'Allowed branches',
  helperText = 'Leave empty to grant access to all branches.',
}: Props) {
  const [allBranches, setAllBranches] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState('');
  const rootRef = useRef<HTMLDivElement>(null);
  const searchInputRef = useRef<HTMLInputElement>(null);

  // Load canonical branch list once on mount.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch('/api/branches/all', { cache: 'no-store' });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data = (await res.json()) as { branches?: unknown };
        if (cancelled) return;
        if (!Array.isArray(data.branches)) {
          throw new Error('Malformed response');
        }
        setAllBranches(data.branches.filter((b): b is string => typeof b === 'string'));
        setError(null);
      } catch (err) {
        if (cancelled) return;
        setError(err instanceof Error ? err.message : 'Failed to load branches');
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  // Close on outside-click / Esc.
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setOpen(false);
      }
    };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  // Pull focus into the search input when the dropdown opens.
  useEffect(() => {
    if (open) {
      // microtask so the input exists in the DOM
      queueMicrotask(() => searchInputRef.current?.focus());
    } else {
      setSearch('');
    }
  }, [open]);

  const options = useMemo(() => {
    const selected = new Set(value);
    const q = search.trim().toLowerCase();
    return allBranches
      .filter((b) => !selected.has(b))
      .filter((b) => (q ? b.toLowerCase().includes(q) : true));
  }, [allBranches, value, search]);

  const add = (branch: string) => {
    if (value.includes(branch)) return; // de-dupe guard
    onChange([...value, branch]);
    setSearch('');
    // Keep the dropdown open for fast multi-select.
    searchInputRef.current?.focus();
  };

  const remove = (branch: string) => {
    onChange(value.filter((b) => b !== branch));
  };

  const openIfPossible = () => {
    if (!disabled) setOpen(true);
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
        onClick={openIfPossible}
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
                onClick={(e) => {
                  // Prevent the parent button's onClick (open dropdown) from firing.
                  e.stopPropagation();
                  remove(b);
                }}
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
              <div className="px-4 py-6 text-center text-xs text-[#64748B]">
                Loading branches…
              </div>
            )}

            {!loading && error && (
              <div className="px-4 py-6 text-center text-xs text-red-600">
                {error}
              </div>
            )}

            {!loading && !error && allBranches.length === 0 && (
              <div className="px-4 py-6 text-center text-xs text-[#64748B]">
                No branches found.
              </div>
            )}

            {!loading && !error && allBranches.length > 0 && options.length === 0 && (
              <div className="px-4 py-6 text-center text-xs text-[#64748B]">
                {search
                  ? `No branches match "${search}".`
                  : 'All branches already selected.'}
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
