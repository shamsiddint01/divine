import { describe, expect, it } from 'vitest';
import {
  auditLogIdSchema,
  auditLogQuerySchema,
  decodeAuditCursor,
  encodeAuditCursor,
} from './audit.js';

describe('audit jurnali (Phase 13, API §15)', () => {
  it('cursor: kodlash ↔ ochish; buzilgan qiymat — null', () => {
    const cursor = { occurredAt: '2026-10-28T09:15:30.123Z', id: '9007199254740993' };
    const encoded = encodeAuditCursor(cursor);
    expect(encoded).toMatch(/^\d+_\d+$/);
    expect(decodeAuditCursor(encoded)).toEqual(cursor);
    for (const bad of ['', 'abc', '!!!', '1_0', '1_-1', '_5', `${'9'.repeat(16)}_1`]) {
      expect(decodeAuditCursor(bad)).toBeNull();
    }
  });

  it('query: standart limit 50, ≤ 100; filtrlar; bo‘sh qiymat — filtr yo‘q; noto‘g‘ri → xato', () => {
    expect(auditLogQuerySchema.parse({})).toEqual({ limit: 50 });
    expect(
      auditLogQuerySchema.parse({
        action: 'SALE_CREATED',
        entityType: 'SALE',
        actorId: '',
        limit: '10',
      }),
    ).toEqual({ action: 'SALE_CREATED', entityType: 'SALE', limit: 10 });
    for (const bad of [
      { limit: '101' },
      { limit: '0' },
      { action: 'SALE_DELETED' },
      { entityType: 'ROLE' },
      { actorId: 'x' },
      { cursor: 'buzilgan!' },
      { dateFrom: '2026-10-02', dateTo: '2026-10-01' },
      { entityId: 'x'.repeat(65) },
    ]) {
      expect(auditLogQuerySchema.safeParse(bad).success, JSON.stringify(bad)).toBe(false);
    }
  });

  it('id — musbat butun son (BIGINT)', () => {
    expect(auditLogIdSchema.safeParse('42').success).toBe(true);
    for (const bad of ['0', '-1', '1.5', 'abc', '1'.repeat(20)]) {
      expect(auditLogIdSchema.safeParse(bad).success).toBe(false);
    }
  });
});
