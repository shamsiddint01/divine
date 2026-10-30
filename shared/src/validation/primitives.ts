import { z } from 'zod';
import {
  BARCODE_MAX_LENGTH,
  ENTITY_NAME_MAX_LENGTH,
  GENERATED_PASSWORD_PATTERN,
  LOGIN_MAX_LENGTH,
  LOGIN_MIN_LENGTH,
  LOGIN_PATTERN,
  MONEY_MAX_INTEGER_DIGITS,
  MONEY_SCALE,
  NOTE_MAX_LENGTH,
  PERSON_NAME_MAX_LENGTH,
  QUANTITY_MAX_INTEGER_DIGITS,
  QUANTITY_SCALE,
} from '../constants/index.js';
import { VALIDATION_MESSAGES_UZ as M } from './messages.uz.js';

// Bu fayl — barcha modullar uchun umumiy validatsiya primitivlari.
// Modulga xos sxemalar (masalan, createSaleSchema) tegishli phase'da qo'shiladi.

/** Majburiy, trim qilinadigan matn. Maydon umuman yuborilmasa ham `requiredMessage` qaytadi. */
export const requiredText = (requiredMessage: string, maxLength: number) =>
  z
    .string({
      error: (iss) =>
        iss.input === undefined || iss.input === null ? requiredMessage : M.mustBeString,
    })
    .trim()
    .min(1, { error: requiredMessage })
    .max(maxLength, { error: M.tooLong(maxLength) });

/** Bo'sh satr yoki faqat probel → undefined. Ixtiyoriy maydonlar uchun. */
const emptyToUndefined = (value: unknown) =>
  value === null || (typeof value === 'string' && value.trim() === '') ? undefined : value;

/** Ixtiyoriy izoh/eslatma matni. */
export const optionalNoteSchema = z.preprocess(
  emptyToUndefined,
  z
    .string()
    .trim()
    .max(NOTE_MAX_LENGTH, { error: M.tooLong(NOTE_MAX_LENGTH) })
    .optional(),
);

// ─── Auth (BR-03, BR-04) ───────────────────────────────────────────────────

/**
 * Login: faqat A-Z, a-z, 0-9; probel va maxsus belgilarsiz (BR-03).
 * Trim QILINMAYDI — boshida/oxirida probel bo'lsa ham rad etiladi.
 * Uniqueness case-insensitive: DB'da `lower(login)` unique index (REQ-023).
 */
export const loginSchema = z
  .string({
    error: (iss) => (iss.input === undefined || iss.input === null ? M.required : M.mustBeString),
  })
  .min(LOGIN_MIN_LENGTH, { error: M.loginTooShort })
  .max(LOGIN_MAX_LENGTH, { error: M.loginTooLong })
  .regex(LOGIN_PATTERN, { error: M.loginFormat });

/** Login'ni uniqueness va qidiruv uchun normallashtirish. */
export const normalizeLogin = (login: string): string => login.toLowerCase();

/** Server yaratgan parol formati: aynan 6 ta raqam (BR-04). Login formasida ham ishlatiladi. */
export const generatedPasswordSchema = z
  .string({ error: M.passwordRequired })
  .regex(GENERATED_PASSWORD_PATTERN, { error: M.passwordFormat });

// ─── Identifikatorlar va sanalar ───────────────────────────────────────────

export const uuidSchema = z.uuid({ error: M.invalidId });

/** Biznes sanasi (kirim, xarajat): `YYYY-MM-DD`, Toshkent kalendari bo'yicha. */
export const dateOnlySchema = z.iso.date({ error: M.invalidDate });

/** Ixtiyoriy sana oralig'i filtri; `from <= to` tekshiriladi. */
export const dateRangeSchema = z
  .object({
    from: z.preprocess(emptyToUndefined, dateOnlySchema.optional()),
    to: z.preprocess(emptyToUndefined, dateOnlySchema.optional()),
  })
  .refine((r) => !r.from || !r.to || r.from <= r.to, {
    error: M.dateRangeOrder,
    path: ['to'],
  });

// ─── Pul va miqdor (REQ-133) ───────────────────────────────────────────────
// JSON'da pul va miqdor STRING sifatida uzatiladi — JS Number precision yo'qotishining oldini olish uchun.

const moneyPattern = new RegExp(`^\\d{1,${MONEY_MAX_INTEGER_DIGITS}}(\\.\\d{1,${MONEY_SCALE}})?$`);
const quantityPattern = new RegExp(
  `^\\d{1,${QUANTITY_MAX_INTEGER_DIGITS}}(\\.\\d{1,${QUANTITY_SCALE}})?$`,
);
const zeroPattern = /^0+(\.0+)?$/;

/** Manfiy bo'lmagan pul summasi (narxlar): `"0"`, `"12500"`, `"12500.50"`. */
export const moneySchema = z
  .string({ error: M.moneyFormat })
  .trim()
  .regex(moneyPattern, { error: M.moneyFormat });

/** Musbat pul summasi (xarajat summasi). */
export const positiveMoneySchema = moneySchema.refine((v) => !zeroPattern.test(v), {
  error: M.moneyPositive,
});

/** Manfiy bo'lmagan miqdor (masalan, kam qoldiq chegarasi — `"0"` ruxsat), ≤ 3 kasr. */
export const nonNegativeQuantitySchema = z
  .string({ error: M.quantityFormat })
  .trim()
  .regex(quantityPattern, { error: M.quantityFormat });

/** Musbat miqdor (kirim/sotuv). Butun/kasr siyosati mahsulotga qarab domain qatlamida tekshiriladi. */
export const quantitySchema = z
  .string({ error: M.quantityFormat })
  .trim()
  .regex(quantityPattern, { error: M.quantityFormat })
  .refine((v) => !zeroPattern.test(v), { error: M.quantityPositive });

/** Miqdor butun sonmi (`"5"`, `"5.000"` → true; `"5.5"` → false). `allow_decimal=false` uchun. */
export const isWholeQuantity = (quantity: string): boolean => /^\d+(\.0+)?$/.test(quantity.trim());

// ─── Matn maydonlari ───────────────────────────────────────────────────────

/** Mijoz ismi — har bir sotuvda majburiy (BR-05). */
export const customerNameSchema = requiredText(M.customerNameRequired, PERSON_NAME_MAX_LENGTH);

/** Mahsulot, guruh, ombor, kategoriya nomi. */
export const entityNameSchema = requiredText(M.nameRequired, ENTITY_NAME_MAX_LENGTH);

/** Shtrix-kod: probelsiz bosma ASCII belgilar (EAN/UPC/Code128), 1–64 belgi (BR-10, A-07). */
export const barcodeSchema = z
  .string()
  .trim()
  .min(1, { error: M.barcodeFormat })
  .max(BARCODE_MAX_LENGTH, { error: M.barcodeFormat })
  .regex(/^[\x21-\x7E]+$/, { error: M.barcodeFormat });

export const optionalBarcodeSchema = z.preprocess(emptyToUndefined, barcodeSchema.optional());

// ─── Telefon (BR-06, A-23) ─────────────────────────────────────────────────

/**
 * O'zbekiston raqamini `+998XXXXXXXXX` ko'rinishiga keltiradi.
 * Qabul qilinadi: `+998 90 123-45-67`, `998901234567`, `90 123 45 67`, `(90) 1234567`.
 * Noto'g'ri bo'lsa `null`.
 */
export function normalizeUzPhone(input: string): string | null {
  const trimmed = input.trim();
  if (!/^\+?[\d\s\-()]+$/.test(trimmed)) return null;
  const digits = trimmed.replace(/\D/g, '');
  if (digits.length === 9) return `+998${digits}`;
  if (digits.length === 12 && digits.startsWith('998')) return `+${digits}`;
  return null;
}

export const phoneSchema = z.string().transform((value, ctx) => {
  const normalized = normalizeUzPhone(value);
  if (!normalized) {
    ctx.issues.push({ code: 'custom', message: M.phoneFormat, input: value });
    return z.NEVER;
  }
  return normalized;
});

/** Ixtiyoriy telefon: bo'sh satr → undefined (BR-06). */
export const optionalPhoneSchema = z.preprocess(emptyToUndefined, phoneSchema.optional());

/** Ixtiyoriy qidiruv matni (nom yoki shtrix-kod), bo'sh → undefined. */
export const searchQuerySchema = z.preprocess(
  emptyToUndefined,
  z
    .string()
    .trim()
    .max(100, { error: M.tooLong(100) })
    .optional(),
);
