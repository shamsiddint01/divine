import { useEffect, useState } from 'react';

/** Qiymatni kechiktirib qaytaradi (qidiruvda har bir harfga so'rov yubormaslik uchun). */
export function useDebouncedValue<T>(value: T, delayMs = 300): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const timer = setTimeout(() => setDebounced(value), delayMs);
    return () => clearTimeout(timer);
  }, [value, delayMs]);
  return debounced;
}
