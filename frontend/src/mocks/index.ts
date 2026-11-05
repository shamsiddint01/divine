import { configureZodUzbek } from '@divine/shared';
import type { RequestOptions } from '@/shared/lib/api-client';
import { markDirty, persist } from './db';
import './handlers/admin';
import './handlers/auth';
import './handlers/analytics';
import './handlers/audit';
import './handlers/catalog';
import './handlers/credits';
import './handlers/operations';
import './handlers/sales';
import './handlers/warehouses';
import { fail, matchRoute } from './lib/http';

// Brauzer ichidagi mock API. `apiRequest` mock rejimda shu funksiyani chaqiradi.
// Javoblar va xatolar real backend contract'i bilan bir xil (docs/API.md).

// Mock handler'lar shared sxemalar bilan tekshiradi — xatolar backend kabi o'zbekcha bo'lsin.
configureZodUzbek();

let latency: [number, number] = [120, 380];

/** Testlar uchun kechikishni o'chirish: setMockLatency(0, 0). */
export function setMockLatency(min: number, max: number): void {
  latency = [min, max];
}

const sleep = (ms: number, signal?: AbortSignal) =>
  new Promise<void>((resolve, reject) => {
    if (ms <= 0) return resolve();
    const timer = setTimeout(resolve, ms);
    signal?.addEventListener('abort', () => {
      clearTimeout(timer);
      reject(new DOMException('Aborted', 'AbortError'));
    });
  });

export async function mockRequest<T>(path: string, options: RequestOptions = {}): Promise<T> {
  const { method = 'GET', body, query = {}, headers = {}, signal } = options;
  await sleep(latency[0] + Math.random() * (latency[1] - latency[0]), signal);

  const [pathname = '', search = ''] = path.split('?');
  const matched = matchRoute(method, pathname);
  if (!matched) fail(404, 'NOT_FOUND');

  const mergedQuery: Record<string, string | undefined> = Object.fromEntries(
    new URLSearchParams(search),
  );
  for (const [k, v] of Object.entries(query)) {
    if (v !== undefined && v !== null && v !== '') mergedQuery[k] = String(v);
  }
  const lowerHeaders = Object.fromEntries(
    Object.entries(headers).map(([k, v]) => [k.toLowerCase(), v]),
  );

  // JSON orqali o'tkazish: UI mock holatini bevosita o'zgartira olmaydi (haqiqiy tarmoq kabi).
  const payload = body === undefined ? undefined : JSON.parse(JSON.stringify(body));
  const result = matched.route.handler({
    params: matched.params,
    query: mergedQuery,
    body: payload,
    headers: lowerHeaders,
  });
  // Demo'ni tiklash — foydalanuvchi o'zgarishi emas.
  if (matched.route.mutates) {
    // Demo'ni tiklash va sessiya (login/logout) — foydalanuvchi ma'lumoti o'zgarishi emas:
    // demo kunlik qayta yaratilishda davom etadi.
    if (pathname === '/__demo/reset' || pathname.startsWith('/auth/')) persist();
    else markDirty();
  }
  return (result === undefined ? undefined : JSON.parse(JSON.stringify(result))) as T;
}
