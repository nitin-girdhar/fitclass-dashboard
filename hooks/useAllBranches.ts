'use client';

import { useEffect, useState } from 'react';

/**
 * Fetches the canonical branch list from GET /api/branches/all.
 *
 * Intended to be called in a parent component and passed down to
 * BranchMultiSelect — one fetch per page, not one per picker instance.
 *
 * Usage:
 *   const { branches, loading, error } = useAllBranches();
 *   <BranchMultiSelect branches={branches} loading={loading} error={error} ... />
 */
export function useAllBranches() {
  const [branches, setBranches] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch('/api/branches/all', { cache: 'no-store' });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data = (await res.json()) as { branches?: unknown };
        if (cancelled) return;
        if (!Array.isArray(data.branches)) throw new Error('Malformed response');
        setBranches(data.branches.filter((b): b is string => typeof b === 'string'));
        setError(null);
      } catch (err) {
        if (cancelled) return;
        setError(err instanceof Error ? err.message : 'Failed to load branches');
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, []);

  return { branches, loading, error };
}
