import { z } from 'zod';
import { PERSON_NAME_MAX_LENGTH } from '../constants/index.js';
import { ROLE_CODES, USER_STATUSES } from '../enums/index.js';
import { VALIDATION_MESSAGES_UZ as M } from './messages.uz.js';
import { loginSchema, uuidSchema } from './primitives.js';

// Users moduli (Phase 5, API §4). Backend body sxemalari — `strictObject`: noma'lum maydon (masalan,
// `password`, `passwordHash`, `permissions`) `400 VALIDATION_ERROR` bilan rad etiladi.

/** Bir userga biriktirish mumkin bo'lgan omborlar soni chegarasi (body hajmini cheklash uchun). */
export const USER_WAREHOUSES_MAX = 100;

/** ASCII boshqaruv belgilari (0–31, 127): tab, yangi qator, NUL va h.k. ismda bo'lmaydi. */
const hasControlChars = (value: string): boolean =>
  [...value].some((ch) => ch.charCodeAt(0) < 32 || ch.charCodeAt(0) === 127);

/** Ism: ixtiyoriy; bo'sh satr → `null` (tozalash). Boshqaruv belgilari rad etiladi (SECURITY §10). */
export const fullNameSchema = z.preprocess(
  (value) => (typeof value === 'string' && value.trim() === '' ? null : value),
  z
    .string()
    .trim()
    .max(PERSON_NAME_MAX_LENGTH, { error: M.tooLong(PERSON_NAME_MAX_LENGTH) })
    .refine((value) => !hasControlChars(value), { error: M.controlChars })
    .nullable(),
);

/** Ombor ID'lari: UUID, takrorlanmaydi. Bo'sh ro'yxat — omborsiz (USER sotuv qila olmaydi, OWN-09). */
export const warehouseIdsSchema = z
  .array(uuidSchema)
  .max(USER_WAREHOUSES_MAX, { error: M.arrayTooBig(USER_WAREHOUSES_MAX) })
  .refine((ids) => new Set(ids).size === ids.length, { error: M.duplicateIds });

/** `POST /users`: parol maydoni YO'Q — parolni server yaratadi (BR-02, BR-04). */
export const createUserSchema = z.strictObject({
  login: loginSchema,
  fullName: fullNameSchema.optional(),
  role: z.enum(ROLE_CODES),
  warehouseIds: warehouseIdsSchema.default([]),
});

/** `PATCH /users/:id`: login o'zgarmaydi (A-26); hammasi bitta tranzaksiyada. */
export const updateUserSchema = z
  .strictObject({
    fullName: fullNameSchema.optional(),
    role: z.enum(ROLE_CODES).optional(),
    warehouseIds: warehouseIdsSchema.optional(),
  })
  .refine((input) => Object.values(input).some((value) => value !== undefined), {
    error: M.updateEmpty,
  });

export const updateUserStatusSchema = z.strictObject({ status: z.enum(USER_STATUSES) });

export const replaceUserWarehousesSchema = z.strictObject({ warehouseIds: warehouseIdsSchema });

export type CreateUserInput = z.infer<typeof createUserSchema>;
export type UpdateUserInput = z.infer<typeof updateUserSchema>;
export type UpdateUserStatusInput = z.infer<typeof updateUserStatusSchema>;
export type ReplaceUserWarehousesInput = z.infer<typeof replaceUserWarehousesSchema>;
