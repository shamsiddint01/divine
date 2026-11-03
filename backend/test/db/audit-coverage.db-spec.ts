import { randomUUID } from 'node:crypto';
import { RequestMethod } from '@nestjs/common';
import { METHOD_METADATA, PATH_METADATA } from '@nestjs/common/constants.js';
import { DiscoveryService, MetadataScanner } from '@nestjs/core';
import { AUDIT_ACTIONS, type AuditAction } from '@divine/shared';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  type AuthTestApp,
  createAuthApp,
  createUser,
  login,
  ORIGIN,
  refreshCookieOf,
  uniqueIp,
} from './support/auth-app.js';
import { closePool } from './support/db.js';

/*
 * AC-21 / REQ-120 / BR-24: har bir mutatsiya endpointi audit yozadi. Endpointlar Nest metadata'sidan
 * topiladi (ro'yxat qo'lda emas): yangi POST/PATCH/PUT/DELETE qo'shilib, bu jadvalga kiritilmasa —
 * test yiqiladi. Har bir chaqiruv o'z `X-Request-Id`si bilan; audit yozuvi aynan shu so'rovniki
 * (`request_id`), to'g'ri amal, actor va obyekt bilan ekani tekshiriladi. Oxirida `AuditAction`
 * katalogidagi har bir amal real oqimda paydo bo'lgani tekshiriladi.
 */
const EXPECTED: Record<string, AuditAction | { exempt: string }> = {
  'POST /auth/login': 'AUTH_LOGIN_SUCCEEDED',
  // Oddiy rotatsiya — har 15 daqiqada, biznes mutatsiyasi emas; o'g'irlangan token qayta ishlatilishi
  // (`AUTH_REFRESH_REUSE_DETECTED`) audit qilinadi — quyida alohida tekshiriladi.
  'POST /auth/refresh': { exempt: 'sessiya rotatsiyasi; reuse — AUTH_REFRESH_REUSE_DETECTED' },
  'POST /auth/logout': 'AUTH_LOGOUT',
  'POST /users': 'USER_CREATED',
  'PATCH /users/:id': 'USER_UPDATED',
  'PATCH /users/:id/status': 'USER_STATUS_CHANGED',
  'POST /users/:id/reset-password': 'USER_PASSWORD_RESET',
  'PUT /users/:id/warehouses': 'USER_WAREHOUSES_CHANGED',
  'POST /product-groups': 'PRODUCT_GROUP_CREATED',
  'PATCH /product-groups/:id': 'PRODUCT_GROUP_UPDATED',
  'DELETE /product-groups/:id': 'PRODUCT_GROUP_DELETED',
  'POST /products': 'PRODUCT_CREATED',
  'PATCH /products/:id': 'PRODUCT_UPDATED',
  'PATCH /products/:id/status': 'PRODUCT_STATUS_CHANGED',
  'POST /products/:id/stock': 'INCOMING_CONFIRMED',
  'POST /warehouses': 'WAREHOUSE_CREATED',
  'PATCH /warehouses/:id': 'WAREHOUSE_UPDATED',
  'PATCH /warehouses/:id/status': 'WAREHOUSE_STATUS_CHANGED',
  'POST /customers': 'CUSTOMER_CREATED',
  'PATCH /customers/:id': 'CUSTOMER_UPDATED',
  'POST /sales': 'SALE_CREATED',
  'POST /expense-categories': 'EXPENSE_CATEGORY_CREATED',
  'PATCH /expense-categories/:id': 'EXPENSE_CATEGORY_UPDATED',
  'DELETE /expense-categories/:id': 'EXPENSE_CATEGORY_DELETED',
  'POST /expenses': 'EXPENSE_CREATED',
  'PATCH /expenses/:id': 'EXPENSE_UPDATED',
  'DELETE /expenses/:id': 'EXPENSE_DELETED',
  'PATCH /settings': 'SETTINGS_UPDATED',
};

const PASSWORD = '582913';
let t: AuthTestApp;
let admin: { id: string; login: string };
let token: string;
let originalCompanyName: string;
/** Real oqimda paydo bo'lgan amallar. */
const produced = new Set<string>();
/** Chaqirilgan va audit'i tekshirilgan endpointlar. */
const covered = new Set<string>();

type Method = 'get' | 'post' | 'patch' | 'put' | 'delete';

/** Mutatsiyani o'z request ID'si bilan bajaradi; shu so'rovning audit yozuvlarini qaytaradi. */
async function call(
  method: Method,
  path: string,
  opts: { body?: object; token?: string | null; headers?: Record<string, string> } = {},
) {
  const requestId = randomUUID();
  const req = request(t.app.getHttpServer())
    [method](`/api/v1${path}`)
    .set('X-Forwarded-For', uniqueIp())
    .set('X-Request-Id', requestId);
  const bearer = opts.token === undefined ? token : opts.token;
  if (bearer) req.set('Authorization', `Bearer ${bearer}`);
  for (const [key, value] of Object.entries(opts.headers ?? {})) req.set(key, value);
  const res = await (opts.body ? req.send(opts.body) : req);
  const audits = await t.prisma.auditLog.findMany({ where: { requestId }, orderBy: { id: 'asc' } });
  for (const a of audits) produced.add(a.action);
  return { res, audits };
}

/** `route` — EXPECTED kaliti; bitta audit, kutilgan amal, actor va (berilsa) obyekt bilan. */
async function expectAudited(
  route: string,
  method: Method,
  path: string,
  opts: Parameters<typeof call>[2] & { status: number; actorId?: string | null; entityId?: string },
) {
  const { res, audits } = await call(method, path, opts);
  expect(res.status, `${route}: ${JSON.stringify(res.body)}`).toBe(opts.status);
  const expected = EXPECTED[route];
  expect(typeof expected, route).toBe('string');
  expect(
    audits.map((a) => a.action),
    route,
  ).toContain(expected);
  const entry = audits.find((a) => a.action === expected)!;
  expect(entry.actorId, route).toBe(opts.actorId === undefined ? admin.id : opts.actorId);
  if (opts.entityId) expect(entry.entityId, route).toBe(opts.entityId);
  expect(entry.metadata, route).not.toHaveProperty('password');
  covered.add(route);
  return res;
}

function mutatingRoutes(): string[] {
  const discovery = t.app.get(DiscoveryService);
  const scanner = new MetadataScanner();
  const routes: string[] = [];
  for (const wrapper of discovery.getControllers()) {
    const controller = wrapper.metatype as object | undefined;
    const instance = wrapper.instance as object | undefined;
    if (!controller || !instance) continue;
    const base = String(Reflect.getMetadata(PATH_METADATA, controller) ?? '');
    const prototype = Object.getPrototypeOf(instance) as Record<string, unknown>;
    for (const name of scanner.getAllMethodNames(prototype)) {
      const handler = prototype[name] as object;
      const path = Reflect.getMetadata(PATH_METADATA, handler) as string | undefined;
      const method = Reflect.getMetadata(METHOD_METADATA, handler) as RequestMethod | undefined;
      if (path === undefined || method === undefined) continue;
      const verb = RequestMethod[method];
      if (verb === 'GET' || verb === 'HEAD' || verb === 'OPTIONS') continue;
      const full = `/${[base, path].filter((p) => p && p !== '/').join('/')}`.replace(/\/+/g, '/');
      routes.push(`${verb} ${full}`);
    }
  }
  return routes.sort();
}

beforeAll(async () => {
  t = await createAuthApp();
  const user = await createUser(t, { password: PASSWORD, role: 'ADMIN' });
  admin = { id: user.id, login: user.login };
  token = (await login(t, { login: user.login, password: PASSWORD }).expect(200)).body.accessToken;
  originalCompanyName = (
    await request(t.app.getHttpServer())
      .get('/api/v1/settings')
      .set('Authorization', `Bearer ${token}`)
      .expect(200)
  ).body.companyName;
});

afterAll(async () => {
  await request(t.app.getHttpServer())
    .patch('/api/v1/settings')
    .set('Authorization', `Bearer ${token}`)
    .send({ companyName: originalCompanyName });
  await t?.close();
  await closePool();
});

describe('audit qamrovi (AC-21, REQ-120, BR-24)', () => {
  it('barcha mutatsiya endpointlari jadvalda (yangi endpoint audit qarorisiz qolmaydi)', () => {
    expect(mutatingRoutes()).toEqual(Object.keys(EXPECTED).sort());
  });

  it('har bir mutatsiya — shu so‘rov ID’si bilan audit: amal, actor, obyekt', async () => {
    const id = (res: request.Response, key = 'id') => res.body[key] as string;
    const tagged = (name: string) => `${name} ${randomUUID().slice(0, 8)}`;

    // ── Ombor, guruh, mahsulot ──
    const wh = id(
      await expectAudited('POST /warehouses', 'post', '/warehouses', {
        body: { name: tagged('AC21 ombor') },
        status: 201,
      }),
    );
    await expectAudited('PATCH /warehouses/:id', 'patch', `/warehouses/${wh}`, {
      body: { name: tagged('AC21 ombor yangi') },
      status: 200,
      entityId: wh,
    });
    const wh2 = id(
      (await call('post', '/warehouses', { body: { name: tagged('AC21 ombor 2') } })).res,
    );
    await expectAudited('PATCH /warehouses/:id/status', 'patch', `/warehouses/${wh2}/status`, {
      body: { status: 'INACTIVE' },
      status: 200,
      entityId: wh2,
    });
    const group = id(
      await expectAudited('POST /product-groups', 'post', '/product-groups', {
        body: { name: tagged('AC21 guruh') },
        status: 201,
      }),
    );
    await expectAudited('PATCH /product-groups/:id', 'patch', `/product-groups/${group}`, {
      body: { name: tagged('AC21 guruh yangi') },
      status: 200,
      entityId: group,
    });
    const emptyGroup = id(
      (await call('post', '/product-groups', { body: { name: tagged('AC21 bo‘sh') } })).res,
    );
    await expectAudited('DELETE /product-groups/:id', 'delete', `/product-groups/${emptyGroup}`, {
      status: 204,
      entityId: emptyGroup,
    });
    const productBody = (name: string) => ({
      name: tagged(name),
      groupId: group,
      costPrice: '600',
      salePrice: '1000',
      unit: 'DONA',
      allowDecimal: false,
    });
    const product = id(
      await expectAudited('POST /products', 'post', '/products', {
        body: productBody('AC21 mahsulot'),
        status: 201,
      }),
    );
    await expectAudited('PATCH /products/:id', 'patch', `/products/${product}`, {
      body: { salePrice: '1100' },
      status: 200,
      entityId: product,
    });
    const other = id((await call('post', '/products', { body: productBody('AC21 arxiv') })).res);
    await expectAudited('PATCH /products/:id/status', 'patch', `/products/${other}/status`, {
      body: { status: 'INACTIVE' },
      status: 200,
      entityId: other,
    });

    // ── Userlar ──
    const created = await expectAudited('POST /users', 'post', '/users', {
      body: { login: `ac21${Date.now().toString(36)}`, role: 'USER', warehouseIds: [] },
      status: 201,
    });
    const seller = created.body.user.id as string;
    const sellerPassword = created.body.generatedPassword as string;
    await expectAudited('PATCH /users/:id', 'patch', `/users/${seller}`, {
      body: { fullName: 'AC21 Sotuvchi' },
      status: 200,
      entityId: seller,
    });
    await expectAudited('PUT /users/:id/warehouses', 'put', `/users/${seller}/warehouses`, {
      body: { warehouseIds: [wh] },
      status: 200,
      entityId: seller,
    });
    const reset = await expectAudited(
      'POST /users/:id/reset-password',
      'post',
      `/users/${seller}/reset-password`,
      { status: 200, entityId: seller },
    );
    const newPassword = reset.body.generatedPassword as string;
    expect(newPassword).not.toBe(sellerPassword);

    // ── Qoldiq qo'shish (sobiq Kirim) — kirim hujjati yaratiladi va darhol tasdiqlanadi ──
    await expectAudited('POST /products/:id/stock', 'post', `/products/${product}/stock`, {
      body: { date: '2026-10-09', warehouseId: wh, quantity: '10', costPrice: '600' },
      status: 201,
    });

    // ── Mijoz va sotuv ──
    const customer = id(
      await expectAudited('POST /customers', 'post', '/customers', {
        body: { name: 'AC21 Mijoz' },
        status: 201,
      }),
    );
    await expectAudited('PATCH /customers/:id', 'patch', `/customers/${customer}`, {
      body: { name: 'AC21 Mijoz yangi' },
      status: 200,
      entityId: customer,
    });
    await expectAudited('POST /sales', 'post', '/sales', {
      body: {
        warehouseId: wh,
        customer: { id: customer },
        items: [{ productId: product, quantity: '2' }],
      },
      headers: { 'Idempotency-Key': randomUUID() },
      status: 201,
    });
    // Ism bilan kelgan mijoz sotuv tranzaksiyasida yaratiladi — ikkalasi ham shu so'rovda (D-18).
    const { audits: withNewCustomer } = await call('post', '/sales', {
      body: {
        warehouseId: wh,
        customer: { name: 'AC21 Yangi' },
        items: [{ productId: product, quantity: '1' }],
      },
      headers: { 'Idempotency-Key': randomUUID() },
    });
    expect(withNewCustomer.map((a) => a.action).sort()).toEqual([
      'CUSTOMER_CREATED',
      'SALE_CREATED',
    ]);
    expect(withNewCustomer.find((a) => a.action === 'CUSTOMER_CREATED')!.metadata).toMatchObject({
      source: 'sale',
    });

    // ── Xarajatlar ──
    const category = id(
      await expectAudited('POST /expense-categories', 'post', '/expense-categories', {
        body: { name: tagged('AC21 kategoriya') },
        status: 201,
      }),
    );
    await expectAudited(
      'PATCH /expense-categories/:id',
      'patch',
      `/expense-categories/${category}`,
      {
        body: { name: tagged('AC21 kategoriya yangi') },
        status: 200,
        entityId: category,
      },
    );
    const expense = id(
      await expectAudited('POST /expenses', 'post', '/expenses', {
        body: { date: '2026-10-09', amount: '1000', categoryId: category },
        status: 201,
      }),
    );
    await expectAudited('PATCH /expenses/:id', 'patch', `/expenses/${expense}`, {
      body: { amount: '1500' },
      status: 200,
      entityId: expense,
    });
    await expectAudited('DELETE /expenses/:id', 'delete', `/expenses/${expense}`, {
      status: 204,
      entityId: expense,
    });
    const unused = id(
      (await call('post', '/expense-categories', { body: { name: tagged('AC21 bo‘sh kat') } })).res,
    );
    await expectAudited(
      'DELETE /expense-categories/:id',
      'delete',
      `/expense-categories/${unused}`,
      {
        status: 204,
        entityId: unused,
      },
    );

    // ── Sozlamalar ──
    await expectAudited('PATCH /settings', 'patch', '/settings', {
      body: { companyName: `AC21 ${randomUUID().slice(0, 6)}` },
      status: 200,
    });

    // ── Auth: login, logout, refresh reuse, xato login, lock ──
    const loginRes = await expectAudited('POST /auth/login', 'post', '/auth/login', {
      body: { login: created.body.user.login, password: newPassword },
      token: null,
      status: 200,
      actorId: seller,
    });
    const cookie = refreshCookieOf(loginRes);
    const csrf = { Origin: ORIGIN, 'X-Requested-With': 'XMLHttpRequest' };
    const rotated = await call('post', '/auth/refresh', {
      token: null,
      headers: { ...csrf, Cookie: cookie },
    });
    expect(rotated.res.status).toBe(200);
    expect(rotated.audits).toEqual([]);
    covered.add('POST /auth/refresh');
    const reuse = await call('post', '/auth/refresh', {
      token: null,
      headers: { ...csrf, Cookie: cookie },
    });
    expect(reuse.res.status).toBe(401);
    expect(reuse.audits.map((a) => a.action)).toEqual(['AUTH_REFRESH_REUSE_DETECTED']);
    expect(reuse.audits[0]!.actorId).toBe(seller);

    const again = refreshCookieOf(
      (
        await call('post', '/auth/login', {
          body: { login: created.body.user.login, password: newPassword },
          token: null,
        })
      ).res,
    );
    await expectAudited('POST /auth/logout', 'post', '/auth/logout', {
      token: null,
      headers: { ...csrf, Cookie: again },
      status: 204,
      actorId: seller,
    });

    const victim = await createUser(t, { password: PASSWORD });
    let locked = false;
    for (let i = 0; i < 10 && !locked; i++) {
      const { res, audits } = await call('post', '/auth/login', {
        body: { login: victim.login, password: '000000' },
        token: null,
      });
      expect([401, 423]).toContain(res.status);
      expect(audits.every((a) => a.actorId === null)).toBe(true);
      locked = audits.some((a) => a.action === 'AUTH_ACCOUNT_LOCKED');
    }
    expect(locked).toBe(true);
    expect(produced).toContain('AUTH_LOGIN_FAILED');

    // ── User holati (oxirida — bloklangan user boshqa qadamlarda ishlatilmaydi) ──
    await expectAudited('PATCH /users/:id/status', 'patch', `/users/${seller}/status`, {
      body: { status: 'BLOCKED' },
      status: 200,
      entityId: seller,
    });

    // ── Reconciliation (GET, lekin har bir ishga tushirish audit qilinadi) ──
    const recon = await call('get', '/inventory/reconciliation');
    expect(recon.res.status).toBe(200);
    expect(recon.audits.map((a) => a.action)).toEqual(['INVENTORY_RECONCILIATION_RUN']);
  });

  it('har bir endpoint chaqirildi va AuditAction katalogidagi har bir amal real oqimda paydo bo‘ldi', () => {
    expect([...covered].sort()).toEqual(Object.keys(EXPECTED).sort());
    // Sobiq "Kirim" bo'limining amallari: endpointi yo'q, lekin eski audit yozuvlari uchun katalogda qoladi.
    const historical = new Set<string>([
      'INCOMING_CREATED',
      'INCOMING_UPDATED',
      'INCOMING_CANCELLED',
    ]);
    expect([...produced].sort()).toEqual(
      [...AUDIT_ACTIONS].filter((a) => !historical.has(a)).sort(),
    );
  });

  it('muvaffaqiyatsiz mutatsiya audit qoldirmaydi (amal bilan bitta tranzaksiya)', async () => {
    const name = `AC21 takror ${randomUUID().slice(0, 8)}`;
    expect((await call('post', '/expense-categories', { body: { name } })).res.status).toBe(201);
    const duplicate = await call('post', '/expense-categories', { body: { name } });
    expect(duplicate.res.status).toBe(409);
    expect(duplicate.audits).toEqual([]);
    const invalid = await call('post', '/products', { body: { name: 'x' } });
    expect(invalid.res.status).toBe(400);
    expect(invalid.audits).toEqual([]);
  });
});
