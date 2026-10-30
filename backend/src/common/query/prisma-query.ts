import {
  buildPaginationMeta,
  type Paginated,
  type PaginationQuery,
  type SortDirection,
  type SortSpec,
} from '@divine/shared';
import { Prisma } from '../../generated/prisma/client.js';
import { tashkentDateRangeToUtc } from '../time/tashkent-time.js';

/** `page`/`pageSize` → Prisma `skip`/`take`. */
export function toPrismaPagination({ page, pageSize }: PaginationQuery): {
  skip: number;
  take: number;
} {
  return { skip: (page - 1) * pageSize, take: pageSize };
}

/**
 * Whitelist'dagi API sort maydoni → Prisma `orderBy`. Mapping endpoint kodida yoziladi
 * (`Record<F, …>` — har bir ruxsat etilgan maydon uchun aniq tarjima), client matni hech qachon
 * to'g'ridan-to'g'ri `orderBy`ga tushmaydi. Barqaror sahifalash uchun oxirida tie-breaker (odatda `id`).
 */
export function toPrismaOrderBy<F extends string, O>(
  sort: SortSpec<F>,
  mapping: Readonly<Record<F, (direction: SortDirection) => O>>,
  tieBreaker?: O,
): O[] {
  const primary = mapping[sort.field](sort.direction);
  return tieBreaker === undefined ? [primary] : [primary, tieBreaker];
}

/**
 * Raw SQL (hisobotlar) uchun `ORDER BY`. Ustun fragmentlari dasturchi yozgan `Prisma.sql` (whitelist),
 * yo'nalish faqat `ASC`/`DESC` literal — foydalanuvchi matni SQL'ga qo'shilmaydi.
 */
export function toSqlOrderBy<F extends string>(
  sort: SortSpec<F>,
  columns: Readonly<Record<F, Prisma.Sql>>,
  tieBreaker?: Prisma.Sql,
): Prisma.Sql {
  const direction = Prisma.raw(sort.direction === 'desc' ? 'DESC' : 'ASC');
  const primary = Prisma.sql`${columns[sort.field]} ${direction}`;
  return tieBreaker
    ? Prisma.sql`ORDER BY ${primary}, ${tieBreaker} ${direction}`
    : Prisma.sql`ORDER BY ${primary}`;
}

/** Ro'yxat javobi (API §1.2): `{ data, meta: { page, pageSize, total, totalPages } }`. */
export function toPaginated<T>(data: T[], total: number, query: PaginationQuery): Paginated<T> {
  return { data, meta: buildPaginationMeta(query.page, query.pageSize, total) };
}

/**
 * `dateFrom`/`dateTo` (Toshkent kunlari, ikkalasi ham kiradi) → Prisma `{ gte, lt }` (UTC, yarim ochiq).
 * Berilmagan chegara — cheklovsiz. Hech biri berilmasa — `undefined` (filtr qo'shilmaydi).
 */
export function toPrismaDateRange(range: {
  dateFrom?: string;
  dateTo?: string;
}): { gte?: Date; lt?: Date } | undefined {
  const { from, to } = tashkentDateRangeToUtc(range);
  if (!from && !to) return undefined;
  return { ...(from ? { gte: from } : {}), ...(to ? { lt: to } : {}) };
}
