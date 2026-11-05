import { describe, expect, it } from 'vitest';
import {
  buildCreditInstallments,
  computeCreditSchedule,
  creditAmountDueOn,
  creditCreateSchema,
  creditPaymentSchema,
  tashkentDateOf,
} from './credits.js';

const plan = (amount: string, installments: number, intervalDays = 1) =>
  buildCreditInstallments({ amount, firstDueDate: '2026-11-10', installments, intervalDays });

const valid = {
  debtorName: 'Ali Valiyev',
  debtorPhone: '+998901234567',
  amount: '50000',
  takenAt: '2026-11-05T10:00:00+05:00',
  firstDueDate: '2026-11-06',
  installments: 4,
};

describe('buildCreditInstallments — teng bo‘lish', () => {
  it('50 000 / 4 kun = har kuni 12 500', () => {
    expect(plan('50000', 4)).toEqual([
      { seq: 1, dueDate: '2026-11-10', amount: '12500.00' },
      { seq: 2, dueDate: '2026-11-11', amount: '12500.00' },
      { seq: 3, dueDate: '2026-11-12', amount: '12500.00' },
      { seq: 4, dueDate: '2026-11-13', amount: '12500.00' },
    ]);
  });

  it('bo‘linmasa — qoldiq oxirgi to‘lovga; jami aynan summa', () => {
    expect(plan('100000', 3).map((r) => r.amount)).toEqual(['33333.00', '33333.00', '33334.00']);
    expect(plan('100.50', 2).map((r) => r.amount)).toEqual(['50.00', '50.50']);
  });

  it('oraliq: har 7 kunda; oy chegarasidan o‘tadi', () => {
    expect(plan('300', 3, 7).map((r) => r.dueDate)).toEqual([
      '2026-11-10',
      '2026-11-17',
      '2026-11-24',
    ]);
    const end = buildCreditInstallments({
      amount: '20',
      firstDueDate: '2026-12-31',
      installments: 2,
      intervalDays: 1,
    });
    expect(end[1]?.dueDate).toBe('2027-01-01');
  });
});

describe('computeCreditSchedule — yetmagani keyingisiga, ortig‘i keyingisidan', () => {
  const rows = plan('50000', 4);

  it('to‘lov yo‘q: birinchi to‘lov eng yaqin, holat ACTIVE', () => {
    const s = computeCreditSchedule(rows, '0', '2026-11-09');
    expect(s).toMatchObject({
      status: 'ACTIVE',
      remainingAmount: '50000.00',
      next: { dueDate: '2026-11-10', amount: '12500.00' },
    });
  });

  it('kam to‘ladi (10 000): kun o‘tgach 2 500 keyingi kunga qo‘shiladi → 15 000', () => {
    const s = computeCreditSchedule(rows, '10000', '2026-11-11');
    expect(s.rows[0]).toMatchObject({ state: 'CARRIED', paid: '10000.00', toPay: '0.00' });
    expect(s.rows[1]).toMatchObject({ state: 'PENDING', toPay: '15000.00' });
    expect(s.next).toEqual({ dueDate: '2026-11-11', amount: '15000.00' });
    expect(s.status).toBe('OVERDUE');
    expect(s.remainingAmount).toBe('40000.00');
  });

  it('o‘sha kuni kam to‘lasa, kun tugaguncha shu kunda qisman qoladi', () => {
    const s = computeCreditSchedule(rows, '10000', '2026-11-10');
    expect(s.rows[0]).toMatchObject({ state: 'PARTIAL', toPay: '2500.00' });
    expect(s.status).toBe('ACTIVE');
  });

  it('ko‘p to‘ladi (20 000): ortig‘i 7 500 keyingi kundan ayriladi → 5 000', () => {
    const s = computeCreditSchedule(rows, '20000', '2026-11-10');
    expect(s.rows[0]).toMatchObject({ state: 'PAID', toPay: '0.00' });
    expect(s.rows[1]).toMatchObject({ state: 'PARTIAL', toPay: '5000.00' });
    expect(s.next).toEqual({ dueDate: '2026-11-11', amount: '5000.00' });
  });

  it('bir nechta kun o‘tkazib yuborsa — hammasi eng yaqin to‘lovga yig‘iladi', () => {
    const s = computeCreditSchedule(rows, '0', '2026-11-12');
    expect(s.next).toEqual({ dueDate: '2026-11-12', amount: '37500.00' });
  });

  it('hammasi o‘tgan: oxirgi qatorda jami qoldiq, OVERDUE', () => {
    const s = computeCreditSchedule(rows, '12500', '2026-12-01');
    expect(s.rows[3]).toMatchObject({ state: 'OVERDUE', toPay: '37500.00' });
    expect(s.status).toBe('OVERDUE');
    expect(s.next).toEqual({ dueDate: '2026-11-13', amount: '37500.00' });
  });

  it('to‘liq to‘landi: PAID, keyingi to‘lov yo‘q', () => {
    const s = computeCreditSchedule(rows, '50000', '2026-11-10');
    expect(s).toMatchObject({ status: 'PAID', remainingAmount: '0.00', next: null });
  });
});

describe('creditAmountDueOn — eslatma summasi', () => {
  const rows = plan('50000', 4);

  it('ertaga to‘lov bor: shu kungacha jami qoldiq', () => {
    expect(creditAmountDueOn(computeCreditSchedule(rows, '0', '2026-11-09'), '2026-11-10')).toBe(
      '12500.00',
    );
    expect(
      creditAmountDueOn(computeCreditSchedule(rows, '10000', '2026-11-10'), '2026-11-11'),
    ).toBe('15000.00');
  });

  it('o‘sha kuni to‘lov yo‘q yoki oldindan yopilgan — eslatma yo‘q', () => {
    expect(
      creditAmountDueOn(computeCreditSchedule(rows, '0', '2026-11-09'), '2026-11-20'),
    ).toBeNull();
    expect(
      creditAmountDueOn(computeCreditSchedule(rows, '12500', '2026-11-09'), '2026-11-10'),
    ).toBeNull();
  });
});

describe('sxemalar', () => {
  it('to‘g‘ri nasiya; oraliq standart 1 kun', () => {
    expect(creditCreateSchema.parse(valid).intervalDays).toBe(1);
  });

  it('rad etiladi: to‘lov olingan kundan oldin, 0 summa, 0 marta, noma’lum maydon', () => {
    for (const bad of [
      { ...valid, firstDueDate: '2026-11-04' },
      { ...valid, amount: '0' },
      { ...valid, installments: 0 },
      { ...valid, installments: 1.5 },
      { ...valid, amount: '999.99', installments: 1 },
      { ...valid, amount: '1000', installments: 200000 },
      { ...valid, debtorPhone: '' },
      { ...valid, debtorPhone: '123' },
      { ...valid, debtorPhone: undefined },
      { ...valid, remainingAmount: '1' },
    ]) {
      expect(creditCreateSchema.safeParse(bad).success).toBe(false);
    }
  });

  it('eng kam summa — 1 000 so‘m kiradi', () => {
    expect(creditCreateSchema.safeParse({ ...valid, amount: '1000', installments: 1 }).success).toBe(
      true,
    );
  });

  it('Toshkent sanasi: kechasi UTC boshqa kun', () => {
    expect(tashkentDateOf('2026-11-05T20:00:00Z')).toBe('2026-11-06');
  });

  it('to‘lov: musbat summa, sana majburiy', () => {
    expect(creditPaymentSchema.safeParse({ amount: '100', date: '2026-11-05' }).success).toBe(true);
    expect(creditPaymentSchema.safeParse({ amount: '0', date: '2026-11-05' }).success).toBe(false);
    expect(creditPaymentSchema.safeParse({ amount: '100' }).success).toBe(false);
  });
});
