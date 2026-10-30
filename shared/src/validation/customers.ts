import { z } from 'zod';
import { nullableDescriptionSchema } from './catalog.js';
import { VALIDATION_MESSAGES_UZ as M } from './messages.uz.js';
import { customerNameSchema, phoneSchema } from './primitives.js';

// Mijozlar (Phase 9, API §10). Body sxemalari `strictObject`: noma'lum maydon (masalan, yig'ma
// `totalSpent`) → 400. Ism va telefon unique emas (A-23) — takroriy mijoz rad etilmaydi.
// Backend va frontend mock bir xil sxemadan foydalanadi.

/** Telefon: ixtiyoriy; bo'sh satr yoki null → null (PATCH'da tozalash); berilsa `+998XXXXXXXXX` (BR-06). */
export const nullablePhoneSchema = z.preprocess(
  (value) => (value === null || (typeof value === 'string' && value.trim() === '') ? null : value),
  phoneSchema.nullable(),
);

export const customerCreateSchema = z.strictObject({
  name: customerNameSchema,
  phone: nullablePhoneSchema.optional(),
  /** Faqat `customers.manage` (ADMIN) yozadi — server tekshiradi. */
  notes: nullableDescriptionSchema.optional(),
});

export const customerUpdateSchema = z
  .strictObject({
    name: customerNameSchema.optional(),
    phone: nullablePhoneSchema.optional(),
    notes: nullableDescriptionSchema.optional(),
  })
  .refine((value) => Object.values(value).some((v) => v !== undefined), {
    error: M.updateEmpty,
  });

export type CustomerCreateInput = z.infer<typeof customerCreateSchema>;
export type CustomerUpdateInput = z.infer<typeof customerUpdateSchema>;
