import type { AuditAction, AuditEntityType } from '@divine/shared';
import { db } from './db';
import { nowIso } from './lib/clock';

/** localStorage kvotasiga sig'ishi uchun demo jurnalida oxirgi yozuvlar saqlanadi. */
const MOCK_AUDIT_LIMIT = 2000;

export interface MockAuditEntry {
  action: AuditAction;
  entityType: AuditEntityType;
  entityId?: string | null;
  metadata?: Record<string, unknown>;
  /** Standart — joriy mock sessiya useri; `null` — tizim / noma'lum (xato login). */
  actorId?: string | null;
}

/**
 * Backend `AuditService.record` aksi (Phase 13): o'sha amal nomlari va metadata shakli. Faqat
 * muvaffaqiyatli mutatsiyadan keyin chaqiriladi (xato bo'lsa handler oldinroq `fail` qiladi).
 */
export function recordAudit(entry: MockAuditEntry): void {
  const s = db();
  s.counters.audit = (s.counters.audit ?? 0) + 1;
  s.audit.push({
    id: s.counters.audit,
    occurredAt: nowIso(),
    actorId: entry.actorId === undefined ? s.currentUserId || null : entry.actorId,
    action: entry.action,
    entityType: entry.entityType,
    entityId: entry.entityId ?? null,
    metadata: entry.metadata ?? {},
  });
  if (s.audit.length > MOCK_AUDIT_LIMIT) s.audit.splice(0, s.audit.length - MOCK_AUDIT_LIMIT);
}

const DECIMAL = /^-?\d+(\.\d+)?$/;
/** `"1000"` va `"1000.00"` — bir xil (backend `sameDecimal` kabi); qolganlari — JSON bo'yicha. */
const sameValue = (a: unknown, b: unknown) =>
  typeof a === 'string' && typeof b === 'string' && DECIMAL.test(a) && DECIMAL.test(b)
    ? Number(a) === Number(b)
    : JSON.stringify(a) === JSON.stringify(b);

/** `{ maydon: { from, to } }` — faqat haqiqatda o'zgargan maydonlar (backend kabi). */
export function diffChanges<T extends object>(
  before: T,
  after: T,
  fields: readonly (keyof T & string)[],
): Record<string, { from: unknown; to: unknown }> {
  const changes: Record<string, { from: unknown; to: unknown }> = {};
  for (const field of fields) {
    const from = before[field] ?? null;
    const to = after[field] ?? null;
    if (!sameValue(from, to)) changes[field] = { from, to };
  }
  return changes;
}

export const hasChanges = (changes: Record<string, unknown>) => Object.keys(changes).length > 0;
