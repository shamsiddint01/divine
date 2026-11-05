import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  type AuthTestApp,
  createAuthApp,
  createUser,
  login,
  uniqueIp,
  uniqueLogin,
} from './support/auth-app.js';
import { closePool, withCommit } from './support/db.js';
import { createGroup, createWarehouse } from './support/fixtures.js';

const PASSWORD = '582913';
let t: AuthTestApp;
let token: string;
let adminId: string;
let warehouseId: string;
let groupId: string;

function api(method: 'get' | 'post' | 'patch', path: string) {
  return request(t.app.getHttpServer())
    [method](`/api/v1${path}`)
    .set('X-Forwarded-For', uniqueIp())
    .set({ Authorization: `Bearer ${token}` });
}

const productBody = (extra: Record<string, unknown>) => ({
  name: uniqueLogin('Optom'),
  groupId,
  costPrice: '700',
  unit: 'DONA',
  allowDecimal: false,
  initialStock: { warehouseId, quantity: '50', date: '2026-10-09' },
  ...extra,
});

const product = async (extra: Record<string, unknown>) =>
  (await api('post', '/products').send(productBody(extra)).expect(201)).body;

const sell = (productId: string, priceType?: string, key: string = randomUUID()) =>
  api('post', '/sales')
    .set('Idempotency-Key', key)
    .send({
      warehouseId,
      customer: { name: null, phone: null },
      ...(priceType ? { priceType } : {}),
      items: [{ productId, quantity: '2' }],
    });

beforeAll(async () => {
  t = await createAuthApp();
  const admin = await createUser(t, { password: PASSWORD, role: 'ADMIN' });
  adminId = admin.id;
  token = (await login(t, { login: admin.login, password: PASSWORD }).expect(200)).body.accessToken;
  [warehouseId, groupId] = await withCommit(async (db) => [
    await createWarehouse(db, adminId),
    await createGroup(db, adminId),
  ]);
});

afterAll(async () => {
  await t?.close();
  await closePool();
});

describe('mahsulot narxlari (D-25): kamida bittasi', () => {
  it('faqat dona, faqat optom, ikkalasi — 201; ikkalasi ham yo‘q → 400', async () => {
    expect(await product({ salePrice: '1000' })).toMatchObject({
      salePrice: '1000.00',
      wholesalePrice: null,
    });
    expect(await product({ wholesalePrice: '900' })).toMatchObject({
      salePrice: null,
      wholesalePrice: '900.00',
    });
    const res = await api('post', '/products').send(productBody({})).expect(400);
    expect(res.body.error.details[0].field).toBe('salePrice');
    await api('post', '/products')
      .send(productBody({ salePrice: '', wholesalePrice: '' }))
      .expect(400);
  });

  it('tahrirlashda oxirgi narxni o‘chirib bo‘lmaydi; ikkinchisi bor bo‘lsa — mumkin', async () => {
    const p = await product({ salePrice: '1000', wholesalePrice: '900' });
    await api('patch', `/products/${p.id}`).send({ salePrice: null }).expect(200);
    const res = await api('patch', `/products/${p.id}`).send({ wholesalePrice: null }).expect(400);
    expect(res.body.error.details[0].field).toBe('salePrice');
  });
});

describe('sotuv: dona yoki optom narx', () => {
  it('optom — optom narx, dona — dona narx; standart dona; sotuvda narx turi saqlanadi', async () => {
    const p = await product({ salePrice: '1000', wholesalePrice: '900' });
    const wholesale = await sell(p.id, 'WHOLESALE').expect(201);
    expect(wholesale.body).toMatchObject({ priceType: 'WHOLESALE', totalAmount: '1800.00' });
    expect(wholesale.body.items[0].unitPrice).toBe('900.00');
    const retail = await sell(p.id, 'RETAIL').expect(201);
    expect(retail.body).toMatchObject({ priceType: 'RETAIL', totalAmount: '2000.00' });
    const byDefault = await sell(p.id).expect(201);
    expect(byDefault.body.priceType).toBe('RETAIL');
    const detail = await api('get', `/sales/${wholesale.body.id}`).expect(200);
    expect(detail.body.priceType).toBe('WHOLESALE');
  });

  it('tanlangan narx yo‘q → 422 PRODUCT_PRICE_MISSING; boshqa narx bilan sotilmaydi, qoldiq o‘zgarmaydi', async () => {
    const onlyRetail = await product({ salePrice: '1000' });
    const onlyWholesale = await product({ wholesalePrice: '900' });
    const a = await sell(onlyRetail.id, 'WHOLESALE').expect(422);
    expect(a.body.error.code).toBe('PRODUCT_PRICE_MISSING');
    expect((await sell(onlyWholesale.id, 'RETAIL').expect(422)).body.error.code).toBe(
      'PRODUCT_PRICE_MISSING',
    );
    const after = await api('get', `/products/${onlyRetail.id}`).expect(200);
    expect(after.body.stock).toBe('50.000');
  });

  it('bir kalit, boshqa narx turi — takrorlash emas: 409', async () => {
    const p = await product({ salePrice: '1000', wholesalePrice: '900' });
    const key = randomUUID();
    await sell(p.id, 'RETAIL', key).expect(201);
    await sell(p.id, 'WHOLESALE', key).expect(409);
  });

  it('client narx yubora olmaydi: noma’lum narx turi yoki `unitPrice` → 400', async () => {
    const p = await product({ salePrice: '1000' });
    await sell(p.id, 'VIP').expect(400);
    await api('post', '/sales')
      .set('Idempotency-Key', randomUUID())
      .send({
        warehouseId,
        customer: { name: null, phone: null },
        items: [{ productId: p.id, quantity: '1', unitPrice: '1' }],
      })
      .expect(400);
  });
});
