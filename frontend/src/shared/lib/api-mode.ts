/**
 * API manbai. `mock` — brauzer ichidagi namunaviy API (src/mocks), backend kerak emas.
 * `http` — haqiqiy backend (/api/v1). Feature kodi ikkala rejimda ham BIR XIL ishlaydi:
 * faqat shu qiymat almashtiriladi (VITE_API_MODE).
 */
export type ApiMode = 'mock' | 'http';

export const apiMode: ApiMode = import.meta.env.VITE_API_MODE === 'http' ? 'http' : 'mock';

/**
 * Backend'da tayyor modullar rejimi (`VITE_AUTH_MODE=http`): login/sessiya (`/auth/*`, Phase 4),
 * userlar (Phase 5), katalog (Phase 6), omborlar va inventar (Phase 7), kirim (Phase 8), mijozlar
 * (Phase 9), sotuvlar (Phase 10), xarajatlar (Phase 11), hisobotlar, dashboard va sozlamalar (Phase 12)
 * va audit jurnali (Phase 13) haqiqiy backend'dan (`BACKEND_READY_PREFIXES`); mock'da faqat `/__demo/reset` qoladi. `VITE_API_MODE=http`
 * bo'lsa hammasi `http`. Nom tarixiy: dastlab faqat auth edi.
 */
export const authMode: ApiMode =
  apiMode === 'http' || import.meta.env.VITE_AUTH_MODE === 'http' ? 'http' : 'mock';

/** `authMode=http` bo'lganda haqiqiy backend'ga boradigan yo'llar (har bir yangi backend moduli bilan kengayadi). */
export const BACKEND_READY_PREFIXES = [
  '/auth/',
  '/users',
  '/products',
  '/product-groups',
  '/warehouses',
  '/inventory',
  '/customers',
  '/sales',
  '/credits',
  '/expenses',
  '/expense-categories',
  '/reports',
  '/dashboard',
  '/settings',
  '/site/',
  '/support',
  '/audit-logs',
] as const;

export const isMockMode = (): boolean => apiMode === 'mock';

/** Boshqa tab mock ma'lumotlarini o'zgartirdi (window event): shu tabdagi query keshi yangilanadi. */
export const MOCK_DB_CHANGED_EVENT = 'divine:mock-db-changed';

/** So'rov qaysi manbaga boradi: backend'da tayyor modullar — `authMode`, qolganlari — `apiMode`. */
export const transportFor = (path: string): ApiMode =>
  BACKEND_READY_PREFIXES.some((prefix) => path === prefix || path.startsWith(prefix))
    ? authMode
    : apiMode;
