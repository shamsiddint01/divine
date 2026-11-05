import { z } from 'zod';
import { NOTE_MAX_LENGTH } from '../constants/index.js';
import { PRODUCT_STATUSES, PRODUCT_UNITS } from '../enums/index.js';
import { VALIDATION_MESSAGES_UZ as M } from './messages.uz.js';
import {
  barcodeSchema,
  dateOnlySchema,
  entityNameSchema,
  moneySchema,
  positiveMoneySchema,
  quantitySchema,
  uuidSchema,
} from './primitives.js';

// Mahsulotlar va guruhlar (Phase 6, API §5–6). Body sxemalari `strictObject`: noma'lum maydon → 400.
// Backend va frontend mock bir xil sxemadan foydalanadi.

/** Bo'sh satr yoki null → `null` (maydonni tozalash). */
const emptyToNull = (value: unknown) =>
  value === null || (typeof value === 'string' && value.trim() === '') ? null : value;

/** Tavsif: ixtiyoriy, ≤ 1000; bo'sh → null (PATCH'da tozalash mumkin). */
export const nullableDescriptionSchema = z.preprocess(
  emptyToNull,
  z
    .string()
    .trim()
    .max(NOTE_MAX_LENGTH, { error: M.tooLong(NOTE_MAX_LENGTH) })
    .nullable(),
);

/** Shtrix-kod: ixtiyoriy (D-05); berilsa probelsiz, ≤ 64, barcha mahsulotlar orasida unique (D-09). */
export const nullableBarcodeSchema = z.preprocess(emptyToNull, barcodeSchema.nullable());

/** Minimal qoldiq: ixtiyoriy musbat miqdor; bo'sh → null (global sozlama ishlatiladi). */
export const nullableMinStockSchema = z.preprocess(emptyToNull, quantitySchema.nullable());

/** Dona narxi: ixtiyoriy, ≥ 0; bo'sh → null. Kamida bitta narx bo'lishi shart (D-25). */
export const nullableSalePriceSchema = z.preprocess(emptyToNull, moneySchema.nullable());

/** Optom narxi: ixtiyoriy, > 0; bo'sh → null. */
export const nullableWholesalePriceSchema = z.preprocess(
  emptyToNull,
  positiveMoneySchema.nullable(),
);

export const productGroupCreateSchema = z.strictObject({
  name: entityNameSchema,
  description: nullableDescriptionSchema.optional(),
});

export const productGroupUpdateSchema = z
  .strictObject({
    name: entityNameSchema.optional(),
    description: nullableDescriptionSchema.optional(),
    /** `false` — arxivlash: yangi mahsulot bu guruhga qo'shilmaydi, mavjudlari saqlanadi. */
    isActive: z.boolean().optional(),
  })
  .refine((input) => Object.values(input).some((value) => value !== undefined), {
    error: M.updateEmpty,
  });

const productFields = {
  name: entityNameSchema,
  groupId: z.uuid({ error: M.groupRequired }),
  barcode: nullableBarcodeSchema.optional(),
  costPrice: moneySchema,
  salePrice: nullableSalePriceSchema.optional(),
  wholesalePrice: nullableWholesalePriceSchema.optional(),
  unit: z.enum(PRODUCT_UNITS),
  allowDecimal: z.boolean(),
  minStock: nullableMinStockSchema.optional(),
  status: z.enum(PRODUCT_STATUSES),
};

/** `unit = DONA` bo'lsa kasr miqdor mumkin emas (BR-13). */
const unitAllowsDecimal = (input: { unit?: string; allowDecimal?: boolean }) =>
  !(input.unit === 'DONA' && input.allowDecimal === true);

/**
 * Qoldiq qo'shish (sobiq "Kirim" bo'limining o'rnini bosadi): bitta mahsulot, bitta ombor. Server uni
 * darhol tasdiqlangan kirim hujjati sifatida yozadi (ledger, hisobotlar, audit — avvalgidek).
 */
const stockReceiptFields = {
  warehouseId: uuidSchema,
  /** > 0, ≤ 3 kasr xona; butun/kasr siyosati mahsulotga qarab serverda (BR-13). */
  quantity: quantitySchema,
  date: dateOnlySchema,
  notes: nullableDescriptionSchema.optional(),
};

/** Yangi mahsulot bilan birga boshlang'ich qoldiq — kelgan narxi mahsulotning o'zidan olinadi. */
export const initialStockSchema = z.strictObject(stockReceiptFields);

/** `POST /products/:id/stock`: mavjud mahsulotga qoldiq; kelgan narxi shu partiya uchun. */
export const stockReceiptSchema = z.strictObject({ ...stockReceiptFields, costPrice: moneySchema });

export const productCreateSchema = z
  .strictObject({
    ...productFields,
    status: productFields.status.default('ACTIVE'),
    initialStock: initialStockSchema.optional(),
  })
  .refine(unitAllowsDecimal, { error: M.unitDecimalConflict, path: ['allowDecimal'] })
  .refine((input) => (input.salePrice ?? input.wholesalePrice ?? null) !== null, {
    error: M.productPriceRequired,
    path: ['salePrice'],
  })
  .refine((input) => !input.initialStock || input.status === 'ACTIVE', {
    error: M.initialStockInactive,
    path: ['initialStock'],
  });

/**
 * `PATCH /products/:id`: istalgan maydonlar (forma hammasini yuboradi). `unit`/`allowDecimal`
 * mosligi mavjud qiymatlar bilan birga service'da ham tekshiriladi.
 */
export const productUpdateSchema = z
  .strictObject(productFields)
  .partial()
  .refine((input) => Object.values(input).some((value) => value !== undefined), {
    error: M.updateEmpty,
  })
  .refine(unitAllowsDecimal, { error: M.unitDecimalConflict, path: ['allowDecimal'] });

export const productStatusSchema = z.strictObject({ status: z.enum(PRODUCT_STATUSES) });

export type ProductGroupCreateInput = z.infer<typeof productGroupCreateSchema>;
export type ProductGroupUpdateInput = z.infer<typeof productGroupUpdateSchema>;
export type ProductCreateInput = z.infer<typeof productCreateSchema>;
export type ProductUpdateInput = z.infer<typeof productUpdateSchema>;
export type ProductStatusInput = z.infer<typeof productStatusSchema>;
export type InitialStockInput = z.infer<typeof initialStockSchema>;
export type StockReceiptInput = z.infer<typeof stockReceiptSchema>;
