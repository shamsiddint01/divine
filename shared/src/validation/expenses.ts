import { z } from 'zod';
import { EXPENSE_CATEGORY_NAME_MAX_LENGTH } from '../constants/index.js';
import { nullableDescriptionSchema } from './catalog.js';
import { VALIDATION_MESSAGES_UZ as M } from './messages.uz.js';
import { dateOnlySchema, positiveMoneySchema, requiredText } from './primitives.js';

// Xarajatlar (Phase 11, API §12; D-11, D-12, D-19). Body sxemalari `strictObject`: noma'lum maydon
// (masalan, bekor qilingan `status` — D-11) → 400. Kategoriya har bir xarajatda majburiy (D-19).
// "Sana bugundan keyin emas" qoidasi joriy Toshkent kuniga bog'liq — server (`Clock`) va mock tekshiradi.
// Backend va frontend mock bir xil sxemadan foydalanadi.

export const expenseCategoryNameSchema = requiredText(
  M.nameRequired,
  EXPENSE_CATEGORY_NAME_MAX_LENGTH,
);

const categoryIdSchema = z.uuid({ error: M.expenseCategoryRequired });

export const expenseCreateSchema = z.strictObject({
  date: dateOnlySchema,
  amount: positiveMoneySchema,
  categoryId: categoryIdSchema,
  /** Ixtiyoriy; bo'sh → null. */
  note: nullableDescriptionSchema.optional(),
});

/** `PATCH /expenses/:id` — qisman: faqat yuborilgan maydonlar o'zgaradi; `note: null` — tozalash. */
export const expenseUpdateSchema = z
  .strictObject({
    date: dateOnlySchema.optional(),
    amount: positiveMoneySchema.optional(),
    categoryId: categoryIdSchema.optional(),
    note: nullableDescriptionSchema.optional(),
  })
  .refine((value) => Object.values(value).some((v) => v !== undefined), {
    error: M.updateEmpty,
  });

export const expenseCategoryCreateSchema = z.strictObject({ name: expenseCategoryNameSchema });

export const expenseCategoryUpdateSchema = z
  .strictObject({
    name: expenseCategoryNameSchema.optional(),
    /** `false` — nofaol: yangi xarajatda tanlanmaydi, eski xarajatlarda saqlanadi. */
    isActive: z.boolean().optional(),
  })
  .refine((value) => Object.values(value).some((v) => v !== undefined), {
    error: M.updateEmpty,
  });

/** D-19: xarajat sanasi Toshkent bo'yicha bugundan keyin bo'lmaydi (`today` — `YYYY-MM-DD`). */
export const isExpenseDateAllowed = (date: string, today: string): boolean => date <= today;

export type ExpenseCreateInput = z.infer<typeof expenseCreateSchema>;
export type ExpenseUpdateInput = z.infer<typeof expenseUpdateSchema>;
export type ExpenseCategoryCreateInput = z.infer<typeof expenseCategoryCreateSchema>;
export type ExpenseCategoryUpdateInput = z.infer<typeof expenseCategoryUpdateSchema>;
