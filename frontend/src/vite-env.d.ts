/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** API manzili (standart: `/api/v1` — dev'da Vite proxy, prod'da Nginx orqali bir origin). */
  readonly VITE_API_BASE_URL?: string;
  /** `mock` — brauzer ichidagi namunaviy API (standart), `http` — haqiqiy backend. */
  readonly VITE_API_MODE?: 'mock' | 'http';
  /**
   * Faqat autentifikatsiya (`/auth/*`) manbai: `mock` (standart) yoki `http` — login, refresh, logout
   * va `me` haqiqiy backend bilan, qolgan sahifalar esa mock ma'lumotda. `VITE_API_MODE=http` bo'lsa,
   * auth ham majburan `http`.
   */
  readonly VITE_AUTH_MODE?: 'mock' | 'http';
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
