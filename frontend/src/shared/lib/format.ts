import { APP_TIMEZONE, CURRENCY_LABEL } from '@divine/shared';
import { t } from '@/i18n/uz';

// Ko'rsatish formatlari (REQ-165). Pul va miqdor API'dan STRING bo'lib keladi va
// Number'ga aylantirilmaydi — katta summalarda precision yo'qolmasligi uchun.

const NBSP = ' ';

function groupThousands(integerPart: string): string {
  return integerPart.replace(/\B(?=(\d{3})+(?!\d))/g, NBSP);
}

/** `"1250000.5"` → `"1 250 000,50 so‘m"` (o'zbek uslubi: probel bilan guruhlash, vergul — kasr). */
export function formatMoney(value: string, options: { withCurrency?: boolean } = {}): string {
  const { withCurrency = true } = options;
  const negative = value.trim().startsWith('-');
  const [integer = '0', fraction = ''] = value.trim().replace(/^-/, '').split('.');
  const cents = fraction.padEnd(2, '0').slice(0, 2);
  const amount = `${negative ? '-' : ''}${groupThousands(integer.replace(/^0+(?=\d)/, ''))}`;
  const formatted = cents === '00' ? amount : `${amount},${cents}`;
  return withCurrency ? `${formatted}${NBSP}${CURRENCY_LABEL}` : formatted;
}

/** `"12.500"` → `"12,5"`, `"3.000"` → `"3"` */
export function formatQuantity(value: string): string {
  const negative = value.trim().startsWith('-');
  const [integer = '0', fraction = ''] = value.trim().replace(/^-/, '').split('.');
  const trimmedFraction = fraction.replace(/0+$/, '');
  const grouped = groupThousands(integer.replace(/^0+(?=\d)/, ''));
  return `${negative ? '-' : ''}${trimmedFraction ? `${grouped},${trimmedFraction}` : grouped}`;
}

/** Ixcham summa (KPI va grafik o'qlari): `"18450000"` → `"18,5 mln so‘m"` */
export function formatCompactMoney(
  value: string,
  options: { withCurrency?: boolean } = {},
): string {
  const { withCurrency = true } = options;
  const negative = value.trim().startsWith('-') ? '-' : '';
  const digits = (value.trim().replace(/^-/, '').split('.')[0] ?? '0') || '0';
  const n = BigInt(digits);
  const scales = [
    [1_000_000_000n, t.format.billion],
    [1_000_000n, t.format.million],
    [1_000n, t.format.thousand],
  ] as const;
  for (const [div, label] of scales) {
    if (n < div) continue;
    let text: string;
    if (n >= div * 100n) {
      text = groupThousands(String((n + div / 2n) / div));
    } else {
      const tenths = (n * 10n + div / 2n) / div;
      const whole = tenths / 10n;
      const decimal = tenths % 10n;
      text = decimal === 0n ? String(whole) : `${whole},${decimal}`;
    }
    const compact = `${negative}${text}${NBSP}${label}`;
    return withCurrency ? `${compact}${NBSP}${CURRENCY_LABEL}` : compact;
  }
  return formatMoney(value, { withCurrency });
}

/** Butun son: `1500` → `"1 500"` */
export function formatInteger(value: number): string {
  return groupThousands(String(Math.trunc(value)));
}

const dateTimeParts = new Intl.DateTimeFormat('en-GB', {
  timeZone: APP_TIMEZONE,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  hourCycle: 'h23',
});

function partsOf(date: Date): Record<string, string> {
  return Object.fromEntries(dateTimeParts.formatToParts(date).map((p) => [p.type, p.value]));
}

/** UTC ISO vaqt → Toshkent vaqti: `"06.10.2026 15:25"` */
export function formatDateTime(iso: string | Date): string {
  const p = partsOf(typeof iso === 'string' ? new Date(iso) : iso);
  return `${p.day}.${p.month}.${p.year} ${p.hour}:${p.minute}`;
}

/** Faqat vaqt: `"15:25"` (Toshkent) */
export function formatTime(iso: string | Date): string {
  const p = partsOf(typeof iso === 'string' ? new Date(iso) : iso);
  return `${p.hour}:${p.minute}`;
}

/** UTC ISO vaqt yoki `YYYY-MM-DD` → `"06.10.2026"` */
export function formatDate(value: string | Date): string {
  if (typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value)) {
    const [year, month, day] = value.split('-');
    return `${day}.${month}.${year}`;
  }
  const p = partsOf(typeof value === 'string' ? new Date(value) : value);
  return `${p.day}.${p.month}.${p.year}`;
}

/** Toshkent bo'yicha bugungi sana `YYYY-MM-DD`. */
export function todayInTashkent(now: Date = new Date()): string {
  const p = partsOf(now);
  return `${p.year}-${p.month}-${p.day}`;
}

/** `YYYY-MM-DD` → qisqa ko'rinish o'q uchun: `"06.10"` */
export function formatDayShort(date: string): string {
  const [, month, day] = date.split('-');
  return `${day}.${month}`;
}

/** Nisbiy vaqt: "5 daqiqa oldin", "Kecha 14:20", aks holda to'liq sana. */
export function formatRelative(iso: string, now: Date = new Date()): string {
  const diffMin = Math.floor((now.getTime() - new Date(iso).getTime()) / 60_000);
  if (diffMin < 1) return t.format.justNow;
  if (diffMin < 60) return t.format.minutesAgo(diffMin);
  const today = todayInTashkent(now);
  const day = todayInTashkent(new Date(iso));
  if (day === today) return t.format.hoursAgo(Math.floor(diffMin / 60));
  const yesterday = todayInTashkent(new Date(now.getTime() - 86_400_000));
  if (day === yesterday) return `${t.format.yesterday} ${formatTime(iso)}`;
  return formatDateTime(iso);
}

/** Telefonni ko'rsatish: `+998901234567` → `+998 90 123 45 67` */
export function formatPhone(phone: string | null | undefined): string {
  if (!phone) return t.common.notSet;
  const m = /^\+998(\d{2})(\d{3})(\d{2})(\d{2})$/.exec(phone);
  return m ? `+998 ${m[1]} ${m[2]} ${m[3]} ${m[4]}` : phone;
}

/** Ism-familiyadan bosh harflar: "Aziz Karimov" → "AK" */
export function initials(name: string): string {
  return (
    name
      .split(/\s+/)
      .filter(Boolean)
      .slice(0, 2)
      .map((part) => part.charAt(0).toUpperCase())
      .join('') || '?'
  );
}
