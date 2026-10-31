import { useCallback, useSyncExternalStore } from 'react';

/** CSS media so'rovi hozir mos keladimi (oyna o'lchami o'zgarganda qayta render qiladi). */
export function useMediaQuery(query: string): boolean {
  const subscribe = useCallback(
    (onChange: () => void) => {
      const list = window.matchMedia(query);
      list.addEventListener('change', onChange);
      return () => list.removeEventListener('change', onChange);
    },
    [query],
  );
  return useSyncExternalStore(
    subscribe,
    () => window.matchMedia(query).matches,
    () => false,
  );
}

/** Tailwind `sm` (640px) dan kichik ekran — telefon. */
export const PHONE_QUERY = '(max-width: 639.98px)';
