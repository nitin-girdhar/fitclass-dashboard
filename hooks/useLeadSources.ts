'use client';

import { useEffect, useState } from 'react';

export function useLeadSources() {
  const [sources, setSources]   = useState<string[]>([]);
  const [loading, setLoading]   = useState(true);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    fetch('/api/lead-sources', { cache: 'no-store' })
      .then((r) => r.json())
      .then((data: string[]) => { if (!cancelled) setSources(Array.isArray(data) ? data : []); })
      .catch(() => {})
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, []);

  return { sources, loading };
}
