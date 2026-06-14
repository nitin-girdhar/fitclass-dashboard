'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

/**
 * Low-level hook: attaches outside-click + Esc listeners while `open` is true.
 *
 * Accepts an array of refs so the caller can mark multiple DOM nodes as
 * "inside" — needed for portal dropdowns where the trigger and the floating
 * panel are separate subtrees.
 *
 * The callback ref pattern avoids adding `onClose` to the effect deps, so
 * callers don't need to wrap it in `useCallback`.
 */
export function useDismissible(
  open: boolean,
  refs: React.RefObject<HTMLElement | null>[],
  onClose: () => void,
) {
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;
  // Keep a stable ref to the array so we avoid spreading refs into effect deps.
  const refsRef = useRef(refs);
  refsRef.current = refs;

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      const target = e.target as Node;
      if (refsRef.current.some((r) => r.current?.contains(target))) return;
      onCloseRef.current();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onCloseRef.current();
    };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);
}

/**
 * High-level hook for inline (non-portal) searchable dropdowns.
 *
 * Owns: open/close state, search string, a container ref, and a search input
 * ref. The caller attaches `rootRef` to the outermost container so
 * `useDismissible` can detect outside-clicks correctly.
 *
 * Usage:
 *   const { open, setOpen, search, setSearch, rootRef, searchInputRef } = useDropdown();
 */
export function useDropdown() {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState('');
  const rootRef = useRef<HTMLDivElement>(null);
  const searchInputRef = useRef<HTMLInputElement>(null);

  const close = useCallback(() => setOpen(false), []);
  useDismissible(open, [rootRef], close);

  useEffect(() => {
    if (open) queueMicrotask(() => searchInputRef.current?.focus());
    else setSearch('');
  }, [open]);

  return { open, setOpen, search, setSearch, rootRef, searchInputRef };
}
