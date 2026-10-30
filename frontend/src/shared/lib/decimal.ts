// Aniq o'nlik arifmetika (BigInt, fixed-point). Pul va miqdor API'da STRING bo'lib keladi va
// hech qachon JS Number'ga aylantirilmaydi — 0.1 + 0.2 kabi float xatolari bo'lmaydi (REQ-133).

export const MONEY_SCALE = 2;
export const QTY_SCALE = 3;

const pow10 = (n: number) => 10n ** BigInt(n);

/** "12.5" (scale 2) → 1250n. Noto'g'ri qiymat → null. */
export function toUnits(value: string, scale: number): bigint | null {
  const v = value.trim();
  const match = /^(-)?(\d+)(?:\.(\d+))?$/.exec(v);
  if (!match) return null;
  const [, sign, int = '0', frac = ''] = match;
  if (frac.length > scale) {
    // Ortiqcha xonalar — yarim yuqoriga yaxlitlash
    const kept = BigInt(int + frac.slice(0, scale));
    const next = Number(frac[scale]);
    const units = next >= 5 ? kept + 1n : kept;
    return sign ? -units : units;
  }
  const units = BigInt(int + frac.padEnd(scale, '0'));
  return sign ? -units : units;
}

/** 1250n (scale 2) → "12.50" */
export function fromUnits(units: bigint, scale: number): string {
  const negative = units < 0n;
  const abs = negative ? -units : units;
  const base = pow10(scale);
  const int = abs / base;
  const frac = (abs % base).toString().padStart(scale, '0');
  return `${negative ? '-' : ''}${int}${scale > 0 ? `.${frac}` : ''}`;
}

function units(value: string, scale: number): bigint {
  return toUnits(value, scale) ?? 0n;
}

/** Yarim yuqoriga bo'lish (musbat va manfiy uchun simmetrik). */
function divRound(n: bigint, d: bigint): bigint {
  const q = n / d;
  const r = n % d;
  if (r === 0n) return q;
  const twice = (r < 0n ? -r : r) * 2n;
  if (twice >= d) return n < 0n ? q - 1n : q + 1n;
  return q;
}

export function sumMoney(values: readonly string[]): string {
  return fromUnits(
    values.reduce((acc, v) => acc + units(v, MONEY_SCALE), 0n),
    MONEY_SCALE,
  );
}

export function sumQty(values: readonly string[]): string {
  return fromUnits(
    values.reduce((acc, v) => acc + units(v, QTY_SCALE), 0n),
    QTY_SCALE,
  );
}

export function subMoney(a: string, b: string): string {
  return fromUnits(units(a, MONEY_SCALE) - units(b, MONEY_SCALE), MONEY_SCALE);
}

export function subQty(a: string, b: string): string {
  return fromUnits(units(a, QTY_SCALE) - units(b, QTY_SCALE), QTY_SCALE);
}

export function addQty(a: string, b: string): string {
  return fromUnits(units(a, QTY_SCALE) + units(b, QTY_SCALE), QTY_SCALE);
}

/** miqdor × narx → pul, 2 xonagacha yarim yuqoriga yaxlitlangan (DB'dagi round(q*p, 2) bilan bir xil). */
export function lineTotal(quantity: string, price: string): string {
  const product = units(quantity, QTY_SCALE) * units(price, MONEY_SCALE);
  return fromUnits(divRound(product, pow10(QTY_SCALE)), MONEY_SCALE);
}

/** Taqqoslash: -1 | 0 | 1 */
export function compareQty(a: string, b: string): -1 | 0 | 1 {
  const d = units(a, QTY_SCALE) - units(b, QTY_SCALE);
  return d === 0n ? 0 : d > 0n ? 1 : -1;
}

export function compareMoney(a: string, b: string): -1 | 0 | 1 {
  const d = units(a, MONEY_SCALE) - units(b, MONEY_SCALE);
  return d === 0n ? 0 : d > 0n ? 1 : -1;
}

/** Foiz: (a / b) × 100, 1 xona aniqlikda (ko'rsatish uchun). b = 0 → null. */
export function percent(a: string, b: string): string | null {
  const bu = units(b, MONEY_SCALE);
  if (bu === 0n) return null;
  return fromUnits(divRound(units(a, MONEY_SCALE) * 1000n, bu), 1);
}

/**
 * Foydalanuvchi kiritgan sonni kanonik ko'rinishga keltiradi:
 * "1 250 000,50" → "1250000.50", "  12.5 " → "12.5". Noto'g'ri bo'lsa null.
 */
export function normalizeNumberInput(input: string): string | null {
  const cleaned = input.replace(/[\s ]/g, '').replace(',', '.');
  if (cleaned === '' || !/^\d+(\.\d*)?$/.test(cleaned)) return null;
  return cleaned.endsWith('.') ? cleaned.slice(0, -1) : cleaned;
}

/** Ko'rsatish uchun JS soni (grafik o'qlari). Hisob-kitobda ISHLATILMAYDI. */
export function toChartNumber(value: string): number {
  return Number(value);
}

/** Pulni butun songa bo'lish (o'rtacha chek): yarim yuqoriga, 2 xona. */
export function divideMoney(value: string, divisor: number): string {
  if (!Number.isInteger(divisor) || divisor <= 0) return fromUnits(0n, MONEY_SCALE);
  return fromUnits(divRound(units(value, MONEY_SCALE), BigInt(divisor)), MONEY_SCALE);
}
