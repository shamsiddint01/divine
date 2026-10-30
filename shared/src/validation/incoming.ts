import { z } from 'zod';
import { INCOMING_ITEMS_MAX } from '../constants/index.js';
import { VALIDATION_MESSAGES_UZ as M } from './messages.uz.js';
import { nullableDescriptionSchema } from './catalog.js';
import { dateOnlySchema, moneySchema, quantitySchema, uuidSchema } from './primitives.js';

// Kirim (Phase 8, API §9). Body sxemalari `strictObject`: noma'lum maydon (masalan, client yuborgan
// `totalAmount` yoki `lineTotal`) → 400 — totallarni faqat server hisoblaydi (REQ-065).
// Backend va frontend mock bir xil sxemadan foydalanadi.

export const incomingItemInputSchema = z.strictObject({
  productId: uuidSchema,
  /** > 0, ≤ 3 kasr xona; butun/kasr siyosati mahsulotga qarab serverda (BR-13). */
  quantity: quantitySchema,
  /** Kelgan narxi: ≥ 0, ≤ 2 kasr xona (DB `incoming_items_cost_price_valid`). */
  costPrice: moneySchema,
});

/** 1–500 qator, bitta mahsulot bir marta (BR-18, A-09). */
export const incomingItemsSchema = z
  .array(incomingItemInputSchema, { error: M.incomingItemsRequired })
  .min(1, { error: M.incomingItemsRequired })
  .max(INCOMING_ITEMS_MAX, { error: M.incomingItemsTooMany(INCOMING_ITEMS_MAX) })
  .superRefine((items, ctx) => {
    const seen = new Set<string>();
    items.forEach((item, index) => {
      if (seen.has(item.productId)) {
        ctx.addIssue({ code: 'custom', path: [index, 'productId'], message: M.duplicateProduct });
      }
      seen.add(item.productId);
    });
  });

export const incomingCreateSchema = z.strictObject({
  date: dateOnlySchema,
  warehouseId: uuidSchema,
  notes: nullableDescriptionSchema.optional(),
  items: incomingItemsSchema,
});

/** Qoralamani tahrirlash: header maydonlari ixtiyoriy; `items` berilsa — to'liq almashtiriladi. */
export const incomingUpdateSchema = z
  .strictObject({
    date: dateOnlySchema.optional(),
    warehouseId: uuidSchema.optional(),
    notes: nullableDescriptionSchema.optional(),
    items: incomingItemsSchema.optional(),
  })
  .refine((value) => Object.values(value).some((v) => v !== undefined), {
    error: M.updateEmpty,
  });

export type IncomingItemInput = z.infer<typeof incomingItemInputSchema>;
export type IncomingCreateInput = z.infer<typeof incomingCreateSchema>;
export type IncomingUpdateInput = z.infer<typeof incomingUpdateSchema>;
