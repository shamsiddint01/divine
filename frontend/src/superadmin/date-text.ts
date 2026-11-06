/** Qo'lda yoziladigan sana: `kun/oy/yil`. */

/** Yozish paytida faqat raqamlar qoladi va `/` o'zi qo'yiladi. */
export function maskDate(input: string): string {
  const digits = input.replace(/\D/g, '').slice(0, 8);
  return [digits.slice(0, 2), digits.slice(2, 4), digits.slice(4)].filter(Boolean).join('/');
}

export function toDayMonthYear(iso: string): string {
  const [year, month, day] = iso.split('-');
  return `${day}/${month}/${year}`;
}

/** `06/12/2026` → `2026-12-06`; mavjud bo'lmagan sana (31/02) — `null`. */
export function parseDayMonthYear(text: string): string | null {
  const match = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(text);
  if (!match) return null;
  const [, day, month, year] = match;
  const iso = `${year}-${month}-${day}`;
  const date = new Date(`${iso}T00:00:00Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().startsWith(iso) ? iso : null;
}
