import {
  type AuditLogDto,
  type AuditLogPage,
  auditLogIdSchema,
  auditLogQuerySchema,
  encodeAuditCursor,
} from '@divine/shared';
import { db } from '../db';
import { fail, notFound, route, validate } from '../lib/http';
import { tashkentDate } from '../lib/time';
import { currentCan } from '../mappers';
import type { AuditRow, MockState } from '../state';

// Backend bilan bir xil (Phase 13, API §15): `audit.read`, o'sha shared sxema, keyset cursor
// (`occurredAt DESC, id DESC`). Yozish/o'zgartirish endpointlari yo'q (D-06).

function toDto(s: MockState, row: AuditRow): AuditLogDto {
  const actor = row.actorId ? s.users.find((u) => u.id === row.actorId) : undefined;
  return {
    id: String(row.id),
    occurredAt: row.occurredAt,
    actor: row.actorId
      ? { id: row.actorId, login: actor?.login ?? '', fullName: actor?.fullName ?? null }
      : null,
    action: row.action,
    entityType: row.entityType,
    entityId: row.entityId,
    metadata: row.metadata,
    ip: null,
    requestId: null,
  };
}

const newerFirst = (a: AuditRow, b: AuditRow) =>
  a.occurredAt === b.occurredAt ? b.id - a.id : a.occurredAt < b.occurredAt ? 1 : -1;

route('GET', '/audit-logs', ({ query }): AuditLogPage => {
  const s = db();
  if (!currentCan(s, 'audit.read')) fail(403, 'FORBIDDEN');
  const q = validate(auditLogQuerySchema, query);
  const cursor = q.cursor;
  const rows = s.audit
    .filter(
      (r) =>
        (!q.dateFrom || tashkentDate(r.occurredAt) >= q.dateFrom) &&
        (!q.dateTo || tashkentDate(r.occurredAt) <= q.dateTo) &&
        (!q.actorId || r.actorId === q.actorId) &&
        (!q.action || r.action === q.action) &&
        (!q.entityType || r.entityType === q.entityType) &&
        (!q.entityId || r.entityId === q.entityId) &&
        (!cursor ||
          r.occurredAt < cursor.occurredAt ||
          (r.occurredAt === cursor.occurredAt && r.id < Number(cursor.id))),
    )
    .sort(newerFirst);
  const page = rows.slice(0, q.limit);
  const last = page.at(-1);
  return {
    data: page.map((r) => toDto(s, r)),
    nextCursor:
      rows.length > q.limit && last
        ? encodeAuditCursor({ occurredAt: last.occurredAt, id: String(last.id) })
        : null,
  };
});

route('GET', '/audit-logs/:id', ({ params }): AuditLogDto => {
  const s = db();
  if (!currentCan(s, 'audit.read')) fail(403, 'FORBIDDEN');
  const id = Number(validate(auditLogIdSchema, params.id));
  return toDto(s, s.audit.find((r) => r.id === id) ?? notFound());
});
