import {
  type ApiErrorDetail,
  ERROR_MESSAGES_UZ,
  type ErrorCode,
  buildPaginationMeta,
  zodIssuesToDetails,
} from '@divine/shared';
import type { z } from 'zod';
import { ApiError } from '@/shared/lib/api-client';
import type { Paginated } from '@/shared/types/api';

export type Query = Record<string, string | undefined>;

export interface MockContext {
  params: Record<string, string>;
  query: Query;
  body: unknown;
  headers: Record<string, string>;
}

export type MockHandler = (ctx: MockContext) => unknown;

interface Route {
  method: string;
  pattern: RegExp;
  keys: string[];
  handler: MockHandler;
  mutates: boolean;
}

const routes: Route[] = [];

/** `/products/:id/summary` kabi yo'lni ro'yxatdan o'tkazadi. */
export function route(method: string, path: string, handler: MockHandler): void {
  const keys: string[] = [];
  const pattern = new RegExp(
    `^${path.replace(/:([A-Za-z]+)/g, (_, key: string) => {
      keys.push(key);
      return '([^/]+)';
    })}$`,
  );
  routes.push({ method, pattern, keys, handler, mutates: method !== 'GET' });
}

export function matchRoute(method: string, path: string) {
  for (const r of routes) {
    if (r.method !== method) continue;
    const m = r.pattern.exec(path);
    if (!m) continue;
    const params = Object.fromEntries(
      r.keys.map((k, i) => [k, decodeURIComponent(m[i + 1] ?? '')]),
    );
    return { route: r, params };
  }
  return null;
}

/** Server bilan bir xil xato: `{ code, message (uz), details }`. */
export function fail(
  status: number,
  code: ErrorCode,
  details: ApiErrorDetail[] = [],
  message?: string,
): never {
  throw new ApiError(status, code, message ?? ERROR_MESSAGES_UZ[code], details);
}

export const notFound = (): never => fail(404, 'NOT_FOUND');

/** Body'ni shared Zod sxemasi bilan tekshiradi — xuddi backenddagi ZodValidationPipe kabi. */
export function validate<S extends z.ZodType>(schema: S, body: unknown): z.infer<S> {
  const result = schema.safeParse(body);
  if (!result.success) fail(400, 'VALIDATION_ERROR', zodIssuesToDetails(result.error));
  return result.data as z.infer<S>;
}

export function paginate<T>(items: readonly T[], query: Query): Paginated<T> {
  const page = Math.max(1, Number(query.page ?? 1) || 1);
  const pageSize = Math.min(100, Math.max(1, Number(query.pageSize ?? 20) || 20));
  const start = (page - 1) * pageSize;
  return {
    data: items.slice(start, start + pageSize),
    meta: buildPaginationMeta(page, pageSize, items.length),
  };
}

type SortValue = string | number | null | undefined;

/** `?sort=field:desc` — faqat whitelist'dagi maydonlar (backend'dagi createSortSchema kabi). */
export function sortBy<T>(
  items: T[],
  sort: string | undefined,
  accessors: Record<string, (item: T) => SortValue>,
  fallback: string,
): T[] {
  const [field = '', dir = 'asc'] = (sort || fallback).split(':');
  const accessor = accessors[field] ?? accessors[fallback.split(':')[0] ?? ''];
  if (!accessor) return items;
  const factor = dir === 'desc' ? -1 : 1;
  return [...items].sort((a, b) => {
    const va = accessor(a);
    const vb = accessor(b);
    if (va === vb) return 0;
    if (va === null || va === undefined) return 1;
    if (vb === null || vb === undefined) return -1;
    if (typeof va === 'number' && typeof vb === 'number') return (va - vb) * factor;
    return String(va).localeCompare(String(vb), 'uz', { numeric: true }) * factor;
  });
}

/** Pul/miqdor stringlarini saralash uchun songa (faqat tartib uchun, hisob-kitob uchun emas). */
export const num = (value: string | null | undefined): number => (value ? Number(value) : 0);

export function includesText(
  haystack: (string | null | undefined)[],
  needle: string | undefined,
): boolean {
  if (!needle) return true;
  const n = needle.trim().toLocaleLowerCase('uz');
  return haystack.some((h) => h?.toLocaleLowerCase('uz').includes(n));
}
