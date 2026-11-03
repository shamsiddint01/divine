import { describe, expect, it, vi } from 'vitest';
import type { AccessContext } from '../../../src/common/auth/access-context.js';
import { ManualClock } from '../../../src/common/time/clock.js';
import type { ExpenseCategoryRow } from '../../../src/modules/expenses/expenses.repository.js';
import {
  ExpensesService,
  toExpenseCategoryDto,
} from '../../../src/modules/expenses/expenses.service.js';

const category: ExpenseCategoryRow = {
  id: 'k',
  name: 'Ijara',
  isActive: false,
  expenseCount: 4,
  createdById: 'a',
  createdByLogin: 'admin',
  createdByFullName: null,
  createdAt: new Date('2026-10-01T10:00:00.000Z'),
  updatedAt: new Date('2026-10-02T10:00:00.000Z'),
};

const ctx = { userId: 'u' } as AccessContext;

/** Sana tekshiruvi tranzaksiyadan oldin: o'tsa — `transactions.run` chaqiriladi. */
function serviceAt(instant: string) {
  const run = vi.fn().mockResolvedValue({ id: 'e' });
  const service = new ExpensesService(
    {} as never,
    { run } as never,
    {} as never,
    new ManualClock(new Date(instant)),
  );
  const create = (date: string) =>
    service.create(ctx, { date, amount: '100', categoryId: 'k' }, {} as never);
  return { run, create };
}

describe('xarajat sanasi — Toshkent kuni bo‘yicha (D-19)', () => {
  it('UTC 18:59 (Toshkentda 23:59) — ertangi sana rad etiladi, bugungisi o‘tadi', async () => {
    const { run, create } = serviceAt('2026-10-22T18:59:59.000Z');
    await expect(create('2026-10-23')).rejects.toMatchObject({
      code: 'VALIDATION_ERROR',
      details: [{ field: 'date' }],
    });
    expect(run).not.toHaveBeenCalled();
    await create('2026-10-22');
    expect(run).toHaveBeenCalledTimes(1);
  });

  it('UTC 19:00 (Toshkentda yarim tun) — yangi kun: UTC bo‘yicha "ertangi" sana ruxsat', async () => {
    const { run, create } = serviceAt('2026-10-22T19:00:00.000Z');
    await create('2026-10-23');
    expect(run).toHaveBeenCalledTimes(1);
    await expect(create('2026-10-24')).rejects.toMatchObject({ code: 'VALIDATION_ERROR' });
  });
});

describe('kategoriya serializeri (D-19)', () => {
  it('to‘liq: holat, xarajatlar soni, sanalar; minimal (sotuvchi): faqat id va nom', () => {
    expect(toExpenseCategoryDto(category, true)).toEqual({
      id: 'k',
      name: 'Ijara',
      isActive: false,
      expenseCount: 4,
      createdBy: { id: 'a', login: 'admin', fullName: null },
      createdAt: '2026-10-01T10:00:00.000Z',
      updatedAt: '2026-10-02T10:00:00.000Z',
    });
    expect(toExpenseCategoryDto(category, false)).toEqual({ id: 'k', name: 'Ijara' });
  });
});
