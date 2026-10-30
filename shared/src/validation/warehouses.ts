import { z } from 'zod';
import { WAREHOUSE_STATUSES } from '../enums/index.js';
import { VALIDATION_MESSAGES_UZ as M } from './messages.uz.js';
import { entityNameSchema } from './primitives.js';

// Omborlar (Phase 7, API §7). Body sxemalari `strictObject`: noma'lum maydon → 400.
// Backend va frontend mock bir xil sxemadan foydalanadi.

/** DB: `warehouses.address VARCHAR(300)`. */
export const WAREHOUSE_ADDRESS_MAX_LENGTH = 300;

/** Manzil: ixtiyoriy, ≤ 300; bo'sh satr yoki null → null (PATCH'da tozalash mumkin). */
export const nullableAddressSchema = z.preprocess(
  (value) => (value === null || (typeof value === 'string' && value.trim() === '') ? null : value),
  z
    .string()
    .trim()
    .max(WAREHOUSE_ADDRESS_MAX_LENGTH, { error: M.tooLong(WAREHOUSE_ADDRESS_MAX_LENGTH) })
    .nullable(),
);

export const warehouseCreateSchema = z.strictObject({
  name: entityNameSchema,
  address: nullableAddressSchema.optional(),
});

export const warehouseUpdateSchema = z
  .strictObject({
    name: entityNameSchema.optional(),
    address: nullableAddressSchema.optional(),
  })
  .refine((value) => Object.values(value).some((v) => v !== undefined), {
    error: M.updateEmpty,
  });

/** `ACTIVE` ↔ `INACTIVE`: nofaol omborga kirim ham, sotuv ham qilinmaydi (BR-21). */
export const warehouseStatusSchema = z.strictObject({ status: z.enum(WAREHOUSE_STATUSES) });

export type WarehouseCreateInput = z.infer<typeof warehouseCreateSchema>;
export type WarehouseUpdateInput = z.infer<typeof warehouseUpdateSchema>;
export type WarehouseStatusInput = z.infer<typeof warehouseStatusSchema>;
