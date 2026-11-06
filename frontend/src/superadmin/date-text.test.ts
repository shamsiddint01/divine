import { describe, expect, it } from 'vitest';
import { maskDate, parseDayMonthYear, toDayMonthYear } from './date-text';

describe('kun/oy/yil sana', () => {
  it('yozish paytida / o‘zi qo‘yiladi', () => {
    expect(maskDate('0612')).toBe('06/12');
    expect(maskDate('06122026')).toBe('06/12/2026');
    expect(maskDate('06.12.2026')).toBe('06/12/2026');
    expect(maskDate('061220261')).toBe('06/12/2026');
  });

  it('birinchi raqam kun, ikkinchisi oy', () => {
    expect(parseDayMonthYear('06/12/2026')).toBe('2026-12-06');
    expect(toDayMonthYear('2026-12-06')).toBe('06/12/2026');
  });

  it('mavjud bo‘lmagan yoki chala sana rad etiladi', () => {
    expect(parseDayMonthYear('31/02/2026')).toBeNull();
    expect(parseDayMonthYear('12/13/2026')).toBeNull();
    expect(parseDayMonthYear('06/12')).toBeNull();
  });
});
