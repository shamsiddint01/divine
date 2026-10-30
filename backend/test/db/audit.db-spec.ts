import { randomUUID } from 'node:crypto';
import type { AuditLogDto, AuditLogPage } from '@divine/shared';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  type AuthTestApp,
  createAuthApp,
  createUser,
  login,
  uniqueIp,
} from './support/auth-app.js';
import { closePool, withCommit } from './support/db.js';

const PASSWORD = '582913';

let t: AuthTestApp;
let adminToken: string;
let sellerToken: string;
let adminId: string;
let adminLogin: string;
/** Shu fayl yozuvlarini boshqa testlarnikidan ajratuvchi obyekt ID'si. */
const tag = `audit-${randomUUID()}`;

const bearer = (token: string) => ({ Authorization: `Bearer ${token}` });
function api(
  method: 'get' | 'post' | 'patch' | 'put' | 'delete',
  path: string,
  token: string | null = adminToken,
) {
  const req = request(t.app.getHttpServer())
    [method](`/api/v1${path}`)
    .set('X-Forwarded-For', uniqueIp());
  return token ? req.set(bearer(token)) : req;
}
const list = async (query: Record<string, string | number>) => {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(query)) params.set(key, String(value));
  return (await api('get', `/audit-logs?${params}`).expect(200)).body as AuditLogPage;
};

async function signIn(loginName: string) {
  return (await login(t, { login: loginName, password: PASSWORD }).expect(200)).body
    .accessToken as string;
}

beforeAll(async () => {
  t = await createAuthApp();
  const admin = await createUser(t, { password: PASSWORD, role: 'ADMIN' });
  adminId = admin.id;
  adminLogin = admin.login;
  adminToken = await signIn(admin.login);
  sellerToken = await signIn((await createUser(t, { password: PASSWORD })).login);
  /*
   * Ma'lum vaqtli yozuvlar (test superuser'i INSERT qila oladi; UPDATE/DELETE — hech kim, D-06):
   *   e1 — 2026-03-09 18:59:59.999Z (Toshkent: 9-mart 23:59:59.999), tizim (actor yo'q)
   *   e2, e3, e4 — 2026-03-09 19:00:00.000Z (Toshkent: 10-mart 00:00), bir xil vaqt — tartib `id` bo'yicha
   *   e5 — 2026-03-10 10:00Z, admin, IP bilan
   */
  await withCommit(async (db) => {
    const insert = (
      at: string,
      action: string,
      actor: string | null,
      metadata: object,
      ip: string | null,
    ) =>
      db.query(
        `INSERT INTO audit_logs (occurred_at, actor_id, action, entity_type, entity_id, metadata, ip, request_id)
         VALUES ($1, $2, $3, 'PRODUCT', $4, $5, $6, $7)`,
        [at, actor, action, tag, JSON.stringify(metadata), ip, `req-${tag}`.slice(0, 64)],
      );
    await insert('2026-03-09T18:59:59.999Z', 'PRODUCT_CREATED', null, { name: 'e1' }, null);
    for (const name of ['e2', 'e3', 'e4']) {
      await insert('2026-03-09T19:00:00.000Z', 'PRODUCT_UPDATED', adminId, { name }, null);
    }
    await insert(
      '2026-03-10T10:00:00.000Z',
      'PRODUCT_STATUS_CHANGED',
      adminId,
      { name: 'e5', from: 'ACTIVE', to: 'INACTIVE' },
      '203.0.113.7',
    );
  });
});

afterAll(async () => {
  await t?.close();
  await closePool();
});

describe('ruxsatlar va o‘zgarmaslik (RBAC §5, D-06, BR-25, AC-22)', () => {
  it('anonim → 401; sotuvchi (audit.read yo‘q) → 403; admin → 200', async () => {
    await api('get', '/audit-logs', null).expect(401);
    await api('get', '/audit-logs/1', null).expect(401);
    await api('get', '/audit-logs', sellerToken).expect(403);
    await api('get', '/audit-logs/1', sellerToken).expect(403);
    await api('get', '/audit-logs').expect(200);
  });

  it('yozish, o‘zgartirish va o‘chirish endpointlari yo‘q → 404 (admin uchun ham); yozuv o‘zgarmaydi', async () => {
    const [first] = (await list({ entityId: tag, limit: 1 })).data;
    for (const [method, path] of [
      ['post', '/audit-logs'],
      ['put', `/audit-logs/${first!.id}`],
      ['patch', `/audit-logs/${first!.id}`],
      ['delete', `/audit-logs/${first!.id}`],
      ['delete', '/audit-logs'],
    ] as const) {
      await api(method, path).send({ action: 'X' }).expect(404);
    }
    expect((await api('get', `/audit-logs/${first!.id}`).expect(200)).body).toEqual(first);
  });

  it('SQL bilan ham: UPDATE va DELETE — DV001 (trigger)', async () => {
    const [first] = (await list({ entityId: tag, limit: 1 })).data;
    await expect(
      t.prisma.$executeRaw`UPDATE audit_logs SET action = 'X' WHERE id = ${first!.id}::bigint`,
    ).rejects.toThrow(/o'zgarmas/);
    await expect(
      t.prisma.$executeRaw`DELETE FROM audit_logs WHERE id = ${first!.id}::bigint`,
    ).rejects.toThrow(/o'zgarmas/);
  });
});

describe('GET /audit-logs (API §15)', () => {
  it('yangilari birinchi; bir xil vaqtda — id bo‘yicha; DTO maydonlari (actor, IP, requestId), user-agent yo‘q', async () => {
    const page = await list({ entityId: tag });
    expect(page.nextCursor).toBeNull();
    expect(page.data.map((e) => e.metadata.name)).toEqual(['e5', 'e4', 'e3', 'e2', 'e1']);
    const [e5] = page.data;
    expect(e5).toEqual({
      id: expect.stringMatching(/^\d+$/),
      occurredAt: '2026-03-10T10:00:00.000Z',
      actor: { id: adminId, login: adminLogin, fullName: 'Test Foydalanuvchi' },
      action: 'PRODUCT_STATUS_CHANGED',
      entityType: 'PRODUCT',
      entityId: tag,
      metadata: { name: 'e5', from: 'ACTIVE', to: 'INACTIVE' },
      ip: '203.0.113.7',
      requestId: `req-${tag}`.slice(0, 64),
    } satisfies AuditLogDto);
    expect(page.data.at(-1)!.actor).toBeNull();
  });

  it('cursor pagination: takrorlanmaydi va tushib qolmaydi (bir xil vaqt ham); yangi yozuv sahifalarni siljitmaydi', async () => {
    const first = await list({ entityId: tag, limit: 2 });
    expect(first.data.map((e) => e.metadata.name)).toEqual(['e5', 'e4']);
    expect(first.nextCursor).toMatch(/^\d+_\d+$/);
    await withCommit((db) =>
      db.query(
        `INSERT INTO audit_logs (actor_id, action, entity_type, entity_id, metadata)
         VALUES (NULL, 'PRODUCT_UPDATED', 'PRODUCT', $1, '{"name":"yangi"}')`,
        [tag],
      ),
    );
    const second = await list({ entityId: tag, limit: 2, cursor: first.nextCursor! });
    expect(second.data.map((e) => e.metadata.name)).toEqual(['e3', 'e2']);
    const third = await list({ entityId: tag, limit: 2, cursor: second.nextCursor! });
    expect(third.data.map((e) => e.metadata.name)).toEqual(['e1']);
    expect(third.nextCursor).toBeNull();
    expect((await list({ entityId: tag, limit: 1 })).data[0]!.metadata.name).toBe('yangi');
  });

  it('filtrlar (AND): amal, obyekt turi + ID, actor, sana (Toshkent kun chegarasi)', async () => {
    const names = async (q: Record<string, string>) =>
      (await list({ entityId: tag, ...q })).data.map((e) => e.metadata.name);
    expect(await names({ action: 'PRODUCT_UPDATED', dateTo: '2026-03-10' })).toEqual([
      'e4',
      'e3',
      'e2',
    ]);
    expect(await names({ actorId: adminId, dateTo: '2026-03-31' })).toEqual([
      'e5',
      'e4',
      'e3',
      'e2',
    ]);
    // 18:59:59.999Z — Toshkentda hali 9-mart; 19:00Z — 10-mart.
    expect(await names({ dateFrom: '2026-03-09', dateTo: '2026-03-09' })).toEqual(['e1']);
    expect(await names({ dateFrom: '2026-03-10', dateTo: '2026-03-10' })).toEqual([
      'e5',
      'e4',
      'e3',
      'e2',
    ]);
    expect(await names({ entityType: 'SALE' })).toEqual([]);
  });

  it('validatsiya: noto‘g‘ri cursor, limit, amal, sana tartibi → 400; detal: noma’lum → 404, noto‘g‘ri ID → 400', async () => {
    for (const query of [
      'cursor=abc',
      'cursor=1_0',
      'limit=0',
      'limit=101',
      'action=SALE_DELETED',
      'entityType=ROLE',
      'actorId=x',
      'dateFrom=2026-03-10&dateTo=2026-03-09',
    ]) {
      const res = await api('get', `/audit-logs?${query}`).expect(400);
      expect(res.body.error.code, query).toBe('VALIDATION_ERROR');
    }
    await api('get', '/audit-logs/999999999999').expect(404);
    await api('get', '/audit-logs/abc').expect(400);
  });
});
