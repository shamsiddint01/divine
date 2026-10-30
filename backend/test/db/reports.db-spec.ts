import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { tashkentToday } from '../../src/common/time/tashkent-time.js';
import {
  type AuthTestApp,
  createAuthApp,
  createUser,
  login,
  uniqueIp,
  uniqueLogin,
} from './support/auth-app.js';
import { closePool, withCommit } from './support/db.js';
import {
  createCustomer,
  createDraftIncoming,
  createGroup,
  createProduct,
  createWarehouse,
  receive,
  sell,
} from './support/fixtures.js';

const PASSWORD = '582913';

/*
 * Izolyatsiyalangan ma'lumot (alohida omborlar, guruh, userlar, mijozlar) — kutilgan qiymatlar qo'lda
 * hisoblangan. Butun kompaniya bo'yicha qiymatlar esa mustaqil SQL bilan solishtiriladi.
 *
 *   A (DONA): tannarx 600, narx 1000          B (KG): tannarx 150.50, narx 250.75, min_stock 20
 *   C: sotilmagan
 *   Kirim: W1 — A 10, B 30.5 (2026-09-09, 10 590.25); W2 — A 5 (2026-09-12, 3 000);
 *          W1 qoralama — C 3 × 100 (2026-09-10, tasdiqlanmagan)
 *   s1: seller1, W1, c1 — A×2         2026-09-10 23:30 Toshkent (18:30Z)   2000 / 1200
 *   s2: seller2, W1, c2 — A×1, B×1.5  2026-09-11 00:10 Toshkent (19:10Z kechasi) 1376.13 / 825.75
 *   s3: seller1, W2, c1 — A×1         2026-09-12 12:00 Toshkent             1000 / 600
 */
let t: AuthTestApp;
let adminToken: string;
let sellerToken: string;
let admin2: string;
let w1: string;
let w2: string;
let group: string;
let a: string;
let b: string;
let seller1: string;
let seller2: string;
let c1: string;
let tag: string;
let catX: string;

const bearer = (token: string) => ({ Authorization: `Bearer ${token}` });
function get(path: string, token: string | null = adminToken) {
  const req = request(t.app.getHttpServer())
    .get(`/api/v1${path}`)
    .set('X-Forwarded-For', uniqueIp());
  return token ? req.set(bearer(token)) : req;
}
const qs = (params: Record<string, string | number | undefined>) =>
  new URLSearchParams(
    Object.entries(params)
      .filter(([, v]) => v !== undefined)
      .map(([k, v]): [string, string] => [k, String(v)]),
  ).toString();
const report = (path: string, params: Record<string, string | number | undefined>) =>
  get(`/reports/${path}?${qs({ pageSize: 100, ...params })}`);
const summaryOf = (body: { summary: { labelKey: string; value: string }[] }) =>
  Object.fromEntries(body.summary.map((s) => [s.labelKey, s.value]));
const RANGE = { dateFrom: '2026-09-10', dateTo: '2026-09-12' };

async function signIn(loginName: string) {
  return (await login(t, { login: loginName, password: PASSWORD }).expect(200)).body
    .accessToken as string;
}

beforeAll(async () => {
  t = await createAuthApp();
  const admin = await createUser(t, { password: PASSWORD, role: 'ADMIN' });
  adminToken = await signIn(admin.login);
  admin2 = (await createUser(t, { password: PASSWORD, role: 'ADMIN' })).id;
  tag = uniqueLogin('Rep');
  ({ w1, w2, group, a, b } = await withCommit(async (db) => {
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
      costPrice: '150.50',
      salePrice: '250.75',
    });
    const c = await createProduct(db, {
      groupId: group,
      actor: admin.id,
      costPrice: '100.00',
      salePrice: '200.00',
    });
    await db.query(
      `UPDATE products SET unit = 'KG', allow_decimal = true, min_stock = 20 WHERE id = $1`,
      [b],
    );
    await receive(db, {
      warehouseId: w1,
      actor: admin.id,
      date: '2026-09-09',
      lines: [
        { productId: a, quantity: '10' },
        { productId: b, quantity: '30.5' },
      ],
    });
    await receive(db, {
      warehouseId: w2,
      actor: admin.id,
      date: '2026-09-12',
      lines: [{ productId: a, quantity: '5' }],
    });
    await createDraftIncoming(db, {
      warehouseId: w1,
      actor: admin.id,
      date: '2026-09-10',
      lines: [{ productId: c, quantity: '3', price: '100.00' }],
    });
    return { w1, w2, group, a, b };
  }));
  const s1 = await createUser(t, { password: PASSWORD, warehouseIds: [w1, w2] });
  seller1 = s1.id;
  seller2 = (await createUser(t, { password: PASSWORD, warehouseIds: [w1] })).id;
  sellerToken = await signIn(s1.login);
  await withCommit(async (db) => {
    c1 = await createCustomer(db, admin.id, `${tag} Ali`);
    const c2 = await createCustomer(db, admin.id, `${tag} Vali`);
    await sell(db, {
      warehouseId: w1,
      userId: seller1,
      customerId: c1,
      soldAt: new Date('2026-09-10T18:30:00Z'),
      lines: [{ productId: a, quantity: '2' }],
    });
    await sell(db, {
      warehouseId: w1,
      userId: seller2,
      customerId: c2,
      soldAt: new Date('2026-09-10T19:10:00Z'),
      lines: [
        { productId: a, quantity: '1' },
        { productId: b, quantity: '1.5' },
      ],
    });
    await sell(db, {
      warehouseId: w2,
      userId: seller1,
      customerId: c1,
      soldAt: new Date('2026-09-12T07:00:00Z'),
      lines: [{ productId: a, quantity: '1' }],
    });
    const cat = async (name: string) =>
      (
        await db.query<{ id: string }>(
          `INSERT INTO expense_categories (name, created_by) VALUES ($1, $2) RETURNING id`,
          [name, admin2],
        )
      ).rows[0]!.id;
    catX = await cat(`${tag} X`);
    const catY = await cat(`${tag} Y`);
    const expense = (date: string, amount: string, category: string, deleted = false) =>
      db.query(
        `INSERT INTO expenses (expense_date, amount, category_id, note, created_by, deleted_at, deleted_by)
         VALUES ($1, $2, $3, 'izoh', $4, $5, $6)`,
        [date, amount, category, admin2, deleted ? new Date() : null, deleted ? admin2 : null],
      );
    await expense('2026-09-10', '100.50', catX);
    await expense('2026-09-11', '200.00', catY);
    await expense('2026-09-11', '999.00', catY, true);
    await expense('2026-09-13', '50.00', catX);
  });
});

afterAll(async () => {
  await t?.close();
  await closePool();
});

describe('ruxsatlar va validatsiya (RBAC §5, D-21)', () => {
  const paths = [
    'sales',
    'products',
    'warehouse-stock',
    'incoming',
    'expenses',
    'user-sales',
    'product-sales',
    'customer-purchases',
    'finance-summary',
  ];

  it('anonim → 401; sotuvchi (reports.read yo‘q) → 403 — barcha 9 ta hisobot', async () => {
    for (const path of paths) {
      await get(`/reports/${path}?${qs(RANGE)}`, null).expect(401);
      await get(`/reports/${path}?${qs(RANGE)}`, sellerToken).expect(403);
    }
  });

  it('sana oralig‘i majburiy (ikkala chegara), ≤ 366 kun; ombor qoldig‘i — sanasiz', async () => {
    const missing = await get('/reports/sales').expect(400);
    expect(missing.body.error.details.map((d: { field: string }) => d.field).sort()).toEqual([
      'dateFrom',
      'dateTo',
    ]);
    await get('/reports/finance-summary?dateFrom=2026-09-10').expect(400);
    const long = await report('sales', { dateFrom: '2025-01-01', dateTo: '2026-01-02' }).expect(
      400,
    );
    expect(long.body.error.details[0]).toMatchObject({ field: 'dateTo' });
    await report('sales', { dateFrom: '2025-01-01', dateTo: '2026-01-01' }).expect(200); // aynan 366 kun
    await report('expenses', { dateFrom: '2026-09-12', dateTo: '2026-09-10' }).expect(400);
    await get('/reports/warehouse-stock').expect(200);
  });

  it('noma’lum saralash, filtr qiymati va holat → 400', async () => {
    await report('sales', { ...RANGE, sort: 'margin:desc' }).expect(400);
    await report('products', { ...RANGE, status: 'lowStock' }).expect(400);
    await report('warehouse-stock', { status: 'sold' }).expect(400);
    await report('sales', { ...RANGE, warehouseId: 'abc' }).expect(400);
  });
});

describe('sotuvlar hisoboti va Toshkent kun chegarasi (AC-24 qismi)', () => {
  it('23:30 va 00:10 (Toshkent) sotuvlari turli kunlarga tushadi', async () => {
    const day10 = await report('sales', {
      warehouseId: w1,
      dateFrom: '2026-09-10',
      dateTo: '2026-09-10',
    }).expect(200);
    expect(day10.body.data.map((r: { revenue: string }) => r.revenue)).toEqual(['2000.00']);
    const day11 = await report('sales', {
      warehouseId: w1,
      dateFrom: '2026-09-11',
      dateTo: '2026-09-11',
    }).expect(200);
    expect(day11.body.data.map((r: { revenue: string }) => r.revenue)).toEqual(['1376.13']);
  });

  it('qatorlar, yig‘ma va tannarx/foyda; saralash va pagination; yig‘ma butun filtr bo‘yicha', async () => {
    const res = await report('sales', { ...RANGE, warehouseId: w1, sort: 'revenue:asc' }).expect(
      200,
    );
    expect(res.body.columns.map((c: { key: string }) => c.key)).toEqual([
      'soldAt',
      'number',
      'customer',
      'seller',
      'warehouse',
      'quantity',
      'revenue',
      'cost',
      'profit',
    ]);
    expect(res.body.data).toEqual([
      expect.objectContaining({
        soldAt: '2026-09-10T19:10:00.000Z',
        quantity: '2.500',
        revenue: '1376.13',
        cost: '825.75',
        profit: '550.38',
      }),
      expect.objectContaining({
        soldAt: '2026-09-10T18:30:00.000Z',
        quantity: '2.000',
        revenue: '2000.00',
        cost: '1200.00',
        profit: '800.00',
      }),
    ]);
    expect(summaryOf(res.body)).toEqual({
      count: '2',
      revenue: '3376.13',
      cost: '2025.75',
      profit: '1350.38',
    });
    const page2 = await report('sales', {
      ...RANGE,
      warehouseId: w1,
      sort: 'revenue:asc',
      pageSize: 1,
      page: 2,
    }).expect(200);
    expect(page2.body.meta).toMatchObject({ total: 2, page: 2, pageSize: 1 });
    expect(page2.body.data.map((r: { revenue: string }) => r.revenue)).toEqual(['2000.00']);
    expect(summaryOf(page2.body).revenue).toBe('3376.13');
  });

  it('mahsulot, user va mijoz filtrlari birgalikda (AC-17)', async () => {
    const byProduct = await report('sales', { ...RANGE, productId: b }).expect(200);
    expect(byProduct.body.data.map((r: { revenue: string }) => r.revenue)).toEqual(['1376.13']);
    const combo = await report('sales', {
      ...RANGE,
      productId: a,
      userId: seller1,
      customerId: c1,
    }).expect(200);
    expect(summaryOf(combo.body)).toMatchObject({ count: '2', revenue: '3000.00' });
    const none = await report('sales', { ...RANGE, productId: b, userId: seller1 }).expect(200);
    expect(none.body).toMatchObject({ data: [], meta: { total: 0 } });
    expect(summaryOf(none.body)).toEqual({
      count: '0',
      revenue: '0.00',
      cost: '0.00',
      profit: '0.00',
    });
  });

  it('butun kompaniya bo‘yicha yig‘ma = mustaqil SQL', async () => {
    const range = { dateFrom: '2026-01-01', dateTo: '2026-12-31' };
    const res = await report('sales', range).expect(200);
    const [db] = await t.prisma.$queryRaw<{ n: bigint; revenue: string; cost: string }[]>`
      SELECT count(*) AS n, coalesce(sum(total_amount), 0)::numeric(20, 2)::text AS revenue,
             coalesce(sum(total_cost), 0)::numeric(20, 2)::text AS cost
        FROM sales WHERE sold_at >= '2025-12-31T19:00:00Z' AND sold_at < '2026-12-31T19:00:00Z'`;
    expect(summaryOf(res.body)).toMatchObject({
      count: String(db!.n),
      revenue: db!.revenue,
      cost: db!.cost,
    });
  });
});

describe('mahsulotlar hisoboti — sotilgan/sotilmagan (AC-17, A-17)', () => {
  it('guruh bo‘yicha: sotilgan miqdor, tushum, foyda; sotilmagan — 0', async () => {
    const res = await report('products', { ...RANGE, groupId: group, sort: 'revenue:desc' }).expect(
      200,
    );
    expect(res.body.data).toEqual([
      expect.objectContaining({
        sold: '4.000',
        revenue: '4000.00',
        profit: '1600.00',
        stock: '11.000',
      }),
      expect.objectContaining({
        sold: '1.500',
        revenue: '376.13',
        profit: '150.38',
        stock: '29.000',
      }),
      expect.objectContaining({ sold: '0.000', revenue: '0.00', profit: '0.00', stock: '0.000' }),
    ]);
    expect(summaryOf(res.body)).toEqual({
      count: '3',
      quantity: '5.500',
      revenue: '4376.13',
      profit: '1750.38',
    });
  });

  it('sana + mahsulot + user + sotilgan/sotilmagan kombinatsiyasi', async () => {
    const sold = await report('products', {
      ...RANGE,
      groupId: group,
      userId: seller1,
      status: 'sold',
    }).expect(200);
    expect(sold.body.data.map((r: { sold: string }) => r.sold)).toEqual(['3.000']);
    const unsold = await report('products', {
      ...RANGE,
      groupId: group,
      userId: seller1,
      status: 'unsold',
    }).expect(200);
    expect(unsold.body.meta.total).toBe(2);
    const exact = await report('products', {
      ...RANGE,
      productId: a,
      userId: seller1,
      status: 'sold',
      warehouseId: w1,
    }).expect(200);
    expect(exact.body.data).toEqual([
      expect.objectContaining({ sold: '2.000', revenue: '2000.00', stock: '7.000' }),
    ]);
    const empty = await report('products', {
      ...RANGE,
      productId: b,
      userId: seller1,
      status: 'sold',
    }).expect(200);
    expect(empty.body.data).toEqual([]);
    const outside = await report('products', {
      dateFrom: '2026-09-13',
      dateTo: '2026-09-14',
      groupId: group,
      status: 'sold',
    }).expect(200);
    expect(outside.body.data).toEqual([]);
  });

  it('“kelgan” — davrdagi kirim harakatlari (ledger), ombor filtri bilan', async () => {
    const today = tashkentToday(new Date());
    const res = await report('products', { dateFrom: today, dateTo: today, productId: a }).expect(
      200,
    );
    expect(res.body.data[0]).toMatchObject({ received: '15.000' });
    const onlyW1 = await report('products', {
      dateFrom: today,
      dateTo: today,
      productId: a,
      warehouseId: w1,
    }).expect(200);
    expect(onlyW1.body.data[0]).toMatchObject({ received: '10.000', stock: '7.000' });
  });
});

describe('ombor qoldig‘i hisoboti (joriy)', () => {
  it('qoldiq, tannarx va sotuv qiymati, holat (min_stock yoki global chegara); filtrlar', async () => {
    const [{ v }] = await t.prisma.$queryRaw<[{ v: string }]>`
      SELECT value #>> '{}' AS v FROM settings WHERE key = 'low_stock_default_threshold'`;
    const res = await report('warehouse-stock', { groupId: group, sort: 'stock:asc' }).expect(200);
    const lowA = Number(v) >= 4 ? 'lowStock' : 'inStock';
    expect(res.body.data).toEqual([
      expect.objectContaining({
        stock: '4.000',
        stockValue: '2400.00',
        saleValue: '4000.00',
        status: lowA,
      }),
      expect.objectContaining({ stock: '7.000', stockValue: '4200.00', saleValue: '7000.00' }),
      expect.objectContaining({
        stock: '29.000',
        stockValue: '4364.50',
        saleValue: '7271.75',
        status: 'inStock',
      }),
    ]);
    expect(summaryOf(res.body)).toEqual({ count: '3', quantity: '40.000', stockValue: '10964.50' });
    const w2Only = await report('warehouse-stock', { groupId: group, warehouseId: w2 }).expect(200);
    expect(w2Only.body.meta.total).toBe(1);
    const filtered = await report('warehouse-stock', { groupId: group, status: lowA }).expect(200);
    expect(filtered.body.data.map((r: { stock: string }) => r.stock)).toContain('4.000');
  });
});

describe('kirimlar hisoboti', () => {
  it('hujjat sanasi bo‘yicha; qoralama qatorda bor, yig‘mada faqat tasdiqlanganlar; holat filtri', async () => {
    const res = await report('incoming', {
      dateFrom: '2026-09-09',
      dateTo: '2026-09-12',
      warehouseId: w1,
      sort: 'date:asc',
    }).expect(200);
    expect(res.body.data).toEqual([
      expect.objectContaining({
        date: '2026-09-09',
        itemsCount: 2,
        quantity: '40.500',
        amount: '10590.25',
        status: 'CONFIRMED',
      }),
      expect.objectContaining({
        date: '2026-09-10',
        itemsCount: 1,
        quantity: '3.000',
        amount: '300.00',
        status: 'DRAFT',
      }),
    ]);
    expect(summaryOf(res.body)).toEqual({ count: '2', quantity: '40.500', amount: '10590.25' });
    const drafts = await report('incoming', {
      dateFrom: '2026-09-09',
      dateTo: '2026-09-12',
      warehouseId: w1,
      status: 'DRAFT',
    }).expect(200);
    expect(drafts.body.meta.total).toBe(1);
    const byProduct = await report('incoming', {
      dateFrom: '2026-09-01',
      dateTo: '2026-09-30',
      productId: a,
    }).expect(200);
    expect(byProduct.body.meta.total).toBe(2);
  });
});

describe('xarajatlar hisoboti (D-11, D-19)', () => {
  it('o‘chirilganlar yo‘q; kategoriya bo‘yicha yig‘ma; kategoriya va kiritgan user filtri', async () => {
    const res = await report('expenses', {
      dateFrom: '2026-09-10',
      dateTo: '2026-09-13',
      userId: admin2,
    }).expect(200);
    expect(res.body.meta.total).toBe(3);
    expect(summaryOf(res.body)).toEqual({ count: '3', expenses: '350.50' });
    expect(res.body.groups).toEqual([
      { label: `${tag} Y`, count: 1, amount: '200.00' },
      { label: `${tag} X`, count: 2, amount: '150.50' },
    ]);
    const onlyX = await report('expenses', {
      dateFrom: '2026-09-10',
      dateTo: '2026-09-11',
      userId: admin2,
      categoryId: catX,
    }).expect(200);
    expect(summaryOf(onlyX.body)).toEqual({ count: '1', expenses: '100.50' });
  });
});

describe('user, mahsulot va mijoz sotuvlari', () => {
  it('user sotuvlari: soni, miqdor, tushum, o‘rtacha chek (D-21), foyda', async () => {
    const res = await report('user-sales', {
      ...RANGE,
      warehouseId: w1,
      sort: 'revenue:desc',
    }).expect(200);
    expect(res.body.data).toEqual([
      expect.objectContaining({
        salesCount: 1,
        quantity: '2.000',
        revenue: '2000.00',
        averageCheck: '2000.00',
        profit: '800.00',
      }),
      expect.objectContaining({
        salesCount: 1,
        quantity: '2.500',
        revenue: '1376.13',
        averageCheck: '1376.13',
        profit: '550.38',
      }),
    ]);
    expect(summaryOf(res.body)).toEqual({ count: '2', revenue: '3376.13', profit: '1350.38' });
    const one = await report('user-sales', { ...RANGE, userId: seller1 }).expect(200);
    expect(one.body.data).toEqual([
      expect.objectContaining({ salesCount: 2, revenue: '3000.00', averageCheck: '1500.00' }),
    ]);
    const idle = await report('user-sales', {
      dateFrom: '2026-09-13',
      dateTo: '2026-09-13',
      userId: seller2,
    }).expect(200);
    expect(idle.body.data).toEqual([
      expect.objectContaining({ salesCount: 0, revenue: '0.00', averageCheck: '0.00' }),
    ]);
  });

  it('mahsulot sotuvlari: qator darajasida (miqdor, tushum, tannarx, foyda); ombor filtri', async () => {
    const res = await report('product-sales', {
      ...RANGE,
      groupId: group,
      sort: 'revenue:desc',
    }).expect(200);
    expect(res.body.data).toEqual([
      expect.objectContaining({
        quantity: '4.000',
        revenue: '4000.00',
        cost: '2400.00',
        profit: '1600.00',
      }),
      expect.objectContaining({
        quantity: '1.500',
        revenue: '376.13',
        cost: '225.75',
        profit: '150.38',
      }),
    ]);
    expect(summaryOf(res.body)).toEqual({ count: '2', revenue: '4376.13', profit: '1750.38' });
    const w2Only = await report('product-sales', {
      ...RANGE,
      groupId: group,
      warehouseId: w2,
    }).expect(200);
    expect(w2Only.body.data).toEqual([
      expect.objectContaining({ quantity: '1.000', revenue: '1000.00' }),
    ]);
  });

  it('mijoz xaridlari: soni, summa, o‘rtacha chek, oxirgi xarid; qidiruv va ombor filtri', async () => {
    const res = await report('customer-purchases', {
      ...RANGE,
      search: tag,
      sort: 'amount:desc',
    }).expect(200);
    expect(res.body.data).toEqual([
      expect.objectContaining({
        customer: `${tag} Ali`,
        purchases: 2,
        amount: '3000.00',
        averageCheck: '1500.00',
        lastPurchase: '2026-09-12T07:00:00.000Z',
      }),
      expect.objectContaining({ customer: `${tag} Vali`, purchases: 1, amount: '1376.13' }),
    ]);
    expect(summaryOf(res.body)).toEqual({ count: '2', amount: '4376.13' });
    const w1Only = await report('customer-purchases', {
      ...RANGE,
      search: tag,
      warehouseId: w1,
      customerId: c1,
    }).expect(200);
    expect(w1Only.body.data).toEqual([
      expect.objectContaining({ purchases: 1, amount: '2000.00' }),
    ]);
  });
});

describe('moliyaviy xulosa (REQ-103, BUSINESS-RULES §4, D-21)', () => {
  it('ombor bo‘yicha: tushum, tannarx, yalpi foyda, kirim, ombor qiymati; xarajat va sof foyda — null', async () => {
    const res = await get(
      `/reports/finance-summary?${qs({ dateFrom: '2026-09-09', dateTo: '2026-09-12', warehouseId: w1 })}`,
    ).expect(200);
    expect(res.body).toEqual({
      period: { dateFrom: '2026-09-09', dateTo: '2026-09-12' },
      warehouseId: w1,
      salesCount: 2,
      revenue: '3376.13',
      costOfGoodsSold: '2025.75',
      grossProfit: '1350.38',
      expenses: null,
      netProfit: null,
      incomingPurchases: '10590.25',
      inventoryValueAtCost: '8564.50',
    });
  });

  it('butun kompaniya: har bir tushuncha mustaqil SQL bilan teng; sof foyda = yalpi foyda − xarajat; kirim xarajat emas', async () => {
    const res = await get(
      `/reports/finance-summary?${qs({ dateFrom: '2026-09-01', dateTo: '2026-09-30' })}`,
    ).expect(200);
    const [db] = await t.prisma.$queryRaw<Record<string, string>[]>`
      SELECT
        (SELECT coalesce(sum(total_amount), 0) FROM sales WHERE sold_at >= '2026-08-31T19:00:00Z' AND sold_at < '2026-09-30T19:00:00Z')::numeric(20, 2)::text AS revenue,
        (SELECT coalesce(sum(total_cost), 0) FROM sales WHERE sold_at >= '2026-08-31T19:00:00Z' AND sold_at < '2026-09-30T19:00:00Z')::numeric(20, 2)::text AS cost,
        (SELECT coalesce(sum(amount), 0) FROM expenses WHERE deleted_at IS NULL AND expense_date BETWEEN '2026-09-01' AND '2026-09-30')::numeric(20, 2)::text AS expenses,
        (SELECT coalesce(sum(total_amount), 0) FROM incoming WHERE status = 'CONFIRMED' AND incoming_date BETWEEN '2026-09-01' AND '2026-09-30')::numeric(20, 2)::text AS incoming,
        (SELECT coalesce(sum(round(ws.quantity * p.cost_price, 2)), 0) FROM warehouse_stock ws JOIN products p ON p.id = ws.product_id)::numeric(20, 2)::text AS inventory`;
    expect(res.body).toMatchObject({
      warehouseId: null,
      revenue: db!.revenue,
      costOfGoodsSold: db!.cost,
      expenses: db!.expenses,
      incomingPurchases: db!.incoming,
      inventoryValueAtCost: db!.inventory,
    });
    const [check] = await t.prisma.$queryRaw<{ gross: string; net: string }[]>`
      SELECT (${res.body.revenue}::numeric - ${res.body.costOfGoodsSold}::numeric)::text AS gross,
             (${res.body.revenue}::numeric - ${res.body.costOfGoodsSold}::numeric - ${res.body.expenses}::numeric)::text AS net`;
    expect(res.body.grossProfit).toBe(check!.gross);
    expect(res.body.netProfit).toBe(check!.net);
    expect(Number(res.body.expenses)).toBeGreaterThanOrEqual(350.5);
  });
});
