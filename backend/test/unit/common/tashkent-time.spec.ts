import { describe, expect, it } from 'vitest';
import {
  localDate,
  nextDate,
  tashkentDateRangeToUtc,
  tashkentDayRange,
  tashkentToday,
  zonedDayRange,
} from '../../../src/common/time/tashkent-time.js';

const iso = (d: Date) => d.toISOString();

describe('Toshkent kun chegaralari (REQ-165)', () => {
  it('kun: 00:00:00.000 → 23:59:59.999 mahalliy (UTC+5)', () => {
    const day = tashkentDayRange('2026-10-08');
    expect(iso(day.start)).toBe('2026-10-07T19:00:00.000Z');
    expect(iso(day.endInclusive)).toBe('2026-10-08T18:59:59.999Z');
    expect(iso(day.end)).toBe('2026-10-08T19:00:00.000Z');
  });

  it('"bugun" Toshkent bo‘yicha: UTC 19:00 dan keyin ertangi sana', () => {
    expect(tashkentToday(new Date('2026-10-07T18:59:59.999Z'))).toBe('2026-10-07');
    expect(tashkentToday(new Date('2026-10-07T19:00:00.000Z'))).toBe('2026-10-08');
  });

  it('yil, oy va kabisa yili chegaralari', () => {
    expect(nextDate('2026-12-31')).toBe('2027-01-01');
    expect(nextDate('2028-02-28')).toBe('2028-02-29');
    expect(iso(tashkentDayRange('2027-01-01').start)).toBe('2026-12-31T19:00:00.000Z');
  });

  it('API sana filtri: ikkala chegara ham kiradi → [from 00:00, to+1 00:00)', () => {
    const range = tashkentDateRangeToUtc({ dateFrom: '2026-10-01', dateTo: '2026-10-08' });
    expect(iso(range.from!)).toBe('2026-09-30T19:00:00.000Z');
    expect(iso(range.to!)).toBe('2026-10-08T19:00:00.000Z');
    const one = tashkentDateRangeToUtc({ dateFrom: '2026-10-08', dateTo: '2026-10-08' });
    expect(one.to!.getTime() - one.from!.getTime()).toBe(24 * 3_600_000);
    expect(tashkentDateRangeToUtc({})).toEqual({ from: undefined, to: undefined });
  });

  it('chegaradagi lahzalar to‘g‘ri kunga tushadi', () => {
    const { start, end } = tashkentDayRange('2026-10-08');
    expect(localDate(start)).toBe('2026-10-08');
    expect(localDate(new Date(start.getTime() - 1))).toBe('2026-10-07');
    expect(localDate(new Date(end.getTime() - 1))).toBe('2026-10-08');
    expect(localDate(end)).toBe('2026-10-09');
  });

  it('noto‘g‘ri sana rad etiladi', () => {
    expect(() => tashkentDayRange('2026-02-30')).toThrow(RangeError);
    expect(() => tashkentDayRange('08.10.2026')).toThrow(RangeError);
  });
});

describe('IANA zonalari: DST va yarim tun mavjud bo‘lmagan kunlar', () => {
  it('Europe/Berlin: bahorgi o‘tish kuni 23 soat, kuzgisi 25 soat', () => {
    const spring = zonedDayRange('2026-03-29', 'Europe/Berlin');
    expect(spring.end.getTime() - spring.start.getTime()).toBe(23 * 3_600_000);
    expect(iso(spring.start)).toBe('2026-03-28T23:00:00.000Z');
    const autumn = zonedDayRange('2026-10-25', 'Europe/Berlin');
    expect(autumn.end.getTime() - autumn.start.getTime()).toBe(25 * 3_600_000);
  });

  it('America/Santiago: 00:00 mavjud emas (DST) → kun 01:00 dan boshlanadi', () => {
    // 2026-09-06 da soat 00:00 → 01:00 ga sakraydi (UTC−4 → UTC−3).
    const day = zonedDayRange('2026-09-06', 'America/Santiago');
    expect(iso(day.start)).toBe('2026-09-06T04:00:00.000Z');
    expect(localDate(new Date(day.start.getTime() - 1), 'America/Santiago')).toBe('2026-09-05');
  });

  it('Toshkent tarixiy DST davri (1990-yil) ham IANA orqali to‘g‘ri', () => {
    // IANA: 1990 yilda qishda UTC+6, yozda UTC+7 (hozir doimiy UTC+5) — offset qat'iy emas.
    expect(iso(tashkentDayRange('1990-01-01').start)).toBe('1989-12-31T18:00:00.000Z');
    expect(iso(tashkentDayRange('1990-07-01').start)).toBe('1990-06-30T17:00:00.000Z');
  });
});
