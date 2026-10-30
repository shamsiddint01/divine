import { z } from 'zod';
import { AUDIT_ACTIONS, AUDIT_ENTITY_TYPES } from '../enums/index.js';
import { VALIDATION_MESSAGES_UZ as M } from './messages.uz.js';
import { dateOnlySchema, uuidSchema } from './primitives.js';

// Audit jurnali (Phase 13, API §15): faqat o'qish, cursor pagination (keyset: `occurredAt`, `id`).

export const AUDIT_PAGE_SIZE = 50;
export const AUDIT_PAGE_SIZE_MAX = 100;
export const AUDIT_ENTITY_ID_MAX_LENGTH = 64;

/** Keyingi sahifa boshlanadigan joy: oxirgi ko'rilgan yozuvning vaqti va ID'si. */
export interface AuditCursor {
  occurredAt: string;
  id: string;
}

/** `<occurredAt epoch ms>_<id>` — URL-xavfsiz; client uni o'zgartirmasdan qaytaradi. */
const CURSOR_PATTERN = /^(\d{1,15})_([1-9]\d{0,18})$/;

export function encodeAuditCursor(cursor: AuditCursor): string {
  return `${Date.parse(cursor.occurredAt)}_${cursor.id}`;
}

/** Noto'g'ri yoki buzilgan cursor — `null`. */
export function decodeAuditCursor(value: string): AuditCursor | null {
  const match = CURSOR_PATTERN.exec(value);
  if (!match) return null;
  const at = new Date(Number(match[1]));
  if (Number.isNaN(at.getTime())) return null;
  return { occurredAt: at.toISOString(), id: match[2]! };
}

const emptyToUndefined = (value: unknown) =>
  typeof value === 'string' && value.trim() === '' ? undefined : value;
const optional = <T extends z.ZodType>(schema: T) =>
  z.preprocess(emptyToUndefined, schema.optional());

/**
 * `GET /audit-logs` query. Filtrlar AND bilan; sana — Toshkent kunlari (ikkala chegara kiradi).
 * Noma'lum parametrlar e'tiborga olinmaydi (API §1.1).
 */
export const auditLogQuerySchema = z
  .object({
    cursor: optional(
      z.string().transform((value, ctx): AuditCursor => {
        const cursor = decodeAuditCursor(value);
        if (!cursor) {
          ctx.issues.push({ code: 'custom', message: M.invalidCursor, input: value });
          return z.NEVER;
        }
        return cursor;
      }),
    ),
    limit: z.coerce
      .number({ error: M.mustBeInteger })
      .int({ error: M.mustBeInteger })
      .min(1)
      .max(AUDIT_PAGE_SIZE_MAX, { error: M.pageSizeTooBig })
      .default(AUDIT_PAGE_SIZE),
    dateFrom: optional(dateOnlySchema),
    dateTo: optional(dateOnlySchema),
    actorId: optional(uuidSchema),
    action: optional(z.enum(AUDIT_ACTIONS)),
    entityType: optional(z.enum(AUDIT_ENTITY_TYPES)),
    entityId: optional(z.string().trim().max(AUDIT_ENTITY_ID_MAX_LENGTH)),
  })
  .refine((q) => !q.dateFrom || !q.dateTo || q.dateFrom <= q.dateTo, {
    path: ['dateTo'],
    error: M.dateRangeOrder,
  });

export type AuditLogQuery = z.infer<typeof auditLogQuerySchema>;

/** `GET /audit-logs/:id` — BIGINT identity. */
export const auditLogIdSchema = z.string().regex(/^[1-9]\d{0,18}$/, { error: M.invalidId });
