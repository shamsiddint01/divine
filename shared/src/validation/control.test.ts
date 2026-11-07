import { describe, expect, it } from 'vitest';
import { addOneMonth, amountDue, applyPayment, nextPaidUntil } from './control.js';

describe('to‘lov muddati', () => {
  it('bir oy qo‘shadi, oy oxirini saqlaydi', () => {
    expect(addOneMonth('2026-11-06')).toBe('2026-12-06');
    expect(addOneMonth('2026-12-15')).toBe('2027-01-15');
    expect(addOneMonth('2027-01-31')).toBe('2027-02-28');
    expect(addOneMonth('2028-01-31')).toBe('2028-02-29');
  });

  it('vaqtida to‘lansa to‘lov kuni saqlanadi, kechiksa to‘langan kundan', () => {
    expect(nextPaidUntil('2026-12-06', '2026-12-01')).toBe('2027-01-06');
    expect(nextPaidUntil('2026-06-12', '2026-11-07')).toBe('2026-12-07');
  });
});

describe('balans', () => {
  const base = {
    paidUntil: '2026-12-06',
    balance: '0.00',
    agreedPrice: '100000',
    paidAt: '2026-12-01',
  };

  it('to‘liq narx — bir oy; ortig‘i keyingi oyga qoladi', () => {
    expect(applyPayment({ ...base, amount: '100000' })).toEqual({
      paidUntil: '2027-01-06',
      balance: '0.00',
      months: 1,
    });
    expect(applyPayment({ ...base, amount: '250000' })).toEqual({
      paidUntil: '2027-02-06',
      balance: '50000.00',
      months: 2,
    });
  });

  it('kam to‘lov balansda yig‘iladi, narx yig‘ilganda oy qo‘shiladi', () => {
    const half = applyPayment({ ...base, amount: '60000' });
    expect(half).toEqual({ paidUntil: '2026-12-06', balance: '60000.00', months: 0 });
    expect(applyPayment({ ...base, balance: half.balance, amount: '40000' })).toMatchObject({
      paidUntil: '2027-01-06',
      balance: '0.00',
    });
    expect(amountDue('100000', '60000.00')).toBe('40000.00');
    expect(amountDue('100000', '150000.00')).toBe('0.00');
  });

  it('kechikkan to‘lov to‘langan kundan; narx 0 bo‘lsa har to‘lov bir oy', () => {
    expect(
      applyPayment({ ...base, paidUntil: '2026-06-12', paidAt: '2026-11-07', amount: '100000' })
        .paidUntil,
    ).toBe('2026-12-07');
    expect(applyPayment({ ...base, agreedPrice: '0', amount: '5000' }).months).toBe(1);
  });
});
