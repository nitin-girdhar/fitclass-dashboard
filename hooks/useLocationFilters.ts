'use client';

import { useCallback, useEffect, useState } from 'react';

export interface LocationOption {
  id: number;
  name: string;
  isoCode?: string;  // countries only
  countryId?: number; // states only
  stateId?: number;   // cities only
}

interface UseLocationFiltersReturn {
  // Available options (scoped to user's orgs)
  countries: LocationOption[];
  states: LocationOption[];
  cities: LocationOption[];

  // Selected items
  selectedCountries: LocationOption[];
  selectedStates: LocationOption[];
  selectedCities: LocationOption[];

  // Setters — each clears downstream selections automatically
  setSelectedCountries: (next: LocationOption[]) => void;
  setSelectedStates: (next: LocationOption[]) => void;
  setSelectedCities: (next: LocationOption[]) => void;

  loadingCountries: boolean;
  loadingStates: boolean;
  loadingCities: boolean;
}

export function useLocationFilters(): UseLocationFiltersReturn {
  const [countries, setCountries] = useState<LocationOption[]>([]);
  const [states, setStates]       = useState<LocationOption[]>([]);
  const [cities, setCities]       = useState<LocationOption[]>([]);

  const [selectedCountries, _setSelectedCountries] = useState<LocationOption[]>([]);
  const [selectedStates, _setSelectedStates]       = useState<LocationOption[]>([]);
  const [selectedCities, _setSelectedCities]       = useState<LocationOption[]>([]);

  const [loadingCountries, setLoadingCountries] = useState(false);
  const [loadingStates, setLoadingStates]       = useState(false);
  const [loadingCities, setLoadingCities]       = useState(false);

  // Fetch countries once on mount
  useEffect(() => {
    let cancelled = false;
    setLoadingCountries(true);
    fetch('/api/locations?level=countries', { cache: 'no-store' })
      .then((r) => r.json())
      .then((data) => { if (!cancelled) setCountries(data); })
      .catch(() => {})
      .finally(() => { if (!cancelled) setLoadingCountries(false); });
    return () => { cancelled = true; };
  }, []);

  // Fetch states when selected countries change
  const countryKey = selectedCountries.map((c) => c.id).join(',');
  useEffect(() => {
    if (!selectedCountries.length) {
      setStates([]);
      return;
    }
    let cancelled = false;
    setLoadingStates(true);
    fetch(`/api/locations?level=states&countryIds=${countryKey}`, { cache: 'no-store' })
      .then((r) => r.json())
      .then((data) => { if (!cancelled) setStates(data); })
      .catch(() => {})
      .finally(() => { if (!cancelled) setLoadingStates(false); });
    return () => { cancelled = true; };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [countryKey]);

  // Fetch cities when selected states change
  const stateKey = selectedStates.map((s) => s.id).join(',');
  useEffect(() => {
    if (!selectedStates.length) {
      setCities([]);
      return;
    }
    let cancelled = false;
    setLoadingCities(true);
    fetch(`/api/locations?level=cities&stateIds=${stateKey}`, { cache: 'no-store' })
      .then((r) => r.json())
      .then((data) => { if (!cancelled) setCities(data); })
      .catch(() => {})
      .finally(() => { if (!cancelled) setLoadingCities(false); });
    return () => { cancelled = true; };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stateKey]);

  const setSelectedCountries = useCallback((next: LocationOption[]) => {
    _setSelectedCountries(next);
    _setSelectedStates([]);
    _setSelectedCities([]);
  }, []);

  const setSelectedStates = useCallback((next: LocationOption[]) => {
    _setSelectedStates(next);
    _setSelectedCities([]);
  }, []);

  const setSelectedCities = useCallback((next: LocationOption[]) => {
    _setSelectedCities(next);
  }, []);

  return {
    countries, states, cities,
    selectedCountries, selectedStates, selectedCities,
    setSelectedCountries, setSelectedStates, setSelectedCities,
    loadingCountries, loadingStates, loadingCities,
  };
}
