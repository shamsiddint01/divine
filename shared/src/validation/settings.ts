import { z } from 'zod';
import { VALIDATION_MESSAGES_UZ as M } from './messages.uz.js';
import { entityNameSchema, nonNegativeQuantitySchema, requiredText } from './primitives.js';

// Sozlamalar (Phase 12, API §16, D-21): faqat 3 ta maydon. `strictObject` — boshqa kalit → 400.

export const CURRENCY_LABEL_MAX_LENGTH = 10;

export const settingsUpdateSchema = z
  .strictObject({
    /** 1–200 belgi. */
    companyName: entityNameSchema.optional(),
    /** `min_stock` berilmagan mahsulotlar uchun kam qoldiq chegarasi (A-15), ≥ 0. */
    lowStockDefaultThreshold: nonNegativeQuantitySchema.optional(),
    currencyLabel: requiredText(M.nameRequired, CURRENCY_LABEL_MAX_LENGTH).optional(),
  })
  .refine((value) => Object.values(value).some((v) => v !== undefined), {
    error: M.updateEmpty,
  });

export type SettingsUpdateInput = z.infer<typeof settingsUpdateSchema>;

/** `"5.500"` → `"5.5"`, `"5.000"` → `"5"` — kam qoldiq chegarasi seed bilan bir xil ko'rinishda saqlanadi. */
export function normalizeThreshold(value: string): string {
  return value.includes('.') ? value.replace(/\.?0+$/, '') : value.replace(/^0+(?=\d)/, '');
}
