import { describe, expect, it } from 'vitest';
import { t } from '@/i18n/uz';
import {
  formatCompactMoney,
  formatDate,
  formatDateTime,
  formatDayShort,
  formatInteger,
  formatMoney,
  formatPhone,
  formatQuantity,
  formatRelative,
  formatTime,
  initials,
  todayInTashkent,
} from './format';

const NBSP = ' ';

describe('formatMoney', () => {
  it('ming xonalarni probel bilan guruhlaydi va so‘m qo‘shadi', () => {
    expect(formatMoney('1250000')).toBe(`1${NBSP}250${NBSP}000${NBSP}so‘m`);
    expect(formatMoney('1250000.50')).toBe(`1${NBSP}250${NBSP}000,50${NBSP}so‘m`);
    expect(formatMoney('1250000.5', { withCurrency: false })).toBe(`1${NBSP}250${NBSP}000,50`);
  });

  it('katta summalarda precision yo‘qolmaydi (Number ishlatilmaydi)', () => {
    expect(formatMoney('9999999999999999.99', { withCurrency: false })).toBe(
      `9${NBSP}999${NBSP}999${NBSP}999${NBSP}999${NBSP}999,99`,
    );
  });

  it('nol va manfiy qiymatlar', () => {
    expect(formatMoney('0.00', { withCurrency: false })).toBe('0');
    expect(formatMoney('-1500', { withCurrency: false })).toBe(`-1${NBSP}500`);
  });
});

describe('formatQuantity', () => {
  it('ortiqcha nollarni olib tashlaydi', () => {
    expect(formatQuantity('3.000')).toBe('3');
    expect(formatQuantity('12.500')).toBe('12,5');
    expect(formatQuantity('1500')).toBe(`1${NBSP}500`);
  });
});

describe('Toshkent vaqti (REQ-165)', () => {
  it('UTC vaqtni Asia/Tashkent (UTC+5) da ko‘rsatadi', () => {
    expect(formatDateTime('2026-10-06T10:25:00.000Z')).toBe('06.10.2026 15:25');
  });

  it('UTC bo‘yicha kechagi kun Toshkentda bugungi kun bo‘lishi mumkin', () => {
    expect(formatDate('2026-10-05T20:30:00.000Z')).toBe('06.10.2026');
  });

  it('biznes sanasini (YYYY-MM-DD) vaqt zonasisiz formatlaydi', () => {
    expect(formatDate('2026-10-06')).toBe('06.10.2026');
  });
});

describe('format — qolgan funksiyalar (Phase 15)', () => {
  const now = new Date('2026-10-06T10:30:00.000Z'); // Toshkent: 15:30

  it('ixcham summa: ming / mln / mlrd, yaxlitlash, manfiy va kichik summa', () => {
    expect(formatCompactMoney('18450000')).toBe(`18,5${NBSP}mln${NBSP}so‘m`);
    expect(formatCompactMoney('18000000', { withCurrency: false })).toBe(`18${NBSP}mln`);
    expect(formatCompactMoney('250000000000', { withCurrency: false })).toBe(`250${NBSP}mlrd`);
    expect(formatCompactMoney('1500', { withCurrency: false })).toBe(`1,5${NBSP}ming`);
    expect(formatCompactMoney('-2500000.75', { withCurrency: false })).toBe(`-2,5${NBSP}mln`);
    expect(formatCompactMoney('999', { withCurrency: false })).toBe('999');
    expect(formatCompactMoney('0.00', { withCurrency: false })).toBe('0');
  });

  it('butun son, vaqt, bugungi sana, qisqa kun', () => {
    expect(formatInteger(1234567.9)).toBe(`1${NBSP}234${NBSP}567`);
    expect(formatTime('2026-10-06T10:25:00.000Z')).toBe('15:25');
    expect(formatDate(now)).toBe('06.10.2026');
    expect(todayInTashkent(new Date('2026-10-05T19:30:00.000Z'))).toBe('2026-10-06');
    expect(formatDayShort('2026-10-06')).toBe('06.10');
  });

  it('nisbiy vaqt: hozir, daqiqa, soat, kecha, undan oldin', () => {
    expect(formatRelative('2026-10-06T10:29:40.000Z', now)).toBe('hozirgina');
    expect(formatRelative('2026-10-06T10:05:00.000Z', now)).toBe('25 daqiqa oldin');
    expect(formatRelative('2026-10-06T07:00:00.000Z', now)).toBe('3 soat oldin');
    expect(formatRelative('2026-10-05T09:20:00.000Z', now)).toBe('Kecha 14:20');
    expect(formatRelative('2026-10-01T09:20:00.000Z', now)).toBe('01.10.2026 14:20');
  });

  it('telefon, bosh harflar, manfiy miqdor', () => {
    expect(formatPhone('+998901234567')).toBe('+998 90 123 45 67');
    expect(formatPhone('+12025550123')).toBe('+12025550123');
    expect(formatPhone(null)).toBe(t.common.notSet);
    expect(initials('aziz karimov rahimovich')).toBe('AK');
    expect(initials('  ')).toBe('?');
    expect(formatQuantity('-0.500')).toBe('-0,5');
  });
});
