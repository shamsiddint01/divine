import { z } from 'zod';

// Murojaat bo'limi (egasining qarori, 2026-11-09): foydalanuvchi xabari, avtomatik xato, baho, e'lon.

const text = (max: number) =>
  z
    .string({ error: 'Matn kiriting' })
    .trim()
    .min(1, { error: 'Matn kiriting' })
    .max(max, { error: `Ko‘pi bilan ${max} ta belgi` });
const optional = (max: number) => z.string().trim().max(max).optional();

export const SUPPORT_STATUSES = ['NEW', 'SEEN', 'RESOLVED'] as const;
export type SupportStatus = (typeof SUPPORT_STATUSES)[number];

export const supportTicketCreateSchema = z.strictObject({
  message: text(2000),
  page: optional(300),
  errorCode: optional(64),
  requestId: optional(64),
});

/** Sahifa xatosi: foydalanuvchi hech narsa bosmasa ham yuboriladi. */
export const supportErrorSchema = z.strictObject({
  message: z.string().trim().min(1).max(2000),
  page: optional(300),
  errorCode: optional(64),
  requestId: optional(64),
});

export const supportReplySchema = z.strictObject({ body: text(2000) });

export const supportStatusSchema = z.strictObject({ status: z.enum(SUPPORT_STATUSES) });

export const supportFeedbackSchema = z.strictObject({
  topic: z.string().trim().min(1).max(64),
  helpful: z.boolean(),
});

export const ANNOUNCEMENT_KINDS = ['INFO', 'MAINTENANCE'] as const;
export const announcementSchema = z.strictObject({
  kind: z.enum(ANNOUNCEMENT_KINDS),
  text: text(500),
});

export type SupportTicketCreateInput = z.infer<typeof supportTicketCreateSchema>;
export type SupportErrorInput = z.infer<typeof supportErrorSchema>;
export type SupportReplyInput = z.infer<typeof supportReplySchema>;
export type SupportStatusInput = z.infer<typeof supportStatusSchema>;
export type SupportFeedbackInput = z.infer<typeof supportFeedbackSchema>;
export type AnnouncementInput = z.infer<typeof announcementSchema>;
