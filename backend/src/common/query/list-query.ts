import {
  createSortSchema,
  dateOnlySchema,
  paginationQuerySchema,
  searchQuerySchema,
  uuidSchema,
  VALIDATION_MESSAGES_UZ as M,
  type SortSpec,
} from '@divine/shared';
import { z } from 'zod';

const emptyToUndefined = (value: unknown) =>
  typeof value === 'string' && value.trim() === '' ? undefined : value;

/**
 * Ro'yxat filtrlari uchun qurilish bloklari (API §1.2). Bo'sh qiymat (`?status=`) — filtr yo'q.
 * Biznes modullari o'z filtrlarini shulardan yig'adi:
 *
 * ```ts
 * const listSalesQuery = createListQuerySchema({
 *   sortFields: ['soldAt', 'totalAmount'], defaultSort: { field: 'soldAt', direction: 'desc' },
 *   filters: { search: listFilters.search(), userId: listFilters.id(), ...listFilters.dateRange() },
 * });
 * ```
 */
export const listFilters = {
  /** Nom/shtrix-kod/raqam bo'yicha qidiruv: trim, ≤ 100 belgi. */
  search: () => searchQuerySchema,
  /** Holat kabi enum filtr: faqat ruxsat etilgan qiymatlar. */
  oneOf: <const T extends readonly [string, ...string[]]>(values: T) =>
    z.preprocess(emptyToUndefined, z.enum(values).optional()),
  /** `isActive=true|false` → boolean (boshqa qiymat — 400). */
  boolean: () =>
    z.preprocess(
      emptyToUndefined,
      z
        .enum(['true', 'false'])
        .transform((value) => value === 'true')
        .optional(),
    ),
  /** userId / warehouseId / productId / customerId — UUID. */
  id: () => z.preprocess(emptyToUndefined, uuidSchema.optional()),
  /** `dateFrom` / `dateTo` — Toshkent kunlari, ikkala chegara ham kiradi (`toUtcRange` bilan). */
  dateRange: () => ({
    dateFrom: z.preprocess(emptyToUndefined, dateOnlySchema.optional()),
    dateTo: z.preprocess(emptyToUndefined, dateOnlySchema.optional()),
  }),
};

export interface ListQuerySchemaOptions<F extends string, S extends z.ZodRawShape> {
  /** Saralash whitelist'i: faqat shu maydonlar qabul qilinadi (SECURITY §11). */
  sortFields: readonly [F, ...F[]];
  defaultSort: SortSpec<F>;
  filters?: S;
}

/**
 * `page`, `pageSize`, `sort` + endpoint filtrlari. Noma'lum query parametrlari e'tiborga olinmaydi
 * (API §1.1: qat'iy rad etish faqat body uchun). `dateFrom > dateTo` — validatsiya xatosi.
 */
export function createListQuerySchema<
  F extends string,
  S extends z.ZodRawShape = Record<never, never>,
>(options: ListQuerySchemaOptions<F, S>) {
  return paginationQuerySchema
    .extend({
      sort: createSortSchema(options.sortFields, options.defaultSort),
      ...((options.filters ?? {}) as S),
    })
    .superRefine((query, ctx) => {
      const { dateFrom, dateTo } = query as { dateFrom?: unknown; dateTo?: unknown };
      if (typeof dateFrom === 'string' && typeof dateTo === 'string' && dateFrom > dateTo) {
        ctx.addIssue({ code: 'custom', path: ['dateTo'], message: M.dateRangeOrder });
      }
    });
}
