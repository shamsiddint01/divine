import { z } from 'zod';
import {
  dateOnlySchema,
  entityNameSchema,
  moneySchema,
  phoneSchema,
  positiveMoneySchema,
} from './primitives.js';

// Superadmin paneli va sayt o'rtasidagi shartnoma (`/control/*`, `/site-control/*`).

const urlSchema = z
  .url({ error: 'To‘g‘ri manzil kiriting' })
  .refine((value) => /^https?:\/\//.test(value), { error: 'To‘g‘ri manzil kiriting' })
  .transform((value) => value.replace(/\/+$/, ''));

const nullablePhone = z.preprocess(
  (value) => (value === '' ? null : value),
  phoneSchema.nullable(),
);
const nullableNotes = z.preprocess(
  (value) => (value === '' ? null : value),
  z.string().trim().max(1000).nullable(),
);

export const siteLicensePaymentSchema = z.strictObject({
  amount: moneySchema,
  paidAt: dateOnlySchema,
  paidUntil: dateOnlySchema,
});

export const siteLicenseSchema = z.strictObject({
  ownerName: entityNameSchema,
  paidUntil: dateOnlySchema,
  agreedPrice: moneySchema.nullable().optional(),
  balance: moneySchema.optional(),
  lastPaidAt: dateOnlySchema.nullable().optional(),
  manualBlock: z.boolean().optional(),
  graceUntil: dateOnlySchema.nullable().optional(),
  payments: z.array(siteLicensePaymentSchema).max(24).optional(),
});

/** GitHub Actions bekap natijasi (`POST /site-control/backup-report`). */
export const backupReportSchema = z.strictObject({
  ok: z.boolean(),
  sizeBytes: z.number().int().min(0).optional(),
  runUrl: z.url().optional(),
});

export const siteViewVerifySchema = z.strictObject({
  code: z.string().regex(/^\d{6}$/, { error: 'Kod 6 ta raqamdan iborat' }),
});

export const controlLoginSchema = z.strictObject({
  login: z.string().trim().min(1).max(32),
  password: z.string().min(1).max(200),
});

const controlSiteFields = {
  name: entityNameSchema,
  siteUrl: urlSchema,
  apiUrl: urlSchema,
  ownerName: entityNameSchema,
  ownerPhone: nullablePhone.optional(),
  agreedPrice: moneySchema,
  paidUntil: dateOnlySchema,
  notes: nullableNotes.optional(),
};

export const controlSiteCreateSchema = z.strictObject({
  ...controlSiteFields,
  apiToken: z.string().trim().min(32).max(200),
});

export const controlSiteUpdateSchema = z
  .strictObject({
    ...controlSiteFields,
    /** Muddatdan qat'i nazar sayt yopiq (egasining qarori, 2026-11-07). */
    manualBlock: z.boolean(),
    /** Yengillik: shu kungacha muddat o'tgan bo'lsa ham ishlaydi. */
    graceUntil: dateOnlySchema.nullable(),
  })
  .partial();

export const controlPaymentSchema = z.strictObject({
  amount: positiveMoneySchema,
  paidAt: dateOnlySchema,
  note: z
    .preprocess((value) => (value === '' ? null : value), z.string().trim().max(500).nullable())
    .optional(),
});

/** Oy oxiri saqlanadi: 31-yanvar → 28-fevral. */
export function addOneMonth(date: string): string {
  const [year, month, day] = date.split('-').map(Number) as [number, number, number];
  const lastDay = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
  return new Date(Date.UTC(year, month, Math.min(day, lastDay))).toISOString().slice(0, 10);
}

/**
 * To'lov har doim bir oyga (egasining qarori, 2026-11-07). Vaqtida to'lansa to'lov kuni o'zgarmaydi,
 * muddat o'tib to'lansa bir oy to'lov kunidan hisoblanadi.
 */
export function nextPaidUntil(currentPaidUntil: string, paidAt: string): string {
  return addOneMonth(currentPaidUntil > paidAt ? currentPaidUntil : paidAt);
}

const toCents = (value: string): bigint => {
  const [whole = '0', fraction = ''] = value.split('.');
  return BigInt(whole) * 100n + BigInt(fraction.padEnd(2, '0').slice(0, 2) || '0');
};
const fromCents = (cents: bigint): string =>
  `${cents / 100n}.${String(cents % 100n).padStart(2, '0')}`;

/**
 * To'lov balansga tushadi; har to'liq kelishilgan narx — bir oy (egasining qarori, 2026-11-07).
 * Ortig'i keyingi oyga qoladi, kami narx yig'ilguncha balansda turadi. Narx 0 bo'lsa — har to'lov bir oy.
 */
export function applyPayment(input: {
  paidUntil: string;
  balance: string;
  agreedPrice: string;
  paidAt: string;
  amount: string;
}): { paidUntil: string; balance: string; months: number } {
  const price = toCents(input.agreedPrice);
  let balance = toCents(input.balance) + toCents(input.amount);
  let paidUntil = input.paidUntil;
  let months = 0;
  const extend = () => {
    paidUntil = months === 0 ? nextPaidUntil(paidUntil, input.paidAt) : addOneMonth(paidUntil);
    months += 1;
  };
  if (price === 0n) {
    extend();
    return { paidUntil, balance: fromCents(balance), months };
  }
  while (balance >= price && months < 120) {
    balance -= price;
    extend();
  }
  return { paidUntil, balance: fromCents(balance), months };
}

/** Keyingi oy uchun yana qancha to'lash kerak. */
export function amountDue(agreedPrice: string, balance: string): string {
  const due = toCents(agreedPrice) - toCents(balance);
  return fromCents(due > 0n ? due : 0n);
}

export type SiteLicenseInput = z.infer<typeof siteLicenseSchema>;
export type BackupReportInput = z.infer<typeof backupReportSchema>;
export type SiteViewVerifyInput = z.infer<typeof siteViewVerifySchema>;
export type ControlLoginInput = z.infer<typeof controlLoginSchema>;
export type ControlSiteCreateInput = z.infer<typeof controlSiteCreateSchema>;
export type ControlSiteUpdateInput = z.infer<typeof controlSiteUpdateSchema>;
export type ControlPaymentInput = z.infer<typeof controlPaymentSchema>;
