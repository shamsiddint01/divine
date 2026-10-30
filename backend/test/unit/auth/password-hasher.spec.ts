import { describe, expect, it } from 'vitest';
import {
  generatePassword,
  PasswordHasher,
} from '../../../src/modules/auth/password/password-hasher.js';

const PEPPER = 'unit-test-pepper-0123456789-abcdefghijk';
const hasher = new PasswordHasher(PEPPER);

describe('PasswordHasher (SECURITY §6)', () => {
  it('format: v1$ + argon2id (64 MiB, t=3, p=1); plaintext saqlanmaydi; har safar boshqa salt', async () => {
    const [a, b] = await Promise.all([hasher.hash('483920'), hasher.hash('483920')]);
    expect(a).toMatch(/^v1\$\$argon2id\$v=19\$m=65536,t=3,p=1\$/);
    expect(a).not.toContain('483920');
    expect(a).not.toBe(b);
  });

  it('to‘g‘ri parol → true, noto‘g‘ri → false', async () => {
    const stored = await hasher.hash('483920');
    expect(await hasher.verify(stored, '483920')).toBe(true);
    expect(await hasher.verify(stored, '483921')).toBe(false);
  });

  it('pepper boshqa bo‘lsa (DB o‘g‘irlangan, pepper yo‘q) — tekshiruv o‘tmaydi', async () => {
    const stored = await hasher.hash('483920');
    const other = new PasswordHasher('boshqa-pepper-0123456789-abcdefghijklm');
    expect(await other.verify(stored, '483920')).toBe(false);
  });

  it('pepper‘siz argon2 hash (pepper qo‘llanmagan) ham qabul qilinmaydi', async () => {
    const { hash } = await import('@node-rs/argon2');
    const raw = await hash('483920');
    expect(await hasher.verify(`v1$${raw}`, '483920')).toBe(false);
  });

  it.each([
    ['bo‘sh', ''],
    ['ochiq parol', '483920'],
    ['versiyasiz', '$argon2id$v=19$m=65536,t=3,p=1$abc$def'],
    ['noma’lum versiya', 'v9$$argon2id$v=19$m=65536,t=3,p=1$abc$def'],
    ['buzilgan argon2', 'v1$$argon2id$buzilgan'],
    ['bcrypt', 'v1$$2b$10$abcdefghijklmnopqrstuv'],
  ])('noto‘g‘ri hash (%s) → false, istisno emas', async (_label, stored) => {
    await expect(hasher.verify(stored, '483920')).resolves.toBe(false);
  });

  it('pepper yo‘q yoki qisqa → konstruktor xato beradi (qiymat chiqmaydi)', () => {
    expect(() => new PasswordHasher('')).toThrow(/32 belgi/);
    expect(() => new PasswordHasher('qisqa')).toThrow(/32 belgi/);
    try {
      new PasswordHasher('qisqa-maxfiy');
    } catch (error) {
      expect(String(error)).not.toContain('qisqa-maxfiy');
    }
  });

  it('mavjud bo‘lmagan login uchun soxta tekshiruv doim false', async () => {
    await expect(hasher.verifyAgainstDummy('483920')).resolves.toBe(false);
  });
});

describe('pepper rotation (SECURITY §13, Phase 17)', () => {
  const NEXT = 'unit-test-pepper-v2-0123456789-abcdefgh';
  const rotated = new PasswordHasher(PEPPER, NEXT);

  it('PASSWORD_PEPPER_V2 berilsa: yangi hash — v2$; eski v1$ hash ham tekshiriladi', async () => {
    const old = await hasher.hash('483920');
    const fresh = await rotated.hash('483920');
    expect(old).toMatch(/^v1\$/);
    expect(fresh).toMatch(/^v2\$\$argon2id\$/);
    expect(await rotated.verify(old, '483920')).toBe(true);
    expect(await rotated.verify(fresh, '483920')).toBe(true);
    expect(await rotated.verify(old, '483921')).toBe(false);
  });

  it('needsRehash: faqat joriy versiyadan eski hash qayta hash qilinadi', async () => {
    expect(rotated.needsRehash(await hasher.hash('483920'))).toBe(true);
    expect(rotated.needsRehash(await rotated.hash('483920'))).toBe(false);
    expect(hasher.needsRehash(await hasher.hash('483920'))).toBe(false);
  });

  it('v2 hash v1-only hasher bilan tekshirilmaydi (pepper yo‘q); v2 = v1 yoki qisqa — rad etiladi', async () => {
    expect(await hasher.verify(await rotated.hash('483920'), '483920')).toBe(false);
    expect(() => new PasswordHasher(PEPPER, PEPPER)).toThrow(/PASSWORD_PEPPER_V2/);
    expect(() => new PasswordHasher(PEPPER, 'qisqa')).toThrow(/PASSWORD_PEPPER_V2/);
  });
});

describe('generatePassword (BR-04, A-06)', () => {
  it('AC-04: 10 000 ta generatsiya — hammasi aynan 6 raqam, boshida 0 bo‘lishi mumkin, taqsimot keng', () => {
    const samples = Array.from({ length: 10_000 }, generatePassword);
    expect(samples.every((p) => /^\d{6}$/.test(p))).toBe(true);
    // 10^6 qiymat orasidan 10 000 ta: kutiladigan takrorlar ~50 ta.
    expect(new Set(samples).size).toBeGreaterThan(9_850);
    expect(samples.some((p) => p.startsWith('0'))).toBe(true);
  });
});
