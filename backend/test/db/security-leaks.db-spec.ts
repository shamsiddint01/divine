import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { RedisService } from '../../src/infrastructure/redis/redis.service.js';
import {
  type AuthTestApp,
  createAuthApp,
  createUser,
  login,
  refresh,
  refreshCookieOf,
  uniqueIp,
  uniqueLogin,
} from './support/auth-app.js';
import { closePool, withCommit } from './support/db.js';
import {
  createCustomer,
  createGroup,
  createProduct,
  createWarehouse,
  receive,
  sell,
} from './support/fixtures.js';
import { discoverRoutes } from './support/routes.js';

/*
 * Phase 16 (SECURITY §14, §18): maxfiy qiymatlar oshkor bo'lmaydi. Haqiqiy oqim bajariladi (login,
 * user yaratish — server paroli, parol tiklash, refresh rotation va qayta ishlatish, logout, xato
 * login, login maydoniga parol) va TO'PLANGAN har bir maxfiy qiymat (parollar, urinilgan parol,
 * access/refresh tokenlar, refresh token hash'lari, parol hash'lari, JWT secret, pepper):
 *   - log yozuvlarida (pino, `trace` darajasi — eng ko'p yozuv) — grep;
 *   - shu testda yozilgan audit qatorlarida;
 *   - Redis'ning barcha kalit va qiymatlarida
 * uchramasligi tekshiriladi. Alohida: har bir GET endpoint javobida (ADMIN va USER, haqiqiy ID'lar
 * bilan) maxfiy kalit yoki hash/token ko'rinishidagi qiymat yo'q — endpointlar metadata'dan topiladi.
 */
const ADMIN_PASSWORD = '730518';
const GUESSED_PASSWORD = '864209'; // sotuvchi uchun noto'g'ri urinish — u ham log/auditga tushmasin
const logLines: string[] = [];
const secrets = new Map<string, string>();
const remember = (label: string, value: string | undefined) => {
  if (!value || value.length < 6) throw new Error(`maxfiy qiymat bo'sh: ${label}`);
  secrets.set(value, label);
};

let t: AuthTestApp;
let auditFrom = '0';
let adminToken = '';
let sellerToken = '';
const ids: Record<string, string> = {};
const http = () => request(t.app.getHttpServer());
const bearer = (token: string) => ({ Authorization: `Bearer ${token}` });

/** Matnda topilgan maxfiy qiymatlar (tavsifi bilan). */
const leaksIn = (text: string) =>
  [...secrets].filter(([value]) => text.includes(value)).map(([, label]) => label);

beforeAll(async () => {
  t = await createAuthApp({
    logStream: { write: (line: string) => void logLines.push(line) },
    config: { LOG_LEVEL: 'trace' },
  });
  remember('JWT_ACCESS_SECRET', t.config.JWT_ACCESS_SECRET);
  remember('PASSWORD_PEPPER', t.config.PASSWORD_PEPPER);
  remember('admin paroli', ADMIN_PASSWORD);
  remember('urinilgan parol', GUESSED_PASSWORD);
  auditFrom =
    (
      await t.prisma.$queryRaw<
        { max: string | null }[]
      >`SELECT max(id)::text AS max FROM audit_logs`
    )[0]!.max ?? '0';

  const admin = await createUser(t, { password: ADMIN_PASSWORD, role: 'ADMIN' });
  const adminLogin = await login(t, { login: admin.login, password: ADMIN_PASSWORD }).expect(200);
  adminToken = adminLogin.body.accessToken;
  remember('admin access token', adminToken);
  const adminCookie = refreshCookieOf(adminLogin);
  remember('admin refresh token', adminCookie.split('=')[1]);

  // Ma'lumot: ombor, guruh, mahsulot, kirim, mijoz, sotuv, xarajat (detal endpointlari uchun ID'lar).
  await withCommit(async (db) => {
    ids.warehouses = await createWarehouse(db, admin.id);
    ids['product-groups'] = await createGroup(db, admin.id);
    ids.products = await createProduct(db, { groupId: ids['product-groups'], actor: admin.id });
    ids.incoming = (
      await receive(db, {
        warehouseId: ids.warehouses,
        actor: admin.id,
        lines: [{ productId: ids.products, quantity: '10', price: '1000.00' }],
      })
    ).incomingId;
    ids.customers = await createCustomer(db, admin.id, 'Maxfiylik testi mijozi');
    const category = await db.query(
      `INSERT INTO expense_categories (name, created_by) VALUES ($1, $2) RETURNING id`,
      [`Kategoriya ${randomUUID()}`, admin.id],
    );
    ids['expense-categories'] = category.rows[0].id;
    const expense = await db.query(
      `INSERT INTO expenses (expense_date, amount, category_id, created_by)
       VALUES (current_date, 1000, $1, $2) RETURNING id`,
      [ids['expense-categories'], admin.id],
    );
    ids.expenses = expense.rows[0].id;
  });

  // Sotuvchi: server yaratgan parol, parol tiklash, yangi parol bilan login.
  const created = await http()
    .post('/api/v1/users')
    .set(bearer(adminToken))
    .send({ login: uniqueLogin('sirsiz'), role: 'USER', warehouseIds: [ids.warehouses] })
    .expect(201);
  ids.users = created.body.user.id;
  remember('yaratilgan parol', created.body.generatedPassword);
  const firstSeller = await login(t, {
    login: created.body.user.login,
    password: created.body.generatedPassword,
  }).expect(200);
  remember('sotuvchi access token (1)', firstSeller.body.accessToken);
  t.clock.advance(1_000); // token `iat` soniya aniqligida (parol tiklashdan oldin berilgan bo'lsin)
  const reset = await http()
    .post(`/api/v1/users/${ids.users}/reset-password`)
    .set(bearer(adminToken))
    .expect(200);
  remember('tiklangan parol', reset.body.generatedPassword);
  t.clock.advance(1_000);
  await login(t, { login: created.body.user.login, password: GUESSED_PASSWORD }).expect(401);
  // Login maydoniga parol (SEC-01) — noma'lum login sifatida.
  await login(t, { login: reset.body.generatedPassword, password: GUESSED_PASSWORD }).expect(401);
  const seller = await login(t, {
    login: created.body.user.login,
    password: reset.body.generatedPassword,
  }).expect(200);
  sellerToken = seller.body.accessToken;
  remember('sotuvchi access token (2)', sellerToken);
  const sellerCookie = refreshCookieOf(seller);
  remember('sotuvchi refresh token', sellerCookie.split('=')[1]);

  await withCommit(async (db) => {
    ids.sales = (
      await sell(db, {
        warehouseId: ids.warehouses!,
        userId: ids.users!,
        customerId: ids.customers!,
        lines: [{ productId: ids.products!, quantity: '1' }],
      })
    ).saleId;
  });

  // Refresh rotation, eski tokenni qayta ishlatish (family revoke), logout.
  const rotated = await refresh(t, adminCookie).expect(200);
  remember('admin access token (refresh)', rotated.body.accessToken);
  const rotatedCookie = refreshCookieOf(rotated);
  remember('admin refresh token (rotated)', rotatedCookie.split('=')[1]);
  await refresh(t, adminCookie).expect(401);
  await http()
    .post('/api/v1/auth/logout')
    .set('X-Forwarded-For', uniqueIp())
    .set('Origin', 'http://localhost:5180')
    .set('X-Requested-With', 'XMLHttpRequest')
    .set('Cookie', sellerCookie)
    .expect(204);
  // Refresh family revoke qilingani uchun admin qayta kiradi (skaner uchun).
  const again = await login(t, { login: admin.login, password: ADMIN_PASSWORD }).expect(200);
  adminToken = again.body.accessToken;
  remember('admin access token (qayta)', adminToken);
  const fresh = await login(t, {
    login: created.body.user.login,
    password: reset.body.generatedPassword,
  }).expect(200);
  sellerToken = fresh.body.accessToken;
  remember('sotuvchi access token (3)', sellerToken);

  // DB'dagi hash'lar (parol va refresh token) ham hech qayerga chiqmasligi kerak.
  for (const row of await t.prisma.user.findMany({
    where: { id: { in: [admin.id, ids.users!] } },
    select: { passwordHash: true },
  })) {
    remember('parol hash', row.passwordHash);
  }
  for (const row of await t.prisma.userSession.findMany({
    where: { userId: { in: [admin.id, ids.users!] } },
    select: { tokenHash: true },
  })) {
    remember('refresh token hash', row.tokenHash);
  }
  ids['audit-logs'] = (
    await t.prisma.$queryRaw<{ id: string }[]>`
      SELECT id::text FROM audit_logs WHERE id > ${BigInt(auditFrom)} ORDER BY id LIMIT 1`
  )[0]!.id;
}, 120_000);

afterAll(async () => {
  await t?.close();
  await closePool();
});

describe('maxfiy qiymatlar oshkor bo‘lmaydi (Phase 16, SECURITY §14, §18)', () => {
  it('shu testda yozilgan audit qatorlarida maxfiy qiymat yo‘q', async () => {
    const rows = await t.prisma.$queryRaw<{ action: string; text: string }[]>`
      SELECT action, (to_jsonb(a) - 'id')::text AS text
        FROM audit_logs a WHERE id > ${BigInt(auditFrom)}`;
    expect(rows.map((r) => r.action)).toEqual(
      expect.arrayContaining([
        'AUTH_LOGIN_SUCCEEDED',
        'AUTH_LOGIN_FAILED',
        'USER_CREATED',
        'USER_PASSWORD_RESET',
        'AUTH_REFRESH_REUSE_DETECTED',
        'AUTH_LOGOUT',
      ]),
    );
    expect(leaksIn(rows.map((r) => r.text).join('\n'))).toEqual([]);
  });

  it('Redis: barcha kalit va qiymatlarda maxfiy qiymat yo‘q', async () => {
    const redis = t.app.get(RedisService).client;
    const dump: string[] = [];
    let cursor = '0';
    do {
      const [next, keys] = await redis.scan(cursor, 'COUNT', 1000);
      for (const key of keys) {
        const type = await redis.type(key);
        const value =
          type === 'hash'
            ? await redis.hgetall(key)
            : type === 'string'
              ? await redis.get(key)
              : `<${type}>`;
        dump.push(`${key} ${JSON.stringify(value)}`);
      }
      cursor = next;
    } while (cursor !== '0');
    expect(dump.length).toBeGreaterThan(0);
    expect(leaksIn(dump.join('\n'))).toEqual([]);
  });

  it('har bir GET endpoint javobi (ADMIN va USER, haqiqiy ID bilan): maxfiy kalit, hash yoki token yo‘q', async () => {
    const FORBIDDEN_KEY = /pass|hash|secret|pepper|cookie|token/i;
    const findKeys = (value: unknown, path = ''): string[] =>
      Array.isArray(value)
        ? value.flatMap((item, i) => findKeys(item, `${path}[${i}]`))
        : value && typeof value === 'object'
          ? Object.entries(value).flatMap(([key, item]) => [
              ...(FORBIDDEN_KEY.test(key) ? [`${path}.${key}`] : []),
              ...findKeys(item, `${path}.${key}`),
            ])
          : [];
    const routes = discoverRoutes(t.app).filter(
      (r) => r.method === 'get' && r.security.kind !== 'public',
    );
    const failures: string[] = [];
    let withData = 0;
    for (const route of routes) {
      const resource = route.path.split('/')[1]!;
      const query = resource === 'reports' ? '?dateFrom=2026-01-01&dateTo=2026-12-31' : '';
      const url = `/api/v1${route.path.replace(/:[A-Za-z]+/g, () => ids[resource] ?? randomUUID())}${query}`;
      for (const [role, token] of [
        ['ADMIN', adminToken],
        ['USER', sellerToken],
      ] as const) {
        const res = await http().get(url).set(bearer(token)).set('X-Forwarded-For', uniqueIp());
        if (res.status >= 500) failures.push(`${role} ${route.key}: ${res.status}`);
        if (role === 'ADMIN' && res.status === 200) withData++;
        const keys = findKeys(res.body);
        const values = leaksIn(res.text);
        if (keys.length > 0) failures.push(`${role} ${route.key}: kalitlar ${keys.join(', ')}`);
        if (values.length > 0)
          failures.push(`${role} ${route.key}: qiymatlar ${values.join(', ')}`);
        if (/argon2id|eyJhbGci/.test(res.text)) failures.push(`${role} ${route.key}: hash/JWT`);
      }
    }
    expect(failures).toEqual([]);
    // Skaner bo'sh 404'lar bilan o'tib ketmasin: GET endpointlarning ko'pchiligi ma'lumot qaytardi.
    expect(withData).toBeGreaterThanOrEqual(routes.length - 2);
  });
  it('log yozuvlarida parol, token, cookie, hash, secret va pepper yo‘q (grep)', () => {
    const text = logLines.join('');
    // Oxirida: oqim + skanerning yuzlab so'rovi (xato javoblari bilan). Bo'sh log bilan "o'tib ketmasin".
    expect(logLines.length).toBeGreaterThan(80);
    expect(text).toContain('/api/v1/auth/login');
    expect(text).toContain('/api/v1/users/:id/reset-password');
    expect(leaksIn(text)).toEqual([]);
    expect(text).not.toMatch(/argon2id|eyJhbGci|dv_refresh=/);
  });
});
