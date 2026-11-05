import {
  VALIDATION_MESSAGES_UZ as M,
  moneySchema,
  positiveMoneySchema,
  quantitySchema,
} from '@divine/shared';
import { z } from './zod';
import { normalizeNumberInput } from '@/shared/lib/decimal';

// Forma maydonlari: foydalanuvchi "1 250 000,50" kabi kiritadi; tekshiruv shared sxemalar bilan,
// yuborishdan oldin `toDecimal` kanonik ko'rinishga ("1250000.50") keltiradi.

export const toDecimal = (value: string): string => normalizeNumberInput(value) ?? value.trim();

const decimalField = (schema: z.ZodType, message: string) =>
  z
    .string()
    .refine((v) => schema.safeParse(normalizeNumberInput(v) ?? '').success, { error: message });

export const moneyField = () => decimalField(moneySchema, M.moneyFormat);
export const positiveMoneyField = () => decimalField(positiveMoneySchema, M.moneyPositive);
export const optionalMoneyField = () =>
  z
    .string()
    .refine(
      (v) => v.trim() === '' || moneySchema.safeParse(normalizeNumberInput(v) ?? '').success,
      { error: M.moneyFormat },
    );
export const quantityField = () => decimalField(quantitySchema, M.quantityFormat);
export const optionalQuantityField = () =>
  z
    .string()
    .refine(
      (v) => v.trim() === '' || quantitySchema.safeParse(normalizeNumberInput(v) ?? '').success,
      {
        error: M.quantityFormat,
      },
    );

/** Kiritilgan pulni ko'rsatish uchun guruhlash: "1250000" → "1 250 000". */
export function groupDigits(value: string): string {
  const normalized = normalizeNumberInput(value);
  if (!normalized) return value;
  const [int = '', frac] = normalized.split('.');
  const grouped = int.replace(/\B(?=(\d{3})+(?!\d))/g, ' ');
  return frac !== undefined ? `${grouped},${frac}` : grouped;
}
