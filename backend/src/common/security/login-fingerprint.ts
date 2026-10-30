import { createHmac, hkdfSync } from 'node:crypto';

/**
 * SEC-01 (SECURITY §15.1): mavjud bo'lmagan login uchun kiritilgan qiymat audit va Redis'da ochiq
 * saqlanmaydi — foydalanuvchi parolni login maydoniga yozgan bo'lishi mumkin.
 *
 * - Parol shaklidagi qiymat (aynan 6 raqam, BR-04) — faqat `loginMasked` va uzunlik: barmoq izi ham
 *   yozilmaydi, chunki 10⁶ variantni kalit ma'lum bo'lsa bir zumda tiklash mumkin, audit esa o'zgarmas.
 * - Boshqa qiymat — kalitli barmoq izi (HMAC-SHA256, 128 bit): takroriy urinishlar bog'lanadi,
 *   qiymatning o'zi ochilmaydi. Katta-kichik harf farqsiz (login kabi, BR-03).
 *
 * Kalit `PASSWORD_PEPPER` dan HKDF bilan shu maqsad uchun alohida hosil qilinadi (pepper'ning o'zi
 * ishlatilmaydi; yangi env sir kerak emas). Kalit faqat xotirada — DB, log va javoblarda yo'q.
 */
const PASSWORD_SHAPED = /^\d{6}$/;
const KEY_INFO = 'divine.uz/unknown-login-fingerprint/v1';

export type UnknownLoginMetadata =
  { loginMasked: true; loginLength: number } | { loginFingerprint: string; loginLength: number };

export class LoginFingerprint {
  private readonly key: Buffer;

  constructor(pepper: string) {
    if (!pepper || pepper.length < 32) {
      throw new Error("PASSWORD_PEPPER kamida 32 belgi bo'lishi kerak");
    }
    this.key = Buffer.from(hkdfSync('sha256', pepper, '', KEY_INFO, 32));
  }

  /** To'liq iz (hex, 256 bit) — Redis lockout kaliti uchun. */
  of(login: string): string {
    return createHmac('sha256', this.key).update(login.toLowerCase(), 'utf8').digest('hex');
  }

  /** Audit metadata'si: xom qiymat o'rniga. */
  metadata(login: string): UnknownLoginMetadata {
    return PASSWORD_SHAPED.test(login)
      ? { loginMasked: true, loginLength: login.length }
      : { loginFingerprint: this.of(login).slice(0, 32), loginLength: login.length };
  }
}
