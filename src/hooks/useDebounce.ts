import { useEffect, useState } from 'react';

/**
 * ✨ Debounce une valeur avec un délai configurable.
 * Utilisé sur toutes les pages de recherche pour éviter les re-renders / appels API
 * à chaque frappe clavier.
 *
 * @param value  La valeur à débouncer
 * @param delay  Délai en ms (défaut: 250 — bon compromis réactivité / performance)
 */
export function useDebounce<T>(value: T, delay = 250): T {
  const [debouncedValue, setDebouncedValue] = useState<T>(value);

  useEffect(() => {
    const timer = setTimeout(() => setDebouncedValue(value), delay);
    return () => clearTimeout(timer);
  }, [value, delay]);

  return debouncedValue;
}
