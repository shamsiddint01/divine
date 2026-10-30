import { describe, expect, it } from 'vitest';
import {
  expenseCategoryCreateSchema,
  expenseCategoryUpdateSchema,
  expenseCreateSchema,
  expenseUpdateSchema,
  isExpenseDateAllowed,
} from './expenses.js';
import { VALIDATION_MESSAGES_UZ as M } from './messages.uz.js';

const CATEGORY = '01990000-0000-7000-8000-000000000001';

describe('xarajat sxemalari (API §12, D-11, D-19, BR-32)', () => {
  it('sana, summa, kategoriya majburiy; izoh trim, bo‘sh izoh → null', () => {
    expect(
      expenseCreateSchema.parse({
        date: '2026-10-20',
        amount: ' 150000.50 ',
        categoryId: CATEGORY,
        note: '  Ijara ',
      }),
    ).toEqual({ date: '2026-10-20', amount: '150000.50', categoryId: CATEGORY, note: 'Ijara' });
    expect(
      expenseCreateSchema.parse({
        date: '2026-10-20',
        amount: '1',
        categoryId: CATEGORY,
        note: ' ',
      }).note,
    ).toBeNull();
  });

  it.each([
    ['kategoriyasiz (D-19)', { date: '2026-10-20', amount: '100' }],
    ['kategoriya UUID emas', { date: '2026-10-20', amount: '100', categoryId: 'ijara' }],
    ['summa 0 (BR-32)', { date: '2026-10-20', amount: '0', categoryId: CATEGORY }],
    ['manfiy summa', { date: '2026-10-20', amount: '-5', categoryId: CATEGORY }],
    ['3 kasrli summa', { date: '2026-10-20', amount: '1.005', categoryId: CATEGORY }],
    ['sana formati', { date: '20.10.2026', amount: '100', categoryId: CATEGORY }],
    ['mavjud bo‘lmagan sana', { date: '2026-02-30', amount: '100', categoryId: CATEGORY }],
    ['holat (D-11)', { date: '2026-10-20', amount: '100', categoryId: CATEGORY, status: 'PAID' }],
    [
      '1000 belgidan uzun izoh',
      { date: '2026-10-20', amount: '1', categoryId: CATEGORY, note: 'x'.repeat(1001) },
    ],
  ])('rad etiladi: %s', (_label, body) => {
    expect(expenseCreateSchema.safeParse(body).success).toBe(false);
  });

  it('kategoriyasiz xato xabari — "Kategoriyani tanlang", maydon `categoryId`', () => {
    const result = expenseCreateSchema.safeParse({ date: '2026-10-20', amount: '1' });
    expect(result.error?.issues).toEqual([
      expect.objectContaining({ path: ['categoryId'], message: M.expenseCategoryRequired }),
    ]);
  });

  it('tahrirlash qisman: bitta maydon yetarli; bo‘sh body va holat rad; izohni null bilan tozalash', () => {
    expect(expenseUpdateSchema.parse({ amount: '200' })).toEqual({ amount: '200' });
    expect(expenseUpdateSchema.parse({ note: null })).toEqual({ note: null });
    expect(expenseUpdateSchema.safeParse({}).success).toBe(false);
    expect(expenseUpdateSchema.safeParse({ status: 'PENDING' }).success).toBe(false);
    expect(expenseUpdateSchema.safeParse({ categoryId: null }).success).toBe(false);
  });

  it('kategoriya: nom trim, 100 belgigacha; tahrirlash — nom yoki holat', () => {
    expect(expenseCategoryCreateSchema.parse({ name: '  Ijara ' })).toEqual({ name: 'Ijara' });
    expect(expenseCategoryCreateSchema.safeParse({ name: ' ' }).success).toBe(false);
    expect(expenseCategoryCreateSchema.safeParse({ name: 'x'.repeat(101) }).success).toBe(false);
    expect(expenseCategoryUpdateSchema.parse({ isActive: false })).toEqual({ isActive: false });
    expect(expenseCategoryUpdateSchema.safeParse({}).success).toBe(false);
  });

  it('D-19: sana bugundan keyin bo‘lmaydi, bugun va o‘tgan sanalar ruxsat', () => {
    expect(isExpenseDateAllowed('2026-10-23', '2026-10-23')).toBe(true);
    expect(isExpenseDateAllowed('2025-01-01', '2026-10-23')).toBe(true);
    expect(isExpenseDateAllowed('2026-10-24', '2026-10-23')).toBe(false);
  });
});
