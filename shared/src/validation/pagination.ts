import { z } from 'zod';
import { PAGINATION_DEFAULT_PAGE_SIZE, PAGINATION_MAX_PAGE_SIZE } from '../constants/index.js';
import { VALIDATION_MESSAGES_UZ as M } from './messages.uz.js';

/** Server-side pagination query (REQ-091): `?page=1&pageSize=20`. */
export const paginationQuerySchema = z.object({
  page: z.coerce
    .number({ error: M.mustBeInteger })
    .int({ error: M.mustBeInteger })
    .min(1)
    .default(1),
  pageSize: z.coerce
    .number({ error: M.mustBeInteger })
    .int({ error: M.mustBeInteger })
    .min(1)
    .max(PAGINATION_MAX_PAGE_SIZE, { error: M.pageSizeTooBig })
    .default(PAGINATION_DEFAULT_PAGE_SIZE),
});

export type PaginationQuery = z.infer<typeof paginationQuerySchema>;

export type SortDirection = 'asc' | 'desc';

export interface SortSpec<F extends string> {
  field: F;
  direction: SortDirection;
}

/**
 * `?sort=soldAt:desc` parametri uchun sxema. Faqat whitelist'dagi maydonlar ruxsat etiladi —
 * bu ixtiyoriy ustun bo'yicha ORDER BY (SQL injection / indekssiz saralash) oldini oladi.
 */
export function createSortSchema<const F extends string>(
  allowedFields: readonly [F, ...F[]],
  defaultSort: SortSpec<F>,
) {
  return z
    .string()
    .optional()
    .transform((value, ctx): SortSpec<F> => {
      if (value === undefined || value.trim() === '') return defaultSort;
      const [field, direction = 'asc'] = value.split(':');
      if (!allowedFields.includes(field as F) || (direction !== 'asc' && direction !== 'desc')) {
        ctx.issues.push({ code: 'custom', message: M.invalidSort, input: value });
        return z.NEVER;
      }
      return { field: field as F, direction };
    });
}

export interface PaginationMeta {
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
}

/** Ro'yxat endpointlarining yagona javob shakli. */
export interface Paginated<T> {
  data: T[];
  meta: PaginationMeta;
}

export function buildPaginationMeta(page: number, pageSize: number, total: number): PaginationMeta {
  return { page, pageSize, total, totalPages: total === 0 ? 0 : Math.ceil(total / pageSize) };
}
