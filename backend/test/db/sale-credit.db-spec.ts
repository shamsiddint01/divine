import { randomUUID } from 'node:crypto';
import { AuditAction } from '@divine/shared';
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
const TOMORROW = '2026-10-10';
let t: AuthTestApp;
let adminToken: string;
let sellerToken: string;
let warehouseId: string;
let groupId: string;

function api(method: 'get' | 'post', path: string, token = adminToken) {
  return request(t.app.getHttpServer())
    [method](`/api/v1${path}`)
    .set('X-Forwarded-For', uniqueIp())
    .set({ Authorization: `Bearer ${token}` });
}

const signIn = async (name: string) =>
  (await login(t, { login: name, password: PASSWORD }).expect(200)).body.accessToken as string;

async function product() {
  const res = await api('post', '/products')
    .send({
      name: uniqueLogin('Nasiya'),
      groupId,
      costPrice: '700',
      salePrice: '10000',
      unit: 'DONA',
      allowDecimal: false,
      initialStock: { warehouseId, quantity: '50', date: '2026-10-09' },
    })
    .expect(201);
  return res.body.id as string;
}

const credit = (extra: Record<string, unknown> = {}) => ({
  paidAmount: '12000',
  debtorName: 'Ali Valiyev',
  debtorPhone: '+998901234567',
  firstDueDate: TOMORROW,
  installments: 2,
  ...extra,
});

const sell = (productId: string, body: object, token = adminToken, key: string = randomUUID()) =>
  api('post', '/sales', token)
    .set('Idempotency-Key', key)
    .send({
      warehouseId,
      customer: { name: 'Ali Valiyev', phone: '+998901234567' },
      items: [{ productId, quantity: '3' }],
      ...body,
    });

beforeAll(async () => {
  t = await createAuthApp();
  const admin = await createUser(t, { password: PASSWORD, role: 'ADMIN' });
  adminToken = await signIn(admin.login);
  [warehouseId, groupId] = await withCommit(async (db) => [
    await createWarehouse(db, admin.id),
    await createGroup(db, admin.id),
  ]);
  const seller = await createUser(t, { password: PASSWORD, warehouseIds: [warehouseId] });
  sellerToken = await signIn(seller.login);
});

afterAll(async () => {
  await t?.close();
  await closePool();
});

describe('kassadan nasiya (D-26)', () => {
  it('30 000 lik sotuvda 12 000 to‘landi: qarz 18 000, jadval, sotuv va mahsulotlar nasiyada', async () => {
    const p = await product();
    const res = await sell(p, { credit: credit() }).expect(201);
    expect(res.body).toMatchObject({
      totalAmount: '30000.00',
      credit: { paidAmount: '12000.00', amount: '18000.00' },
    });
    expect(res.body.credit.number).toMatch(/^N-\d{6}$/);

    const list = await api('get', `/credits?search=${res.body.credit.number}`).expect(200);
    const [row] = list.body.data;
    expect(row).toMatchObject({
      amount: '18000.00',
      remainingAmount: '18000.00',
      saleNumber: res.body.number,
      next: { dueDate: TOMORROW, amount: '9000.00' },
    });
    const detail = await api('get', `/credits/${row.id}`).expect(200);
    expect(detail.body.sale).toMatchObject({
      number: res.body.number,
      totalAmount: '30000.00',
      paidAmount: '12000.00',
      items: [{ productId: p, quantity: '3.000', unitPrice: '10000.00', lineTotal: '30000.00' }],
    });
    expect(
      await t.prisma.auditLog.count({
        where: { entityId: row.id, action: AuditAction.CREDIT_CREATED },
      }),
    ).toBe(1);
    const again = await api('get', `/sales/${res.body.id}`).expect(200);
    expect(again.body.credit.amount).toBe('18000.00');
  });

  it('nasiyasiz sotuv avvalgidek: `credit: null`, nasiya yaratilmaydi', async () => {
    const res = await sell(await product(), {}).expect(201);
    expect(res.body.credit).toBeNull();
    expect(await t.prisma.credit.count({ where: { saleId: res.body.id } })).toBe(0);
  });

  it('sotuvchi kassadan yoza oladi, lekin Nasiya bo‘limi unga yopiq', async () => {
    const res = await sell(await product(), { credit: credit() }, sellerToken).expect(201);
    expect(res.body.credit.amount).toBe('18000.00');
    await api('get', '/credits', sellerToken).expect(403);
  });

  it('atomiklik: to‘liq to‘lansa, qarz 1 000 dan kam, sana o‘tgan → 400; sotuv ham, qoldiq ham o‘zgarmaydi', async () => {
    const p = await product();
    for (const [extra, field] of [
      [{ paidAmount: '30000' }, 'credit.paidAmount'],
      [{ paidAmount: '29500' }, 'credit.paidAmount'],
      [{ firstDueDate: '2026-10-01' }, 'credit.firstDueDate'],
    ] as const) {
      const res = await sell(p, { credit: credit(extra) }).expect(400);
      expect(res.body.error.details[0].field).toBe(field);
    }
    const after = await api('get', `/products/${p}`).expect(200);
    expect(after.body.stock).toBe('50.000');
    expect(await t.prisma.saleItem.count({ where: { productId: p } })).toBe(0);
  });

  it('takroriy so‘rov: bir kalit — bitta sotuv va bitta nasiya; boshqa to‘lov bilan → 409', async () => {
    const p = await product();
    const key = randomUUID();
    const first = await sell(p, { credit: credit() }, adminToken, key).expect(201);
    const replay = await sell(p, { credit: credit() }, adminToken, key).expect(200);
    expect(replay.body.id).toBe(first.body.id);
    expect(await t.prisma.credit.count({ where: { saleId: first.body.id } })).toBe(1);
    await sell(p, { credit: credit({ paidAmount: '1000' }) }, adminToken, key).expect(409);
  });

  it('nasiya to‘lovi kassa nasiyasida ham ishlaydi', async () => {
    const res = await sell(await product(), { credit: credit() }).expect(201);
    const list = await api('get', `/credits?search=${res.body.credit.number}`).expect(200);
    const paid = await api('post', `/credits/${list.body.data[0].id}/payments`)
      .send({ amount: '18000', date: '2026-10-09' })
      .expect(201);
    expect(paid.body.status).toBe('PAID');
  });
});
