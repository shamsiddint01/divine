import {
  type ApiErrorDetail,
  ERROR_MESSAGES_UZ,
  ErrorCode,
  isApiErrorBody,
  type LoginResponse,
} from '@divine/shared';
import { t } from '@/i18n/uz';
import { transportFor } from './api-mode';
import { authSession } from './auth-session';

const BASE_URL = import.meta.env.VITE_API_BASE_URL ?? '/api/v1';

/** Frontend'dagi barcha API xatolari shu klass orqali keladi — UI faqat `message` (o'zbekcha) ni ko'rsatadi. */
export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: ErrorCode | 'NETWORK_ERROR',
    message: string,
    readonly details: ApiErrorDetail[] = [],
    readonly requestId?: string,
    /** `Retry-After` header (soniya): 423 lock va 429 rate limit uchun. */
    readonly retryAfterSeconds?: number,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

export type QueryValue = string | number | boolean | null | undefined;

export interface RequestOptions {
  method?: 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE';
  body?: unknown;
  query?: Record<string, QueryValue>;
  headers?: Record<string, string>;
  signal?: AbortSignal;
  /** Xato hisoblanmaydigan qo'shimcha status kodlar (masalan, /health uchun 503). */
  acceptStatuses?: number[];
}

/** `{ page: 2, search: '' }` → `?page=2` (bo'sh qiymatlar tashlab yuboriladi) */
export function buildQueryString(query: Record<string, QueryValue> = {}): string {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(query)) {
    if (value === undefined || value === null || value === '') continue;
    params.set(key, String(value));
  }
  const qs = params.toString();
  return qs ? `?${qs}` : '';
}

async function httpRequest<T>(path: string, options: RequestOptions): Promise<T> {
  const { method = 'GET', body, headers = {}, signal, acceptStatuses = [], query } = options;

  let response: Response;
  try {
    response = await fetch(`${BASE_URL}${path}${buildQueryString(query)}`, {
      method,
      signal,
      // Refresh cookie (`Path=/api/v1/auth`, HttpOnly) faqat auth so'rovlarida brauzer tomonidan yuboriladi.
      credentials: 'include',
      headers: {
        Accept: 'application/json',
        // CSRF (SECURITY §9): cookie endpointlari shu header'ni talab qiladi.
        'X-Requested-With': 'XMLHttpRequest',
        ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
        ...headers,
      },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
  } catch (error) {
    if (error instanceof DOMException && error.name === 'AbortError') throw error;
    throw new ApiError(0, 'NETWORK_ERROR', t.errors.network);
  }

  const payload: unknown =
    response.status === 204 ? undefined : await response.json().catch(() => undefined);

  if (response.ok || acceptStatuses.includes(response.status)) return payload as T;

  // `headers` har doim bor (Fetch API), lekin minimal mock javoblarda ham ishlashi uchun ehtiyotkor o'qish.
  const retryAfter = Number(response.headers?.get?.('Retry-After'));
  const retryAfterSeconds = Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter : undefined;
  if (isApiErrorBody(payload)) {
    const { code, message, details, requestId } = payload.error;
    throw new ApiError(response.status, code, message, details ?? [], requestId, retryAfterSeconds);
  }
  const fallbackCode = response.status >= 500 ? ErrorCode.INTERNAL_ERROR : ErrorCode.BAD_REQUEST;
  throw new ApiError(response.status, fallbackCode, ERROR_MESSAGES_UZ[fallbackCode]);
}

/** Bu endpointlar tokenni o'zi boshqaradi — ularda 401 → refresh → qayta urinish qilinmaydi. */
const SESSION_ENDPOINTS = new Set(['/auth/login', '/auth/refresh', '/auth/logout']);

let refreshInFlight: Promise<LoginResponse | null> | null = null;

/** Bepul serverda backend uxlaydi: uyg'onguncha refresh qayta uriniladi (sessiya tugadi deb hisoblanmaydi). */
const SERVER_WAKE_LIMIT_MS = 75_000;
const SERVER_WAKE_RETRY_MS = 3_000;

/** Server javob bermadi yoki 5xx: sessiya haqida hech narsa ma'lum emas. */
export function isServerUnavailable(error: unknown): boolean {
  return error instanceof ApiError && (error.code === 'NETWORK_ERROR' || error.status >= 500);
}

async function requestRefresh(): Promise<LoginResponse> {
  const deadline = Date.now() + SERVER_WAKE_LIMIT_MS;
  for (;;) {
    try {
      return await httpRequest<LoginResponse>('/auth/refresh', { method: 'POST' });
    } catch (error) {
      if (!isServerUnavailable(error) || Date.now() >= deadline) throw error;
      await new Promise((resolve) => setTimeout(resolve, SERVER_WAKE_RETRY_MS));
    }
  }
}

/**
 * Refresh cookie bilan yangi access token olish (`null` — sessiya yo'q yoki tugagan; tarmoq xatosi —
 * istisno sifatida uzatiladi). Bir vaqtda kelgan bir nechta 401 uchun BITTA so'rov
 * (single-flight): server qayta ishlatilgan refresh token'ni o'g'irlangan deb hisoblaydi (SECURITY §3).
 */
export function refreshSession(): Promise<LoginResponse | null> {
  refreshInFlight ??= requestRefresh()
    .then((session) => {
      authSession.setToken(session.accessToken);
      return session;
    })
    .catch((error: unknown) => {
      // Server bilan aloqa yo'q — bu "sessiya tugadi" emas: xato uzatiladi (UI "aloqa yo'q" deydi).
      if (isServerUnavailable(error)) throw error;
      authSession.setToken(null);
      return null;
    })
    .finally(() => {
      refreshInFlight = null;
    });
  return refreshInFlight;
}

async function authorizedRequest<T>(
  path: string,
  options: RequestOptions,
  retried = false,
): Promise<T> {
  const token = authSession.getToken();
  const headers =
    token && !SESSION_ENDPOINTS.has(path)
      ? { Authorization: `Bearer ${token}`, ...options.headers }
      : options.headers;
  try {
    return await httpRequest<T>(path, { ...options, headers });
  } catch (error) {
    if (!(error instanceof ApiError) || SESSION_ENDPOINTS.has(path)) throw error;
    if (error.status === 401 && !retried) {
      // Access token muddati tugagan bo'lishi mumkin: bir marta yangilab, so'rov qayta yuboriladi.
      if (await refreshSession()) return authorizedRequest<T>(path, options, true);
      authSession.notifyExpired();
    } else if (error.status === 401) {
      authSession.notifyExpired();
    } else if (error.status === 403 && error.code === ErrorCode.FORBIDDEN) {
      authSession.notifyForbidden();
    }
    throw error;
  }
}

/**
 * Yagona API klient. Feature'lar faqat shu funksiyani chaqiradi.
 * Manba yo'l bo'yicha: backend'da tayyor modullar (`/auth/*`, `/users*`) — `VITE_AUTH_MODE`,
 * qolganlari — `VITE_API_MODE` (`transportFor`).
 * Mock rejimda so'rov brauzer ichidagi mock router'ga yo'naltiriladi (lazy import — http rejimda mock
 * kodi bundle'ga umuman yuklanmaydi). Javob va xato shakli bir xil.
 */
export async function apiRequest<T>(path: string, options: RequestOptions = {}): Promise<T> {
  if (transportFor(path) === 'mock') {
    const { mockRequest } = await import('@/mocks');
    return mockRequest<T>(path, options);
  }
  return authorizedRequest<T>(path, options);
}

/** Testlar uchun: http yo'lini to'g'ridan-to'g'ri chaqirish. */
export const __httpRequestForTests = httpRequest;
/** Testlar uchun: token, 401 → refresh → qayta urinish yo'li. */
export const __authorizedRequestForTests = authorizedRequest;
