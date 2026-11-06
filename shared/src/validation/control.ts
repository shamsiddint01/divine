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

export const siteLicenseSchema = z.strictObject({
  ownerName: entityNameSchema,
  paidUntil: dateOnlySchema,
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

export const controlSiteUpdateSchema = z.strictObject(controlSiteFields).partial();

export const controlPaymentSchema = z.strictObject({
  amount: positiveMoneySchema,
  paidAt: dateOnlySchema,
  /** Shu to'lov qaysi sanagacha yopadi: blok shu sanadan keyin. */
  paidUntil: dateOnlySchema,
  note: z.preprocess(
    (value) => (value === '' ? null : value),
    z.string().trim().max(500).nullable(),
  ).optional(),
});

export type SiteLicenseInput = z.infer<typeof siteLicenseSchema>;
export type SiteViewVerifyInput = z.infer<typeof siteViewVerifySchema>;
export type ControlLoginInput = z.infer<typeof controlLoginSchema>;
export type ControlSiteCreateInput = z.infer<typeof controlSiteCreateSchema>;
export type ControlSiteUpdateInput = z.infer<typeof controlSiteUpdateSchema>;
export type ControlPaymentInput = z.infer<typeof controlPaymentSchema>;
