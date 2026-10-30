import { z } from 'zod';
import { VALIDATION_MESSAGES_UZ as M } from './messages.uz.js';
import { nullablePhoneSchema } from './customers.js';
import { customerNameSchema, quantitySchema, uuidSchema } from './primitives.js';

// Sotuv (Phase 10, API §11). Body `strictObject`: client narx, tannarx yoki total yubora olmaydi —
// noma'lum maydon → 400 (BR-15, A-18). Backend va frontend mock bir xil sxemadan foydalanadi.

/** Bitta sotuvdagi qatorlar soni chegarasi (takroriylar birlashtirilishidan oldin). */
export const SALE_ITEMS_MAX = 200;

/**
 * Mijoz: mavjud mijoz `{ id }` **yoki** yangi mijoz `{ name, phone? }` (BR-05, BR-06). Ikkalasi birga
 * yuborilmaydi; ism bo'lmasa — `customer.name` maydonida "Mijoz ismi majburiy".
 */
export const saleCustomerSchema = z
  .strictObject({
    id: uuidSchema.optional(),
    name: z.unknown().optional(),
    phone: nullablePhoneSchema.optional(),
  })
  .transform((value, ctx): { id: string } | { name: string; phone: string | null } => {
    if (value.id !== undefined) {
      if (value.name !== undefined || value.phone !== undefined) {
        ctx.addIssue({ code: 'custom', path: ['id'], message: M.saleCustomerExclusive });
        return z.NEVER;
      }
      return { id: value.id };
    }
    const name = customerNameSchema.safeParse(value.name ?? '');
    if (!name.success) {
      ctx.addIssue({ code: 'custom', path: ['name'], message: M.customerNameRequired });
      return z.NEVER;
    }
    return { name: name.data, phone: value.phone ?? null };
  });

export const saleItemInputSchema = z.strictObject({
  productId: uuidSchema,
  /** > 0, ≤ 3 kasr xona; butun/kasr siyosati — mahsulotga qarab serverda (BR-13). */
  quantity: quantitySchema,
});

export const saleCreateSchema = z.strictObject({
  warehouseId: uuidSchema,
  customer: saleCustomerSchema,
  items: z
    .array(saleItemInputSchema, { error: M.saleItemsRequired })
    .min(1, { error: M.saleItemsRequired })
    .max(SALE_ITEMS_MAX, { error: M.arrayTooBig(SALE_ITEMS_MAX) }),
});

/** `Idempotency-Key` header: UUID (REQ-145). */
export const idempotencyKeySchema = z.uuid({ error: M.idempotencyKeyFormat });

export type SaleCustomerInput = z.infer<typeof saleCustomerSchema>;
export type SaleCreateInput = z.infer<typeof saleCreateSchema>;
