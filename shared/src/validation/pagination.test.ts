import { beforeAll, describe, expect, it } from 'vitest';
import { configureZodUzbek } from './error-map.js';
import { VALIDATION_MESSAGES_UZ as M } from './messages.uz.js';
import { buildPaginationMeta, createSortSchema, paginationQuerySchema } from './pagination.js';

beforeAll(() => configureZodUzbek());

describe('paginationQuerySchema (REQ-091)', () => {
  it('standart qiymatlarni beradi', () => {
    expect(paginationQuerySchema.parse({})).toEqual({ page: 1, pageSize: 20 });
  });

  it('query string qiymatlarini songa aylantiradi', () => {
    expect(paginationQuerySchema.parse({ page: '3', pageSize: '50' })).toEqual({
      page: 3,
      pageSize: 50,
    });
  });

  it('pageSize > 100 ni rad etadi', () => {
    const result = paginationQuerySchema.safeParse({ pageSize: '500' });
    expect(result.success).toBe(false);
    expect(result.error?.issues[0]?.message).toBe(M.pageSizeTooBig);
  });

  it('page < 1 ni rad etadi', () => {
    expect(paginationQuerySchema.safeParse({ page: '0' }).success).toBe(false);
  });
});

describe('createSortSchema', () => {
  const sortSchema = createSortSchema(['soldAt', 'totalAmount'], {
    field: 'soldAt',
    direction: 'desc',
  });

  it('whitelist maydonni qabul qiladi', () => {
    expect(sortSchema.parse('totalAmount:asc')).toEqual({ field: 'totalAmount', direction: 'asc' });
  });

  it('bo‘sh bo‘lsa standart saralash', () => {
    expect(sortSchema.parse(undefined)).toEqual({ field: 'soldAt', direction: 'desc' });
  });

  it.each(['password:asc', 'soldAt:sideways', 'soldAt;DROP TABLE'])(
    'ruxsat etilmagan saralashni rad etadi: %s',
    (value) => {
      const result = sortSchema.safeParse(value);
      expect(result.success).toBe(false);
      expect(result.error?.issues[0]?.message).toBe(M.invalidSort);
    },
  );
});

describe('buildPaginationMeta', () => {
  it('sahifalar sonini hisoblaydi', () => {
    expect(buildPaginationMeta(1, 20, 41)).toEqual({
      page: 1,
      pageSize: 20,
      total: 41,
      totalPages: 3,
    });
    expect(buildPaginationMeta(1, 20, 0).totalPages).toBe(0);
  });
});
