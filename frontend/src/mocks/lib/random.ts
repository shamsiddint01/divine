/** Deterministik PRNG (mulberry32): seed bir xil bo'lsa, demo ma'lumotlar ham bir xil chiqadi. */
export function createRandom(seed: number) {
  let a = seed >>> 0;
  const next = () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const int = (min: number, max: number) => Math.floor(next() * (max - min + 1)) + min;
  const pick = <T>(list: readonly T[]): T => {
    const item = list[Math.floor(next() * list.length)];
    if (item === undefined) throw new Error('pick: bo‘sh ro‘yxat');
    return item;
  };
  const chance = (p: number) => next() < p;
  const shuffle = <T>(list: readonly T[]): T[] => {
    const copy = [...list];
    for (let i = copy.length - 1; i > 0; i--) {
      const j = Math.floor(next() * (i + 1));
      [copy[i], copy[j]] = [copy[j] as T, copy[i] as T];
    }
    return copy;
  };
  return { next, int, pick, chance, shuffle };
}

export type Random = ReturnType<typeof createRandom>;

/** Mock ID: UUID ko'rinishida (API contract'iga mos). */
export function mockUuid(rand: () => number = Math.random): string {
  const hex = Array.from({ length: 32 }, () => Math.floor(rand() * 16).toString(16));
  hex[12] = '7';
  hex[16] = ((parseInt(hex[16] ?? '0', 16) & 0x3) | 0x8).toString(16);
  const h = hex.join('');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}

/** EAN-13 (O'zbekiston GS1 prefiksi 478) — nazorat raqami bilan. */
export function ean13(body9: string): string {
  const digits = `478${body9}`.slice(0, 12);
  const sum = digits.split('').reduce((acc, d, i) => acc + Number(d) * (i % 2 === 0 ? 1 : 3), 0);
  return `${digits}${(10 - (sum % 10)) % 10}`;
}
