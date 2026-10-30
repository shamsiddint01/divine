import { todayInTashkent } from '@/shared/lib/format';

// Toshkent vaqti doimiy UTC+5 (yozgi vaqt yo'q).
const OFFSET_MS = 5 * 60 * 60 * 1000;

/** `YYYY-MM-DD` (Toshkent kuni) → shu kun boshining UTC vaqti. */
export function dayStartUtc(date: string): Date {
  return new Date(Date.parse(`${date}T00:00:00.000Z`) - OFFSET_MS);
}

/** ISO vaqt → Toshkent kuni `YYYY-MM-DD`. */
export function tashkentDate(iso: string): string {
  return todayInTashkent(new Date(iso));
}

export function addDays(date: string, days: number): string {
  const d = new Date(Date.parse(`${date}T00:00:00.000Z`) + days * 86_400_000);
  return d.toISOString().slice(0, 10);
}

/** Toshkent kuni + soat/daqiqa → ISO UTC. */
export function atTashkent(date: string, hour: number, minute = 0): string {
  return new Date(dayStartUtc(date).getTime() + (hour * 60 + minute) * 60_000).toISOString();
}

/** `[from, to]` (ikkalasi ham kiradi) oralig'idagi Toshkent kuni ichidami. */
export function inDateRange(iso: string, from?: string, to?: string): boolean {
  const day = tashkentDate(iso);
  return (!from || day >= from) && (!to || day <= to);
}

export function dateOnlyInRange(date: string, from?: string, to?: string): boolean {
  return (!from || date >= from) && (!to || date <= to);
}
