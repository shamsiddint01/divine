import { AuditAction } from '@divine/shared';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  type AuthTestApp,
  createAuthApp,
  createUser,
  login,
  ORIGIN,
  refresh,
  refreshCookieOf,
  uniqueIp,
  uniqueLogin,
} from './support/auth-app.js';
import { freshDatabase } from './support/fresh-database.js';

const PASSWORD = '482913';
const SELLER_PASSWORD = '730451';

let t: AuthTestApp;
let admin: { id: string; login: string };
let adminToken: string;
let warehouseA: string;
let warehouseB: string;
let warehouseInactive: string;

const http = () => request(t.app.getHttpServer());
const bearer = (token: string) => ({ Authorization: `Bearer ${token}` });

/** Har bir so'rov o'z IP'si bilan (anonim limit aralashmasin). */
function api(method: 'get' | 'post' | 'patch' | 'put', path: string, token?: string) {
  const req = http()[method](`/api/v1${path}`).set('X-Forwarded-For', uniqueIp());
  return token ? req.set(bearer(token)) : req;
}

async function signIn(loginName: string, password: string) {
  const res = await login(t, { login: loginName, password }).expect(200);
  return { token: res.body.accessToken as string, cookie: refreshCookieOf(res) };
}

function createViaApi(body: Record<string, unknown>) {
  return api('post', '/users', adminToken).send(body);
}

async function auditOf(entityId: string) {
  return t.prisma.auditLog.findMany({ where: { entityId }, orderBy: { id: 'asc' } });
}

/** Audit yozuvida maxfiy qiymatlar yo'q (D-06, SECURITY §14). */
function expectNoSecrets(rows: unknown[], ...secrets: string[]) {
  const text = JSON.stringify(rows, (_k, v) => (typeof v === 'bigint' ? v.toString() : v));
  for (const secret of secrets) expect(text).not.toContain(secret);
  expect(text).not.toMatch(/v1\$|argon2|password_?hash|"token"|refresh/i);
}

beforeAll(async () => {
  // Alohida toza DB: "faol ADMIN'lar soni" boshqa test fayllaridagi userlarga bog'liq bo'lmasin.
  t = await createAuthApp({ databaseUrl: await freshDatabase('users') });
  const row = await createUser(t, { password: PASSWORD, role: 'ADMIN', login: 'bosh' });
  admin = { id: row.id, login: row.login };
  adminToken = (await signIn('bosh', PASSWORD)).token;
  const mk = async (name: string, status: 'ACTIVE' | 'INACTIVE' = 'ACTIVE') =>
    (await t.prisma.warehouse.create({ data: { name, status, createdById: admin.id } })).id;
  warehouseA = await mk('Asosiy ombor');
  warehouseB = await mk('Filial ombori');
  warehouseInactive = await mk('Yopilgan ombor', 'INACTIVE');
}, 240_000);

afterAll(async () => {
  await t?.close();
});

describe('POST /users — yaratish (AC-01…AC-04, BR-01…04)', () => {
  it('ADMIN yaratadi: 201, parol server tomonda (6 raqam), no-store; DB’da faqat argon2id hash; parol bilan kirish ishlaydi', async () => {
    const loginName = uniqueLogin('sotuvchi');
    const res = await createViaApi({
      login: loginName,
      fullName: '  Aziz Karimov ',
      role: 'USER',
      warehouseIds: [warehouseA],
    }).expect(201);
    expect(res.headers['cache-control']).toBe('no-store');
    expect(res.body.generatedPassword).toMatch(/^\d{6}$/);
    expect(res.body.user).toMatchObject({
      login: loginName,
      fullName: 'Aziz Karimov',
      role: 'USER',
      status: 'ACTIVE',
      lockedUntil: null,
      warehouses: [{ id: warehouseA, name: 'Asosiy ombor' }],
    });
    expect(Object.keys(res.body.user).sort()).toEqual(
      [
        'createdAt',
        'fullName',
        'id',
        'lastLoginAt',
        'lockedUntil',
        'login',
        'role',
        'status',
        'updatedAt',
        'warehouses',
      ].sort(),
    );

    const stored = await t.prisma.user.findUniqueOrThrow({ where: { id: res.body.user.id } });
    expect(stored.passwordHash.startsWith('v1$$argon2id$')).toBe(true);
    expect(stored.passwordHash).not.toContain(res.body.generatedPassword);
    expect(stored.createdById).toBe(admin.id);

    const session = await signIn(loginName, res.body.generatedPassword);
    expect(session.token).toBeTruthy();

    const audit = await auditOf(res.body.user.id);
    expect(audit.map((a) => a.action)).toContain(AuditAction.USER_CREATED);
    const created = audit.find((a) => a.action === AuditAction.USER_CREATED)!;
    expect(created.actorId).toBe(admin.id);
    expect(created.metadata).toEqual({
      login: loginName,
      role: 'USER',
      warehouseIds: [warehouseA],
    });
    expectNoSecrets(audit, res.body.generatedPassword);
  });

  it('client parol yoki maxfiy maydon yubora olmaydi → 400 (parolni faqat server yaratadi)', async () => {
    for (const extra of [
      { password: '111111' },
      { passwordHash: 'v1$x' },
      { permissions: ['users.manage'] },
      { status: 'BLOCKED' },
    ]) {
      const res = await createViaApi({ login: uniqueLogin(), role: 'USER', ...extra }).expect(400);
      expect(res.body.error.code).toBe('VALIDATION_ERROR');
    }
  });

  it('takroriy login (katta-kichik harf farqisiz) → 409 LOGIN_TAKEN, maydon xatosi bilan', async () => {
    const res = await createViaApi({ login: 'BOSH', role: 'USER' }).expect(409);
    expect(res.body.error).toMatchObject({
      code: 'LOGIN_TAKEN',
      details: [{ field: 'login', message: 'Bu login band. Boshqa login kiriting' }],
    });
  });

  it('login formati va ism validatsiyasi: o‘zbekcha xabarlar', async () => {
    const res = await createViaApi({
      login: 'ali vali',
      fullName: 'a\u0007b',
      role: 'BOSS',
    }).expect(400);
    const fields = res.body.error.details.map((d: { field: string }) => d.field).sort();
    expect(fields).toEqual(['fullName', 'login', 'role']);
  });

  it('ombor: mavjud emas → 404, nofaol → 422, takror → 400; xatoda user yaratilmaydi', async () => {
    const loginName = uniqueLogin('yoq');
    await createViaApi({
      login: loginName,
      role: 'USER',
      warehouseIds: ['01990000-0000-7000-8000-000000000000'],
    }).expect(404);
    await createViaApi({ login: loginName, role: 'USER', warehouseIds: [warehouseInactive] })
      .expect(422)
      .expect((r) => expect(r.body.error.code).toBe('WAREHOUSE_INACTIVE'));
    await createViaApi({
      login: loginName,
      role: 'USER',
      warehouseIds: [warehouseA, warehouseA],
    }).expect(400);
    expect(await t.prisma.user.count({ where: { login: loginName } })).toBe(0);
  });
});

describe('ruxsatlar (RBAC, AC-18)', () => {
  let sellerToken: string;
  let target: string;

  beforeAll(async () => {
    const seller = await createUser(t, { password: SELLER_PASSWORD, warehouseIds: [warehouseA] });
    sellerToken = (await signIn(seller.login, SELLER_PASSWORD)).token;
    target = (await createUser(t, { password: PASSWORD })).id;
  });

  it('anonim → 401 barcha users endpointlarida', async () => {
    await api('get', '/users').expect(401);
    await api('get', `/users/${target}`).expect(401);
    await api('post', '/users').send({}).expect(401);
  });

  it('USER (sotuvchi) → 403: ro‘yxat, yaratish, tahrirlash, rol, holat, parol, omborlar', async () => {
    const calls = [
      api('get', '/users', sellerToken),
      api('get', `/users/${target}`, sellerToken),
      api('get', '/users/warehouse-options', sellerToken),
      api('post', '/users', sellerToken).send({ login: uniqueLogin(), role: 'ADMIN' }),
      api('patch', `/users/${target}`, sellerToken).send({ role: 'ADMIN' }),
      api('patch', `/users/${target}/status`, sellerToken).send({ status: 'BLOCKED' }),
      api('post', `/users/${target}/reset-password`, sellerToken),
      api('put', `/users/${target}/warehouses`, sellerToken).send({ warehouseIds: [warehouseB] }),
    ];
    for (const res of await Promise.all(calls)) {
      expect(res.status).toBe(403);
      expect(res.body.error.code).toBe('FORBIDDEN');
    }
    const row = await t.prisma.user.findUniqueOrThrow({
      where: { id: target },
      include: { role: true },
    });
    expect(row.role.code).toBe('USER');
    expect(row.status).toBe('ACTIVE');
  });

  it('o‘z rolini oshirishga urinish (USER → ADMIN, o‘z ID’si bilan) → 403', async () => {
    const me = await api('get', '/auth/me', sellerToken).expect(200);
    await api('patch', `/users/${me.body.id}`, sellerToken).send({ role: 'ADMIN' }).expect(403);
  });
});

describe('GET /users — server tomonida qidiruv, filtr, saralash, pagination', () => {
  const prefix = `qidir${Date.now().toString(36)}`;

  beforeAll(async () => {
    await createUser(t, { password: PASSWORD, login: `${prefix}a` });
    await createUser(t, { password: PASSWORD, login: `${prefix}b`, status: 'BLOCKED' });
    await createUser(t, { password: PASSWORD, login: `${prefix}c`, role: 'ADMIN' });
  });

  it('qidiruv barcha yozuvlar bo‘yicha (sahifa emas), filtr va pagination meta', async () => {
    const all = await api(
      'get',
      `/users?search=${prefix.toUpperCase()}&sort=login:asc`,
      adminToken,
    ).expect(200);
    expect(all.body.data.map((u: { login: string }) => u.login)).toEqual([
      `${prefix}a`,
      `${prefix}b`,
      `${prefix}c`,
    ]);
    expect(all.body.meta).toMatchObject({ page: 1, total: 3 });

    const page2 = await api(
      'get',
      `/users?search=${prefix}&sort=login:asc&pageSize=2&page=2`,
      adminToken,
    ).expect(200);
    expect(page2.body.data.map((u: { login: string }) => u.login)).toEqual([`${prefix}c`]);
    expect(page2.body.meta).toMatchObject({ page: 2, pageSize: 2, total: 3, totalPages: 2 });

    const blocked = await api('get', `/users?search=${prefix}&status=BLOCKED`, adminToken);
    expect(blocked.body.data.map((u: { login: string }) => u.login)).toEqual([`${prefix}b`]);
    const admins = await api('get', `/users?search=${prefix}&role=ADMIN`, adminToken);
    expect(admins.body.data.map((u: { login: string }) => u.login)).toEqual([`${prefix}c`]);
  });

  it('LIKE belgilari (`_`, `%`) oddiy belgi sifatida qidiriladi', async () => {
    const res = await api('get', '/users?search=%25', adminToken).expect(200);
    expect(res.body.meta.total).toBe(0);
    const underscore = await api('get', '/users?search=_', adminToken).expect(200);
    expect(underscore.body.meta.total).toBe(0);
    // Musbat holat: `_` haqiqatan ismda bo'lsa — topiladi (ikki marta ekranlanmagan).
    const named = await createUser(t, { password: PASSWORD });
    await t.prisma.user.update({ where: { id: named.id }, data: { fullName: 'Ism_Familiya 50%' } });
    const found = await api('get', '/users?search=m_F', adminToken).expect(200);
    expect(found.body.data.map((u: { id: string }) => u.id)).toEqual([named.id]);
    const percent = await api('get', '/users?search=50%25', adminToken).expect(200);
    expect(percent.body.data.map((u: { id: string }) => u.id)).toEqual([named.id]);
  });

  it('ro‘yxat va detalda parol, hash, sessiya ma’lumoti yo‘q; noto‘g‘ri sort → 400', async () => {
    const list = await api('get', `/users?search=${prefix}`, adminToken).expect(200);
    const detail = await api('get', `/users/${list.body.data[0].id}`, adminToken).expect(200);
    for (const body of [list.body, detail.body]) {
      expect(JSON.stringify(body)).not.toMatch(/password|hash|token|session|failed/i);
    }
    await api('get', '/users?sort=passwordHash:asc', adminToken).expect(400);
    await api('get', '/users/yoq-id', adminToken).expect(400);
    await api('get', '/users/01990000-0000-7000-8000-000000000000', adminToken).expect(404);
  });
});

describe('PATCH /users/:id — tahrirlash (bitta tranzaksiya)', () => {
  it('ism, rol va omborlar o‘zgaradi; audit before/after; login o‘zgarmaydi', async () => {
    const user = await createUser(t, { password: PASSWORD, warehouseIds: [warehouseA] });
    const res = await api('patch', `/users/${user.id}`, adminToken)
      .send({ fullName: 'Yangi Ism', role: 'ADMIN', warehouseIds: [warehouseA, warehouseB] })
      .expect(200);
    expect(res.body).toMatchObject({ fullName: 'Yangi Ism', role: 'ADMIN', login: user.login });
    expect(res.body.warehouses.map((w: { id: string }) => w.id).sort()).toEqual(
      [warehouseA, warehouseB].sort(),
    );
    await api('patch', `/users/${user.id}`, adminToken).send({ login: 'boshqa' }).expect(400);
    await api('patch', `/users/${user.id}`, adminToken).send({}).expect(400);

    const audit = await auditOf(user.id);
    const updated = audit.find((a) => a.action === AuditAction.USER_UPDATED)!;
    expect(updated.metadata).toMatchObject({
      changes: {
        fullName: { from: 'Test Foydalanuvchi', to: 'Yangi Ism' },
        role: { from: 'USER', to: 'ADMIN' },
      },
    });
    const wh = audit.find((a) => a.action === AuditAction.USER_WAREHOUSES_CHANGED)!;
    expect(wh.metadata).toMatchObject({ added: [warehouseB], removed: [] });
  });

  it('xato bo‘lsa hech narsa saqlanmaydi: ism + nofaol ombor → 422, ism va omborlar eskicha', async () => {
    const user = await createUser(t, { password: PASSWORD, warehouseIds: [warehouseA] });
    const auditBefore = (await auditOf(user.id)).length;
    await api('patch', `/users/${user.id}`, adminToken)
      .send({ fullName: 'Saqlanmasligi kerak', warehouseIds: [warehouseInactive] })
      .expect(422);
    const row = await t.prisma.user.findUniqueOrThrow({
      where: { id: user.id },
      include: { warehouses: true },
    });
    expect(row.fullName).toBe('Test Foydalanuvchi');
    expect(row.warehouses.map((w) => w.warehouseId)).toEqual([warehouseA]);
    expect((await auditOf(user.id)).length).toBe(auditBefore);
  });

  it('admin o‘z rolini o‘zgartira olmaydi (403), ismini esa o‘zgartira oladi', async () => {
    const res = await api('patch', `/users/${admin.id}`, adminToken)
      .send({ role: 'USER' })
      .expect(403);
    expect(res.body.error.code).toBe('CANNOT_MODIFY_SELF');
    await api('patch', `/users/${admin.id}`, adminToken)
      .send({ fullName: 'Bosh administrator' })
      .expect(200);
  });
});

describe('PATCH /users/:id/status — bloklash (BR-27, BR-28)', () => {
  it('bloklash darhol kuchga kiradi: access token 401, refresh 401, login 403; lockout o‘zgarmaydi; blokdan chiqarish', async () => {
    const user = await createUser(t, { password: SELLER_PASSWORD });
    const session = await signIn(user.login, SELLER_PASSWORD);
    await api('get', '/auth/me', session.token).expect(200);
    const lockedUntil = new Date(t.clock.now().getTime() + 600_000);
    await t.prisma.user.update({
      where: { id: user.id },
      data: { lockedUntil, failedLoginAttempts: 0, lockoutCount: 1 },
    });

    const res = await api('patch', `/users/${user.id}/status`, adminToken)
      .send({ status: 'BLOCKED' })
      .expect(200);
    expect(res.body).toMatchObject({ status: 'BLOCKED', lockedUntil: lockedUntil.toISOString() });

    const me = await api('get', '/auth/me', session.token).expect(401);
    expect(me.body.error.code).toBe('ACCOUNT_BLOCKED');
    await refresh(t, session.cookie).expect(401);
    const sessions = await t.prisma.userSession.findMany({ where: { userId: user.id } });
    expect(sessions.every((s) => s.revokedAt !== null)).toBe(true);
    expect(sessions.some((s) => s.revokedReason === 'USER_BLOCKED')).toBe(true);

    const row = await t.prisma.user.findUniqueOrThrow({ where: { id: user.id } });
    expect(row.lockedUntil?.toISOString()).toBe(lockedUntil.toISOString());
    expect(row.lockoutCount).toBe(1);

    await api('patch', `/users/${user.id}/status`, adminToken)
      .send({ status: 'ACTIVE' })
      .expect(200);
    const unlocked = await t.prisma.user.findUniqueOrThrow({ where: { id: user.id } });
    expect(unlocked.lockedUntil?.toISOString()).toBe(lockedUntil.toISOString());

    const audit = (await auditOf(user.id)).filter(
      (a) => a.action === AuditAction.USER_STATUS_CHANGED,
    );
    expect(audit.map((a) => a.metadata)).toEqual([
      expect.objectContaining({ from: 'ACTIVE', to: 'BLOCKED', revokedSessions: 1 }),
      expect.objectContaining({ from: 'BLOCKED', to: 'ACTIVE', revokedSessions: 0 }),
    ]);
  });

  it('o‘zini bloklash → 403 CANNOT_MODIFY_SELF (admin bloklanib qolmaydi)', async () => {
    const res = await api('patch', `/users/${admin.id}/status`, adminToken)
      .send({ status: 'BLOCKED' })
      .expect(403);
    expect(res.body.error.code).toBe('CANNOT_MODIFY_SELF');
    await api('get', '/auth/me', adminToken).expect(200);
  });

  it('noma’lum holat → 400', async () => {
    const user = await createUser(t, { password: PASSWORD });
    await api('patch', `/users/${user.id}/status`, adminToken)
      .send({ status: 'DELETED' })
      .expect(400);
  });
});

describe('POST /users/:id/reset-password (BR-29)', () => {
  it('yangi parol ishlaydi, eskisi ishlamaydi; eski access va refresh tokenlar bekor; lockout tozalanadi; audit parolsiz', async () => {
    const user = await createUser(t, { password: SELLER_PASSWORD });
    const session = await signIn(user.login, SELLER_PASSWORD);
    await t.prisma.user.update({
      where: { id: user.id },
      data: {
        lockedUntil: new Date(t.clock.now().getTime() + 600_000),
        lockoutCount: 2,
        failedLoginAttempts: 3,
      },
    });
    // Token soniya aniqligida: tiklash keyingi soniyada (SECURITY §1 — iat >= password_changed_at).
    t.clock.advance(2_000);

    const res = await api('post', `/users/${user.id}/reset-password`, adminToken).expect(200);
    expect(res.headers['cache-control']).toBe('no-store');
    expect(Object.keys(res.body)).toEqual(['generatedPassword']);
    const password: string = res.body.generatedPassword;
    expect(password).toMatch(/^\d{6}$/);

    const me = await api('get', '/auth/me', session.token).expect(401);
    expect(me.body.error.code).toBe('SESSION_EXPIRED');
    await refresh(t, session.cookie).expect(401);
    const sessions = await t.prisma.userSession.findMany({ where: { userId: user.id } });
    expect(sessions.some((s) => s.revokedReason === 'PASSWORD_RESET')).toBe(true);

    const row = await t.prisma.user.findUniqueOrThrow({ where: { id: user.id } });
    expect(row).toMatchObject({ lockedUntil: null, lockoutCount: 0, failedLoginAttempts: 0 });
    expect(row.passwordHash).not.toContain(password);

    if (password !== SELLER_PASSWORD) {
      await login(t, { login: user.login, password: SELLER_PASSWORD }).expect(401);
    }
    const fresh = await signIn(user.login, password);
    await api('get', '/auth/me', fresh.token).expect(200);

    const audit = (await auditOf(user.id)).filter(
      (a) => a.action === AuditAction.USER_PASSWORD_RESET,
    );
    expect(audit).toHaveLength(1);
    expect(audit[0]!.metadata).toMatchObject({ revokedSessions: 1, lockCleared: true });
    expectNoSecrets(audit, password);
  });

  it('o‘z parolini admin endpointi orqali tiklash → 403; bloklangan user holati o‘zgarmaydi', async () => {
    await api('post', `/users/${admin.id}/reset-password`, adminToken).expect(403);
    const blocked = await createUser(t, { password: PASSWORD, status: 'BLOCKED' });
    await api('post', `/users/${blocked.id}/reset-password`, adminToken).expect(200);
    const row = await t.prisma.user.findUniqueOrThrow({ where: { id: blocked.id } });
    expect(row.status).toBe('BLOCKED');
  });
});

describe('ombor biriktirish va ownership (OWN-01…03)', () => {
  it('bitta va bir nechta ombor; biriktirilmagan omborga ID bilan ham kirib bo‘lmaydi; olib tashlash darhol kuchga kiradi', async () => {
    const created = await createViaApi({
      login: uniqueLogin('kassir'),
      role: 'USER',
      warehouseIds: [warehouseA],
    }).expect(201);
    const user = created.body.user;
    const session = await signIn(user.login, created.body.generatedPassword);
    const probe = (warehouseId: string) =>
      api('get', `/__rbac/warehouses/${warehouseId}`, session.token);

    await probe(warehouseA).expect(200);
    const denied = await probe(warehouseB).expect(403);
    expect(denied.body.error.code).toBe('WAREHOUSE_ACCESS_DENIED');

    const both = await api('put', `/users/${user.id}/warehouses`, adminToken)
      .send({ warehouseIds: [warehouseA, warehouseB] })
      .expect(200);
    expect(both.body.warehouses.map((w: { name: string }) => w.name)).toEqual([
      'Asosiy ombor',
      'Filial ombori',
    ]);
    await probe(warehouseB).expect(200);

    // O'sha access token bilan: biriktirish olib tashlangach keyingi so'rov darhol rad etiladi.
    await api('put', `/users/${user.id}/warehouses`, adminToken)
      .send({ warehouseIds: [warehouseA] })
      .expect(200);
    await probe(warehouseB).expect(403);
    await api('put', `/users/${user.id}/warehouses`, adminToken)
      .send({ warehouseIds: [] })
      .expect(200);
    await probe(warehouseA).expect(403);

    const ctx = await api('get', '/__rbac/context', session.token).expect(200);
    expect(ctx.body.warehouseIds).toEqual([]);
  });

  it('avval biriktirilgan ombor keyin nofaol bo‘lsa, saqlanib qoladi; yangisini qo‘shib bo‘lmaydi', async () => {
    const user = await createUser(t, { password: PASSWORD, warehouseIds: [warehouseA] });
    const closing = (
      await t.prisma.warehouse.create({ data: { name: 'Yopiladigan', createdById: admin.id } })
    ).id;
    await api('put', `/users/${user.id}/warehouses`, adminToken)
      .send({ warehouseIds: [warehouseA, closing] })
      .expect(200);
    await t.prisma.warehouse.update({ where: { id: closing }, data: { status: 'INACTIVE' } });
    await api('patch', `/users/${user.id}`, adminToken)
      .send({ fullName: 'Ism', warehouseIds: [warehouseA, closing] })
      .expect(200);
    await api('put', `/users/${user.id}/warehouses`, adminToken)
      .send({ warehouseIds: [warehouseA, closing, warehouseInactive] })
      .expect(422);
  });

  it('warehouse-options: faqat ACTIVE omborlar, nom bo‘yicha', async () => {
    const res = await api('get', '/users/warehouse-options', adminToken).expect(200);
    const names = res.body.map((w: { name: string }) => w.name);
    expect(names).toContain('Asosiy ombor');
    expect(names).not.toContain('Yopilgan ombor');
    expect([...names].sort((a: string, b: string) => a.localeCompare(b))).toEqual(names);
  });
});

describe('oxirgi faol ADMIN (BR-27)', () => {
  it('ikki admin bir vaqtda bir-birini USER qilsa — faqat bittasi o‘tadi, kamida bitta faol ADMIN qoladi', async () => {
    const a = await createUser(t, { password: PASSWORD, role: 'ADMIN' });
    const b = await createUser(t, { password: PASSWORD, role: 'ADMIN' });
    // Shu toza DB'da boshqa faol adminlar bo'lmasin: faqat a va b.
    await t.prisma.user.updateMany({
      where: { role: { code: 'ADMIN' }, id: { notIn: [a.id, b.id] } },
      data: { status: 'BLOCKED' },
    });
    try {
      const tokenA = (await signIn(a.login, PASSWORD)).token;
      const tokenB = (await signIn(b.login, PASSWORD)).token;
      const results = await Promise.all([
        api('patch', `/users/${b.id}`, tokenA).send({ role: 'USER' }),
        api('patch', `/users/${a.id}`, tokenB).send({ role: 'USER' }),
      ]);
      const statuses = results.map((r) => r.status).sort();
      expect(statuses.filter((s) => s === 200)).toHaveLength(1);
      const loser = results.find((r) => r.status !== 200)!;
      // Advisory lock ortida kutgan so'rov — 409; guard'dan keyin kelgani (ruxsati olingan) — 403.
      expect(['LAST_ACTIVE_ADMIN', 'FORBIDDEN']).toContain(loser.body.error.code);
      const activeAdmins = await t.prisma.user.count({
        where: { role: { code: 'ADMIN' }, status: 'ACTIVE' },
      });
      expect(activeAdmins).toBe(1);
    } finally {
      await t.prisma.user.updateMany({
        where: { role: { code: 'ADMIN' } },
        data: { status: 'ACTIVE' },
      });
    }
  });
});

describe('frontend origin: CORS orqali users endpointlari', () => {
  it('ruxsat etilgan origin bilan preflight PATCH/PUT ga ruxsat beradi', async () => {
    const res = await http()
      .options('/api/v1/users/01990000-0000-7000-8000-000000000000/warehouses')
      .set('Origin', ORIGIN)
      .set('Access-Control-Request-Method', 'PUT');
    expect(res.status).toBe(204);
    expect(res.headers['access-control-allow-methods']).toMatch(/PUT/);
  });
});
