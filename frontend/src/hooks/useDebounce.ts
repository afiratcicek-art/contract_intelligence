/**
 * useDebounce — shared debounce hook (S-03 fix)
 * Replaces 4 duplicate setTimeout(400ms) patterns across:
 *   Workspace.tsx (x3), DocumentsModule.tsx (x1)
 *
 * Usage:
 *   const debouncedQuery = useDebounce(query, 400);
 */
import { useState, useEffect } from "react";

export function useDebounce<T>(value: T, delay: number): T {
  const [debounced, setDebounced] = useState<T>(value);
  useEffect(() => {
    const timer = setTimeout(() => setDebounced(value), delay);
    return () => clearTimeout(timer);
  }, [value, delay]);
  return debounced;
}
