/**
 * `TRUST_PROXY`: hop'lar soni (`1`) yoki ishonchli proxy'lar ro'yxati (`loopback,uniquelocal,cloudflare,render`).
 * Render'da so'rov sayt (static rewrite) orqali 5 ta, API'ga to'g'ridan 2 ta proxy'dan o'tadi: bitta raqam
 * ikkalasiga to'g'ri kelmaydi. Ro'yxatda Express zanjirni o'ngdan o'qib, ishonchli manzillarni tashlab
 * o'tadi; birinchi begona manzil — foydalanuvchi (2026-11-07 o'lchovi, docs/RUNBOOK-RENDER.md).
 */

/** https://www.cloudflare.com/ips (2026-11-07). */
const CLOUDFLARE = [
  '173.245.48.0/20',
  '103.21.244.0/22',
  '103.22.200.0/22',
  '103.31.4.0/22',
  '141.101.64.0/18',
  '108.162.192.0/18',
  '190.93.240.0/20',
  '188.114.96.0/20',
  '197.234.240.0/22',
  '198.41.128.0/17',
  '162.158.0.0/15',
  '104.16.0.0/13',
  '104.24.0.0/14',
  '172.64.0.0/13',
  '131.0.72.0/22',
  '2400:cb00::/32',
  '2606:4700::/32',
  '2803:f800::/32',
  '2405:b500::/32',
  '2405:8100::/32',
  '2a06:98c0::/29',
  '2c0f:f248::/32',
];

/** Render (ARIN RS-1125): static site rewrite shu yerdan so'raydi. */
const RENDER = ['74.220.48.0/20'];

const GROUPS: Record<string, readonly string[]> = { cloudflare: CLOUDFLARE, render: RENDER };

export function parseTrustProxy(value: number | string): number | string[] {
  if (typeof value === 'number') return value;
  const trimmed = value.trim();
  if (/^\d+$/.test(trimmed)) return Number(trimmed);
  return trimmed
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean)
    .flatMap((item) => GROUPS[item] ?? [item]);
}
