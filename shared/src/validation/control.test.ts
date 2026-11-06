import { describe, expect, it } from 'vitest';
import { addOneMonth, nextPaidUntil } from './control.js';

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
