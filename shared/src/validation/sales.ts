import { z } from 'zod';
import { VALIDATION_MESSAGES_UZ as M } from './messages.uz.js';
import { SALE_PRICE_TYPES } from '../enums/index.js';
import { saleCreditSchema } from './credits.js';
import { nullablePhoneSchema } from './customers.js';
import { customerNameSchema, quantitySchema, uuidSchema } from './primitives.js';

// Sotuv (Phase 10, API §11). Body `strictObject`: client narx, tannarx yoki total yubora olmaydi —
// noma'lum maydon → 400 (BR-15, A-18). Backend va frontend mock bir xil sxemadan foydalanadi.

/** Bitta sotuvdagi qatorlar soni chegarasi (takroriylar birlashtirilishidan oldin). */
export const SALE_ITEMS_MAX = 200;

/**
 * Ism kiritilmagan sotuvlar shu nomli umumiy mijozga yoziladi (egasining qarori, 2026-11-03): telefon ham
 * bo'lmasa — bitta umumiy yozuv; telefon bo'lsa — shu raqamli mavjud mijoz yoki shu nom bilan yangisi.
 */
export const WALK_IN_CUSTOMER_NAME = 'Noma’lum mijoz';

/**
 * Mijoz: mavjud mijoz `{ id }` **yoki** yangi mijoz `{ name?, phone? }` (BR-05, BR-06). Ikkalasi birga
 * yuborilmaydi. Ism ixtiyoriy: bo'sh bo'lsa `name: null` (server umumiy mijozni tanlaydi).
 */
export const saleCustomerSchema = z
  .strictObject({
    id: uuidSchema.optional(),
    name: z.unknown().optional(),
    phone: nullablePhoneSchema.optional(),
  })
  .transform((value, ctx): { id: string } | { name: string | null; phone: string | null } => {
    if (value.id !== undefined) {
      if (value.name !== undefined || value.phone !== undefined) {
        ctx.addIssue({ code: 'custom', path: ['id'], message: M.saleCustomerExclusive });
        return z.NEVER;
      }
      return { id: value.id };
    }
    const phone = value.phone ?? null;
    if (
      value.name === undefined ||
      value.name === null ||
      (typeof value.name === 'string' && value.name.trim() === '')
    ) {
      return { name: null, phone };
    }
    const name = customerNameSchema.safeParse(value.name);
    if (!name.success) {
      ctx.addIssue({
        code: 'custom',
        path: ['name'],
        message: name.error.issues[0]?.message ?? M.customerNameRequired,
      });
      return z.NEVER;
    }
    return { name: name.data, phone };
  });

export const saleItemInputSchema = z.strictObject({
  productId: uuidSchema,
  /** > 0, ≤ 3 kasr xona; butun/kasr siyosati — mahsulotga qarab serverda (BR-13). */
  quantity: quantitySchema,
});

export const saleCreateSchema = z.strictObject({
  warehouseId: uuidSchema,
  customer: saleCustomerSchema,
  /** Client faqat narx TURINI aytadi; narxning o'zini server kartochkadan oladi (BR-15, D-25). */
  priceType: z.enum(SALE_PRICE_TYPES).default('RETAIL'),
  /** Mijoz puli yetmasa: to'langan summa va qolgani uchun nasiya shartlari (D-26). */
  credit: saleCreditSchema.optional(),
  items: z
    .array(saleItemInputSchema, { error: M.saleItemsRequired })
    .min(1, { error: M.saleItemsRequired })
    .max(SALE_ITEMS_MAX, { error: M.arrayTooBig(SALE_ITEMS_MAX) }),
});

/** `Idempotency-Key` header: UUID (REQ-145). */
export const idempotencyKeySchema = z.uuid({ error: M.idempotencyKeyFormat });

export type SaleCustomerInput = z.infer<typeof saleCustomerSchema>;
export type SaleCreateInput = z.infer<typeof saleCreateSchema>;
