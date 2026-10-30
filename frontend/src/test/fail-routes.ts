import { matchRoute } from '@/mocks/lib/http';
import { ApiError } from '@/shared/lib/api-client';

/** Sinov xatosi matni — ErrorState'da aynan shu ko'rinishi tekshiriladi. */
export const FAIL_MESSAGE = 'Sinov: ma’lumot yuklanmadi';

const restore: (() => void)[] = [];

/**
 * Tanlangan mock GET endpoint'lari `409` qaytaradi (4xx — query qayta urinmaydi). Xato holatlarini
 * (REQ-154) sinash uchun; `restoreRoutes()` — asl handler'larni qaytaradi (afterEach'da chaqiring).
 */
export function failRoutes(paths: string[]): void {
  for (const path of paths) {
    const route = matchRoute('GET', path)?.route;
    if (!route) throw new Error(`mock route yo'q: ${path}`);
    const original = route.handler;
    route.handler = () => {
      throw new ApiError(409, 'CONFLICT', FAIL_MESSAGE);
    };
    restore.push(() => (route.handler = original));
  }
}

export function restoreRoutes(): void {
  for (const undo of restore.splice(0).reverse()) undo();
}
