import { configureZodUzbek } from '@divine/shared';
import { beforeAll, describe, expect, it } from 'vitest';
import { createListQuerySchema, listFilters } from '../../../src/common/query/list-query.js';
import {
  toPaginated,
  toPrismaDateRange,
  toPrismaOrderBy,
  toPrismaPagination,
  toSqlOrderBy,
} from '../../../src/common/query/prisma-query.js';
import { Prisma } from '../../../src/generated/prisma/client.js';

beforeAll(() => configureZodUzbek());

const schema = createListQuerySchema({
  sortFields: ['soldAt', 'totalAmount'],
  defaultSort: { field: 'soldAt', direction: 'desc' },
  filters: { userId: listFilters.id(), ...listFilters.dateRange() },
});

describe('createListQuerySchema', () => {
  it('standart qiymatlar', () => {
    expect(schema.parse({})).toEqual({
      page: 1,
      pageSize: 20,
      sort: { field: 'soldAt', direction: 'desc' },
    });
  });

  it('noma’lum query parametrlari e’tiborga olinmaydi (qat’iy rad etish faqat body uchun)', () => {
    expect(schema.parse({ _: '123' })).not.toHaveProperty('_');
  });
});

describe('Prisma va SQL tarjimasi', () => {
  it('skip/take va bo‘sh ro‘yxat meta', () => {
    expect(toPrismaPagination({ page: 4, pageSize: 25 })).toEqual({ skip: 75, take: 25 });
    expect(toPaginated([], 0, { page: 1, pageSize: 20 }).meta).toEqual({
      page: 1,
      pageSize: 20,
      total: 0,
      totalPages: 0,
    });
  });

  it('orderBy faqat mapping orqali, tie-breaker bilan', () => {
    const orderBy = toPrismaOrderBy<'soldAt' | 'totalAmount', Record<string, string>>(
      { field: 'totalAmount', direction: 'asc' },
      { soldAt: (d) => ({ soldAt: d }), totalAmount: (d) => ({ totalAmount: d }) },
      { id: 'desc' },
    );
    expect(orderBy).toEqual([{ totalAmount: 'asc' }, { id: 'desc' }]);
  });

  it('raw SQL ORDER BY: ustun whitelist fragmentidan, yo‘nalish faqat ASC/DESC literal', () => {
    const sql = toSqlOrderBy<'soldAt' | 'totalAmount'>(
      { field: 'soldAt', direction: 'desc' },
      { soldAt: Prisma.sql`s.sold_at`, totalAmount: Prisma.sql`s.total_amount` },
      Prisma.sql`s.id`,
    );
    expect(sql.sql).toBe('ORDER BY s.sold_at DESC, s.id DESC');
    expect(sql.values).toEqual([]);
  });

  it('sana oralig‘i: berilmasa filtr yo‘q; bitta chegara ham ishlaydi', () => {
    expect(toPrismaDateRange({})).toBeUndefined();
    expect(toPrismaDateRange({ dateTo: '2026-10-08' })).toEqual({
      lt: new Date('2026-10-08T19:00:00.000Z'),
    });
  });
});
