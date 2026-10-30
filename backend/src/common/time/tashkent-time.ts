import { APP_TIMEZONE } from '@divine/shared';

/**
 * Biznes kuni chegaralari (REQ-165, DATABASE §10, API §1.1 "Sana filtri").
 *
 * DB'da hamma narsa UTC (`timestamptz`); "bugun", "dateFrom/dateTo" va kunlik hisobotlar esa
 * Toshkent kalendari bo'yicha. Toshkent hozir doimiy UTC+5 (DST yo'q), lakin hisob qat'iy offset bilan
 * emas, IANA zonasi orqali qilinadi: tarixiy sanalar va boshqa zonalarda ham to'g'ri bo'lsin
 * (DST o'tishi, yarim tun mavjud bo'lmagan kunlar). Har bir kun — yarim ochiq oraliq `[start, end)`.
 */

export interface DayRange {
  /** Kun boshlanishi (shu kuni birinchi mavjud lahza), UTC. */
  start: Date;
  /** Keyingi kun boshlanishi — yarim ochiq oraliqning yuqori chegarasi (`< end`). */
  end: Date;
  /** Kunning oxirgi millisekundi (`23:59:59.999` mahalliy) — faqat ko'rsatish/inklyuziv API uchun. */
  endInclusive: Date;
}

const DATE_ONLY = /^(\d{4})-(\d{2})-(\d{2})$/;
const formatters = new Map<string, Intl.DateTimeFormat>();

function formatterFor(timeZone: string): Intl.DateTimeFormat {
  let formatter = formatters.get(timeZone);
  if (!formatter) {
    // en-CA → `YYYY-MM-DD`.
    formatter = new Intl.DateTimeFormat('en-CA', {
      timeZone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    });
    formatters.set(timeZone, formatter);
  }
  return formatter;
}

/** Lahzaning berilgan zonadagi kalendar sanasi: `YYYY-MM-DD`. */
export function localDate(instant: Date, timeZone: string = APP_TIMEZONE): string {
  return formatterFor(timeZone).format(instant);
}

/** Toshkent bo'yicha bugungi sana. */
export function tashkentToday(now: Date = new Date()): string {
  return localDate(now, APP_TIMEZONE);
}

function parseDateOnly(date: string): { y: number; m: number; d: number } {
  const match = DATE_ONLY.exec(date);
  if (!match) throw new RangeError(`Sana YYYY-MM-DD formatida bo'lishi kerak: ${date}`);
  const [y, m, d] = [Number(match[1]), Number(match[2]), Number(match[3])];
  const check = new Date(Date.UTC(y, m - 1, d));
  if (check.getUTCFullYear() !== y || check.getUTCMonth() !== m - 1 || check.getUTCDate() !== d) {
    throw new RangeError(`Mavjud bo'lmagan sana: ${date}`);
  }
  return { y, m, d };
}

/**
 * `date` kuni boshlanadigan birinchi lahza (UTC). Binary search: mahalliy sana `>= date` bo'ladigan
 * eng kichik millisekund. Offset −12…+14 soat bo'lgani uchun qidiruv oralig'i ±15 soat.
 * Yarim tun mavjud bo'lmasa (DST 00:00 da), kun birinchi mavjud lahzadan boshlanadi.
 */
export function zonedDayStart(date: string, timeZone: string = APP_TIMEZONE): Date {
  const { y, m, d } = parseDateOnly(date);
  const utcMidnight = Date.UTC(y, m - 1, d);
  let lo = utcMidnight - 15 * 3_600_000;
  let hi = utcMidnight + 15 * 3_600_000;
  while (lo < hi) {
    const mid = Math.floor((lo + hi) / 2);
    if (localDate(new Date(mid), timeZone) >= date) hi = mid;
    else lo = mid + 1;
  }
  return new Date(lo);
}

/** Kalendar bo'yicha keyingi kun: `2026-12-31` → `2027-01-01`. */
export function nextDate(date: string): string {
  const { y, m, d } = parseDateOnly(date);
  return new Date(Date.UTC(y, m - 1, d + 1)).toISOString().slice(0, 10);
}

/** Toshkent (yoki berilgan zona) kuni: `[start, end)`; 23 yoki 25 soatlik kunlar ham to'g'ri. */
export function zonedDayRange(date: string, timeZone: string = APP_TIMEZONE): DayRange {
  const start = zonedDayStart(date, timeZone);
  const end = zonedDayStart(nextDate(date), timeZone);
  return { start, end, endInclusive: new Date(end.getTime() - 1) };
}

export const tashkentDayRange = (date: string): DayRange => zonedDayRange(date, APP_TIMEZONE);

/**
 * API sana filtri → UTC yarim ochiq oraliq: `[dateFrom 00:00, dateTo+1 00:00)` Asia/Tashkent (API §1.1).
 * So'rovda: `sold_at >= from AND sold_at < to` (index ishlatiladi).
 */
export function tashkentDateRangeToUtc(range: { dateFrom?: string; dateTo?: string }): {
  from?: Date;
  to?: Date;
} {
  return {
    from: range.dateFrom ? zonedDayStart(range.dateFrom) : undefined,
    to: range.dateTo ? zonedDayStart(nextDate(range.dateTo)) : undefined,
  };
}
