import { Injectable } from '@nestjs/common';
import {
  type AuditCursor,
  type AuditLogDto,
  type AuditLogPage,
  type AuditLogQuery,
  encodeAuditCursor,
} from '@divine/shared';
import { LoginFingerprint } from '../../common/security/login-fingerprint.js';
import { Prisma } from '../../generated/prisma/client.js';
import { PrismaService } from '../../infrastructure/prisma/prisma.service.js';
import { tashkentDateRangeToUtc } from '../../common/time/tashkent-time.js';

interface AuditRow {
  id: string;
  occurredAt: Date;
  actorId: string | null;
  actorLogin: string | null;
  actorFullName: string | null;
  action: AuditLogDto['action'];
  entityType: AuditLogDto['entityType'];
  entityId: string | null;
  metadata: Record<string, unknown>;
  ip: string | null;
  requestId: string | null;
}

const SELECT = Prisma.sql`
  SELECT a.id::text AS id, a.occurred_at AS "occurredAt", a.actor_id AS "actorId",
         u.login AS "actorLogin", u.full_name AS "actorFullName", a.action,
         a.entity_type AS "entityType", a.entity_id AS "entityId", a.metadata,
         host(a.ip) AS ip, a.request_id AS "requestId"
    FROM audit_logs a LEFT JOIN users u ON u.id = a.actor_id`;

/**
 * SEC-01: tuzatishdan oldingi yozuvlarda noma'lum login xom holda turibdi (`knownUser: false`). Qator
 * o'zgarmas (D-06) — DB'da qoladi, lekin javobga yangi yozuvlar bilan bir xil ko'rinishda chiqadi.
 */
function presentMetadata(row: AuditRow, fingerprint: LoginFingerprint): Record<string, unknown> {
  const { login, ...rest } = row.metadata;
  const unknownLogin =
    (row.action === 'AUTH_LOGIN_FAILED' || row.action === 'AUTH_ACCOUNT_LOCKED') &&
    rest.knownUser === false &&
    typeof login === 'string';
  return unknownLogin ? { ...fingerprint.metadata(login), ...rest } : row.metadata;
}

function toDto(row: AuditRow, fingerprint: LoginFingerprint): AuditLogDto {
  return {
    id: row.id,
    occurredAt: row.occurredAt.toISOString(),
    actor: row.actorId
      ? { id: row.actorId, login: row.actorLogin ?? '', fullName: row.actorFullName }
      : null,
    action: row.action,
    entityType: row.entityType,
    entityId: row.entityId,
    metadata: presentMetadata(row, fingerprint),
    ip: row.ip,
    requestId: row.requestId,
  };
}

/**
 * Audit jurnalini o'qish (Phase 13, API §15). Keyset pagination `(occurred_at DESC, id DESC)`:
 * `occurred_at` indekslari bilan mos, katta hajmda ham OFFSET'siz; parallel yangi yozuvlar sahifalarni
 * siljitmaydi. Faqat SELECT — yozish `AuditService.record` orqali, o'zgartirish yo'q (D-06).
 */
@Injectable()
export class AuditRepository {
  constructor(
    private readonly prisma: PrismaService,
    private readonly fingerprint: LoginFingerprint,
  ) {}

  async list(q: AuditLogQuery): Promise<AuditLogPage> {
    const c: Prisma.Sql[] = [Prisma.sql`TRUE`];
    const { from, to } = tashkentDateRangeToUtc(q);
    if (from) c.push(Prisma.sql`a.occurred_at >= ${from}`);
    if (to) c.push(Prisma.sql`a.occurred_at < ${to}`);
    if (q.actorId) c.push(Prisma.sql`a.actor_id = ${q.actorId}::uuid`);
    if (q.action) c.push(Prisma.sql`a.action = ${q.action}`);
    if (q.entityType) c.push(Prisma.sql`a.entity_type = ${q.entityType}`);
    if (q.entityId) c.push(Prisma.sql`a.entity_id = ${q.entityId}`);
    if (q.cursor) c.push(after(q.cursor));
    const rows = await this.prisma.$queryRaw<AuditRow[]>`
      ${SELECT} WHERE ${Prisma.join(c, ' AND ')}
       ORDER BY a.occurred_at DESC, a.id DESC
       LIMIT ${q.limit + 1}`;
    const page = rows.slice(0, q.limit);
    const last = page.at(-1);
    return {
      data: page.map((row) => toDto(row, this.fingerprint)),
      nextCursor:
        rows.length > q.limit && last
          ? encodeAuditCursor({ occurredAt: last.occurredAt.toISOString(), id: last.id })
          : null,
    };
  }

  async get(id: string): Promise<AuditLogDto | null> {
    const [row] = await this.prisma.$queryRaw<AuditRow[]>`${SELECT} WHERE a.id = ${id}::bigint`;
    return row ? toDto(row, this.fingerprint) : null;
  }
}

/** Cursor'dan keyingi (eskiroq) yozuvlar; birinchi shart `occurred_at` indeksidan foydalanadi. */
function after(cursor: AuditCursor): Prisma.Sql {
  const at = new Date(cursor.occurredAt);
  return Prisma.sql`a.occurred_at <= ${at}
    AND (a.occurred_at < ${at} OR a.id < ${cursor.id}::bigint)`;
}
