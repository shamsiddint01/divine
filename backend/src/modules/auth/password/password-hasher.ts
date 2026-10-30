import { createHmac, randomInt } from 'node:crypto';
import { type Algorithm, hash, verify } from '@node-rs/argon2';
import { GENERATED_PASSWORD_LENGTH } from '@divine/shared';

/** `Algorithm.Argon2id` — paketdagi ambient const enum (isolatedModules'da import qilib bo'lmaydi). */
const ARGON2ID = 2 as Algorithm;

/**
 * argon2id parametrlari (SECURITY §5.2): 64 MiB, 3 iteratsiya, 1 oqim.
 * Phase 4 o'lchovi (dev noutbuk): verify ≈ 170–210 ms — hujjatdagi 50–100 ms maqsaddan sekinroq,
 * lekin parametrlar kamaytirilmadi (offline hujumga qarshilik muhimroq; login tez-tez emas).
 */
export const ARGON2_OPTIONS = {
  algorithm: ARGON2ID,
  memoryCost: 65_536,
  timeCost: 3,
  parallelism: 1,
} as const;

const STORED_FORMAT = /^(v\d+)\$(\$argon2id\$.+)$/;

/**
 * Parol hash'i: `v1$` + argon2id(HMAC-SHA256(pepper, parol)) — SECURITY §6.
 *
 * - Pepper faqat env'dan (DB'da, kodda va image'da emas). DB o'g'irlansa ham pepper'siz brute force imkonsiz.
 * - Tekshirish `argon2.verify` (constant-time taqqoslash).
 * - Format yoki versiya noto'g'ri bo'lsa — `false` (istisno emas): login javobi o'zgarmaydi.
 * - Rotation (SECURITY §13, Phase 17): `PASSWORD_PEPPER_V2` berilsa, yangi hash'lar `v2$`; `v1$` hash'lar
 *   tekshiriladi va muvaffaqiyatli login'da qayta hash qilinadi (`needsRehash`). V1 pepper saqlanadi.
 */
export class PasswordHasher {
  private readonly peppers: ReadonlyMap<string, string>;
  /** Yangi hash'lar shu versiya bilan: V2 berilsa `v2`, aks holda `v1`. */
  private readonly current: string;
  private dummyHash: Promise<string> | undefined;

  constructor(pepper: string, nextPepper?: string) {
    if (!pepper || pepper.length < 32) {
      throw new Error("PASSWORD_PEPPER kamida 32 belgi bo'lishi kerak");
    }
    if (nextPepper !== undefined && (nextPepper.length < 32 || nextPepper === pepper)) {
      throw new Error(
        "PASSWORD_PEPPER_V2 kamida 32 belgi va PASSWORD_PEPPER'dan farqli bo'lishi kerak",
      );
    }
    this.peppers = new Map([['v1', pepper], ...(nextPepper ? [['v2', nextPepper] as const] : [])]);
    this.current = nextPepper ? 'v2' : 'v1';
  }

  private peppered(version: string, password: string): string {
    const pepper = this.peppers.get(version);
    if (!pepper) throw new Error(`Noma'lum pepper versiyasi: ${version}`);
    return createHmac('sha256', pepper).update(password, 'utf8').digest('base64');
  }

  async hash(password: string): Promise<string> {
    const encoded = await hash(this.peppered(this.current, password), ARGON2_OPTIONS);
    return `${this.current}$${encoded}`;
  }

  async verify(stored: string, password: string): Promise<boolean> {
    const match = STORED_FORMAT.exec(stored);
    if (!match || !this.peppers.has(match[1]!)) return false;
    try {
      return await verify(match[2]!, this.peppered(match[1]!, password));
    } catch {
      return false;
    }
  }

  /** Hash joriy pepper versiyasidan eski — muvaffaqiyatli login'dan keyin qayta hash qilinadi. */
  needsRehash(stored: string): boolean {
    return STORED_FORMAT.exec(stored)?.[1] !== this.current;
  }

  /**
   * Mavjud bo'lmagan login uchun: haqiqiy hash bilan bir xil narxdagi tekshiruv (natija doim `false`).
   * Javob vaqti bo'yicha login mavjudligini aniqlab bo'lmaydi (SECURITY §1, user enumeration).
   */
  async verifyAgainstDummy(password: string): Promise<false> {
    this.dummyHash ??= this.hash(`dummy-${randomInt(1_000_000)}`);
    await this.verify(await this.dummyHash, password);
    return false;
  }

  /** Ilova ishga tushganda dummy hash'ni oldindan tayyorlash (birinchi login sekin bo'lmasin). */
  async warmUp(): Promise<void> {
    this.dummyHash ??= this.hash(`dummy-${randomInt(1_000_000)}`);
    await this.dummyHash;
  }
}

/**
 * Server generatsiya qiladigan parol: aynan 6 raqam (BR-04, REQ-024), `000000`–`999999` (A-06).
 * `crypto.randomInt` — CSPRNG, bir tekis taqsimot (modulo bias yo'q).
 */
export function generatePassword(): string {
  return randomInt(0, 10 ** GENERATED_PASSWORD_LENGTH)
    .toString()
    .padStart(GENERATED_PASSWORD_LENGTH, '0');
}
