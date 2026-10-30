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
import {
  createCustomer,
  createGroup,
  createProduct,
  createWarehouse,
  receive,
  sell,
} from './support/fixtures.js';

const PASSWORD = '582913';

/*
 * Soat: 2027-01-15T05:00Z = Toshkentda 2027-01-15 10:00 ("bugun" — 15-yanvar). Bu davrda boshqa test
 * fayllari sotuv yaratmaydi, shuning uchun bugun/kecha/grafik qiymatlari aniq kutiladi; jami va ombor
 * ko'rsatkichlari esa mustaqil SQL bilan solishtiriladi.
 *   kecha 23:59:59 (18:59:59Z) — seller1, A×1 = 1000
 *   bugun 00:00:00 (19:00:00Z kechasi) — seller1, A×2 = 2000
 *   bugun 09:00 — seller2, B×3 = 1500
 */
let t: AuthTestApp;
let adminToken: string;
let sellerToken: string;
let seller1: string;
let w1: string;
let w2: string;
let a: string;
let b: string;
let low: string;

const bearer = (token: string) => ({ Authorization: `Bearer ${token}` });
function get(path: string, token: string | null = adminToken) {
  const req = request(t.app.getHttpServer())
    .get(`/api/v1${path}`)
    .set('X-Forwarded-For', uniqueIp());
  return token ? req.set(bearer(token)) : req;
}

async function signIn(loginName: string) {
  return (await login(t, { login: loginName, password: PASSWORD }).expect(200)).body
    .accessToken as string;
}

beforeAll(async () => {
  t = await createAuthApp();
  t.clock.set(new Date('2027-01-15T05:00:00Z'));
  const admin = await createUser(t, { password: PASSWORD, role: 'ADMIN' });
  adminToken = await signIn(admin.login);
  ({ w1, w2, a, b, low } = await withCommit(async (db) => {
    const w1 = await createWarehouse(db, admin.id);
    const w2 = await createWarehouse(db, admin.id);
    const group = await createGroup(db, admin.id);
    const a = await createProduct(db, {
      groupId: group,
      actor: admin.id,
      costPrice: '600.00',
      salePrice: '1000.00',
    });
    const b = await createProduct(db, {
      groupId: group,
      actor: admin.id,
      costPrice: '300.00',
      salePrice: '500.00',
    });
    const low = await createProduct(db, { groupId: group, actor: admin.id });
    await db.query(`UPDATE products SET min_stock = 3 WHERE id = $1`, [low]);
    await receive(db, {
      warehouseId: w1,
      actor: admin.id,
      lines: [
        { productId: a, quantity: '20' },
        { productId: b, quantity: '10' },
        { productId: low, quantity: '2' },
      ],
    });
    await db.query(`UPDATE warehouses SET status = 'INACTIVE' WHERE id = $1`, [w2]);
    return { w1, w2, a, b, low };
  }));
  const s1 = await createUser(t, { password: PASSWORD, warehouseIds: [w1, w2] });
  seller1 = s1.id;
  sellerToken = await signIn(s1.login);
  const seller2 = (await createUser(t, { password: PASSWORD, warehouseIds: [w1] })).id;
  await withCommit(async (db) => {
    const customer = await createCustomer(db, admin.id);
    const at = (iso: string) => new Date(iso);
    await sell(db, {
      warehouseId: w1,
      userId: seller1,
      customerId: customer,
      soldAt: at('2027-01-14T18:59:59Z'),
      lines: [{ productId: a, quantity: '1' }],
    });
    await sell(db, {
      warehouseId: w1,
      userId: seller1,
      customerId: customer,
      soldAt: at('2027-01-14T19:00:00Z'),
      lines: [{ productId: a, quantity: '2' }],
    });
    await sell(db, {
      warehouseId: w1,
      userId: seller2,
      customerId: customer,
      soldAt: at('2027-01-15T04:00:00Z'),
      lines: [{ productId: b, quantity: '3' }],
    });
  });
});

afterAll(async () => {
  await t?.close();
  await closePool();
});

describe('ruxsatlar (RBAC §5, OWN-08)', () => {
  it('anonim → 401; sotuvchi admin ko‘rsatkichlariga → 403, o‘z ko‘rsatkichlariga → 200', async () => {
    for (const path of [
      '/dashboard/summary',
      '/dashboard/sales-trend',
      '/dashboard/top-products',
      '/dashboard/my-summary',
    ]) {
      await get(path, null).expect(401);
    }
    for (const path of [
      '/dashboard/summary',
      '/dashboard/sales-trend?days=7',
      '/dashboard/top-products',
    ]) {
      await get(path, sellerToken).expect(403);
    }
    await get('/dashboard/my-summary', sellerToken).expect(200);
  });
});

describe('admin dashboard = manba ma’lumotlari (REQ-030, REQ-031, AC-24)', () => {
  it('bugun/kecha — Toshkent kun chegarasi bo‘yicha (23:59:59 kechaga, 00:00 bugunga)', async () => {
    const res = await get('/dashboard/summary').expect(200);
    expect(res.body).toMatchObject({
      asOf: '2027-01-15T05:00:00.000Z',
      businessDate: '2027-01-15',
      today: { salesCount: 2, soldQuantity: '5.000', salesAmount: '3500.00' },
      yesterday: { salesAmount: '1000.00' },
      users: { soldToday: 2 },
    });
    expect(res.body).not.toHaveProperty('today.totalCost');
    expect(JSON.stringify(res.body)).not.toMatch(/cost|profit/i);
  });

  it('jami, ombor (birlik bo‘yicha), kam qoldiq va userlar — mustaqil SQL bilan teng', async () => {
    const res = await get('/dashboard/summary').expect(200);
    const [db] = await t.prisma.$queryRaw<Record<string, string | number>[]>`
      SELECT (SELECT count(*)::int FROM sales) AS "salesCount",
             (SELECT coalesce(sum(total_quantity), 0)::numeric(20, 3)::text FROM sales) AS "soldQuantity",
             (SELECT coalesce(sum(total_amount), 0)::numeric(20, 2)::text FROM sales) AS "salesAmount",
             (SELECT coalesce(sum(quantity), 0)::numeric(20, 3)::text FROM warehouse_stock) AS stock,
             (SELECT count(*)::int FROM (SELECT product_id FROM warehouse_stock GROUP BY product_id HAVING sum(quantity) > 0) x) AS products,
             (SELECT count(*)::int FROM users WHERE status = 'ACTIVE') AS active,
             (SELECT count(*)::int FROM users) AS total`;
    expect(res.body.allTime).toEqual({
      salesCount: db!.salesCount,
      soldQuantity: db!.soldQuantity,
      salesAmount: db!.salesAmount,
    });
    expect(res.body.warehouse).toMatchObject({
      totalQuantity: db!.stock,
      productCount: db!.products,
    });
    const byUnit = await t.prisma.$queryRaw<{ unit: string; quantity: string }[]>`
      SELECT p.unit::text AS unit, sum(ws.quantity)::numeric(20, 3)::text AS quantity
        FROM warehouse_stock ws JOIN products p ON p.id = ws.product_id GROUP BY p.unit ORDER BY p.unit`;
    expect(res.body.warehouse.byUnit).toEqual(byUnit);
    expect(res.body.users).toMatchObject({ active: db!.active, total: db!.total });

    const lowRows = await t.prisma.$queryRaw<{ id: string }[]>`
      WITH st AS (SELECT product_id, sum(quantity) AS q FROM warehouse_stock GROUP BY product_id)
      SELECT p.id FROM products p LEFT JOIN st ON st.product_id = p.id
       WHERE p.status = 'ACTIVE'
         AND coalesce(st.q, 0) <= coalesce(p.min_stock,
               (SELECT (value #>> '{}')::numeric FROM settings WHERE key = 'low_stock_default_threshold'))`;
    expect(res.body.lowStock.count).toBe(lowRows.length);
    expect(lowRows.map((r) => r.id)).toContain(low);
    expect(lowRows.map((r) => r.id)).not.toContain(a);
    expect(res.body.lowStock.items.length).toBe(Math.min(6, lowRows.length));
  });
});

describe('grafik va top mahsulotlar (API §18, D-21)', () => {
  it('7 kunlik grafik: bo‘sh kunlar 0, kecha va bugun aniq; faqat 7/14/30', async () => {
    const res = await get('/dashboard/sales-trend?days=7').expect(200);
    expect(res.body.map((p: { date: string }) => p.date)).toEqual([
      '2027-01-09',
      '2027-01-10',
      '2027-01-11',
      '2027-01-12',
      '2027-01-13',
      '2027-01-14',
      '2027-01-15',
    ]);
    expect(res.body.slice(-2)).toEqual([
      { date: '2027-01-14', amount: '1000.00', count: 1 },
      { date: '2027-01-15', amount: '3500.00', count: 2 },
    ]);
    expect(res.body.slice(0, 5).every((p: { count: number }) => p.count === 0)).toBe(true);
    expect((await get('/dashboard/sales-trend').expect(200)).body).toHaveLength(30);
    await get('/dashboard/sales-trend?days=10').expect(400);
  });

  it('top mahsulotlar summa bo‘yicha; limit', async () => {
    const res = await get('/dashboard/top-products?days=7&limit=2').expect(200);
    expect(res.body).toEqual([
      expect.objectContaining({ productId: a, quantity: '3.000', amount: '3000.00' }),
      expect.objectContaining({ productId: b, quantity: '3.000', amount: '1500.00' }),
    ]);
    await get('/dashboard/top-products?limit=0').expect(400);
  });
});

describe('sotuvchi dashboard’i (OWN-08)', () => {
  it('faqat o‘z bugungi sotuvlari va ruxsat etilgan FAOL omborlari', async () => {
    const res = await get('/dashboard/my-summary', sellerToken).expect(200);
    expect(res.body).toEqual({
      businessDate: '2027-01-15',
      today: { salesCount: 1, soldQuantity: '2.000', salesAmount: '2000.00' },
      warehouses: [{ id: w1, name: expect.any(String) }],
    });
  });
});
