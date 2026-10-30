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
import { createCustomer, createWarehouse, receive, sell } from './support/fixtures.js';

const PASSWORD = '582913';
const COST = '1834567.00';

let t: AuthTestApp;
let adminId: string;
let adminToken: string;
let sellerToken: string;
let warehouseA: string;
let warehouseB: string;
let groupId: string;

const bearer = (token: string) => ({ Authorization: `Bearer ${token}` });
function api(method: 'get' | 'post' | 'patch' | 'delete', path: string, token?: string) {
  const req = request(t.app.getHttpServer())
    [method](`/api/v1${path}`)
    .set('X-Forwarded-For', uniqueIp());
  return token ? req.set(bearer(token)) : req;
}

async function signIn(loginName: string) {
  return (await login(t, { login: loginName, password: PASSWORD }).expect(200)).body
    .accessToken as string;
}

let seq = 0;
const barcode = () => `478${Date.now().toString().slice(-8)}${(seq++).toString().padStart(2, '0')}`;

function productBody(overrides: Record<string, unknown> = {}) {
  return {
    name: `Mahsulot ${uniqueLogin('p')}`,
    groupId,
    barcode: barcode(),
    costPrice: COST,
    salePrice: '2150000',
    unit: 'DONA',
    allowDecimal: false,
    minStock: '5',
    status: 'ACTIVE',
    ...overrides,
  };
}

const createProduct = (overrides: Record<string, unknown> = {}) =>
  api('post', '/products', adminToken).send(productBody(overrides)).expect(201);

/** Javobda kelgan narxi hech qanday ko'rinishda yo'q (kalit ham, qiymat ham). */
function expectNoCost(body: unknown) {
  const text = JSON.stringify(body);
  expect(text).not.toMatch(/costPrice|cost_price|unitCost|totalCost/);
  expect(text).not.toContain('1834567');
}

beforeAll(async () => {
  t = await createAuthApp();
  const admin = await createUser(t, { password: PASSWORD, role: 'ADMIN' });
  adminId = admin.id;
  adminToken = await signIn(admin.login);
  [warehouseA, warehouseB] = await withCommit(async (db) => [
    await createWarehouse(db, adminId),
    await createWarehouse(db, adminId),
  ]);
  const seller = await createUser(t, { password: PASSWORD, warehouseIds: [warehouseA] });
  sellerToken = await signIn(seller.login);
  groupId = (
    await api('post', '/product-groups', adminToken)
      .send({ name: `Smartfonlar ${uniqueLogin('g')}` })
      .expect(201)
  ).body.id;
}, 240_000);

afterAll(async () => {
  await t?.close();
  await closePool();
});

describe('mahsulot guruhlari (API §5)', () => {
  it('yaratish, tahrirlash, takroriy nom (katta-kichik harf farqsiz) → 409, audit', async () => {
    const name = `Kanselyariya ${uniqueLogin('g')}`;
    const created = await api('post', '/product-groups', adminToken)
      .send({ name: `  ${name} `, description: 'Daftar, ruchka' })
      .expect(201);
    expect(created.body).toMatchObject({ name, isActive: true, productCount: 0 });

    const dup = await api('post', '/product-groups', adminToken)
      .send({ name: name.toUpperCase() })
      .expect(409);
    expect(dup.body.error).toMatchObject({ code: 'NAME_TAKEN', details: [{ field: 'name' }] });

    const edited = await api('patch', `/product-groups/${created.body.id}`, adminToken)
      .send({ name: `${name} 2`, description: '' })
      .expect(200);
    expect(edited.body).toMatchObject({ name: `${name} 2`, description: null });

    const audit = await t.prisma.auditLog.findMany({
      where: { entityId: created.body.id },
      orderBy: { id: 'asc' }, // tartibsiz SELECT'da qator tartibi kafolatlanmaydi (Phase 17 da beqarorlik topildi)
    });
    expect(audit.map((a) => a.action)).toEqual([
      AuditAction.PRODUCT_GROUP_CREATED,
      AuditAction.PRODUCT_GROUP_UPDATED,
    ]);
  });

  it('arxivlash: sotuvchi arxivdagi guruhni ko‘rmaydi; yangi mahsulot qo‘shilmaydi (422), mavjudlari saqlanadi', async () => {
    const g = await api('post', '/product-groups', adminToken)
      .send({ name: `Arxiv ${uniqueLogin('g')}` })
      .expect(201);
    const product = await createProduct({ groupId: g.body.id });
    await api('patch', `/product-groups/${g.body.id}`, adminToken)
      .send({ isActive: false })
      .expect(200);

    const sellerList = await api(
      'get',
      `/product-groups?search=${g.body.name}`,
      sellerToken,
    ).expect(200);
    expect(sellerList.body.meta.total).toBe(0);
    const adminList = await api('get', `/product-groups?search=${g.body.name}`, adminToken).expect(
      200,
    );
    expect(adminList.body.data[0]).toMatchObject({ isActive: false, productCount: 1 });

    const rejected = await api('post', '/products', adminToken)
      .send(productBody({ groupId: g.body.id }))
      .expect(422);
    expect(rejected.body.error.code).toBe('PRODUCT_GROUP_INACTIVE');
    // Mavjud mahsulot o'sha (arxivdagi) guruhda qolgan holda tahrirlanadi.
    await api('patch', `/products/${product.body.id}`, adminToken)
      .send({ name: `${product.body.name} yangi`, groupId: g.body.id })
      .expect(200);
  });

  it('mahsulotli guruhni o‘chirish → 409 ENTITY_IN_USE; bo‘sh guruh → 204', async () => {
    const g = await api('post', '/product-groups', adminToken)
      .send({ name: `Band ${uniqueLogin('g')}` })
      .expect(201);
    await createProduct({ groupId: g.body.id });
    const used = await api('delete', `/product-groups/${g.body.id}`, adminToken).expect(409);
    expect(used.body.error.code).toBe('ENTITY_IN_USE');
    await api('get', `/product-groups/${g.body.id}`, adminToken).expect(200);
    const empty = await api('post', '/product-groups', adminToken)
      .send({ name: `Bo‘sh ${uniqueLogin('g')}` })
      .expect(201);
    await api('delete', `/product-groups/${empty.body.id}`, adminToken).expect(204);
    await api('get', `/product-groups/${empty.body.id}`, adminToken).expect(404);
  });

  it('sotuvchi guruhlarni o‘qiydi (sotuv filtri), lekin boshqara olmaydi', async () => {
    await api('get', '/product-groups', sellerToken).expect(200);
    await api('post', '/product-groups', sellerToken).send({ name: 'X' }).expect(403);
    await api('patch', `/product-groups/${groupId}`, sellerToken).send({ name: 'X' }).expect(403);
    await api('delete', `/product-groups/${groupId}`, sellerToken).expect(403);
    await api('get', `/product-groups/${groupId}`, sellerToken).expect(403);
  });
});

describe('mahsulot yaratish va tahrirlash (API §6, BR-09…13)', () => {
  it('ADMIN yaratadi: 201, kelgan narxi admin javobida bor, audit', async () => {
    const res = await createProduct({ name: '  Redmi 13 128GB  ' });
    expect(res.body).toMatchObject({
      name: 'Redmi 13 128GB',
      groupId,
      costPrice: COST,
      salePrice: '2150000.00',
      unit: 'DONA',
      status: 'ACTIVE',
      stock: '0.000',
      received: '0.000',
      sold: '0.000',
      warehouses: [],
    });
    const audit = await t.prisma.auditLog.findFirstOrThrow({
      where: { entityId: res.body.id, action: AuditAction.PRODUCT_CREATED },
    });
    expect(audit.actorId).toBe(adminId);
    expect(audit.metadata).toMatchObject({ name: 'Redmi 13 128GB', groupId });
  });

  it('anonim → 401; sotuvchi yaratish/tahrirlash/holat → 403', async () => {
    await api('post', '/products').send(productBody()).expect(401);
    const p = await createProduct();
    await api('post', '/products', sellerToken).send(productBody()).expect(403);
    await api('patch', `/products/${p.body.id}`, sellerToken).send({ salePrice: '1' }).expect(403);
    await api('patch', `/products/${p.body.id}/status`, sellerToken)
      .send({ status: 'INACTIVE' })
      .expect(403);
  });

  it.each([
    ['DONA + kasr miqdor', { unit: 'DONA', allowDecimal: true }, 'allowDecimal'],
    ['manfiy narx', { salePrice: '-1' }, 'salePrice'],
    ['noto‘g‘ri birlik', { unit: 'QUTI' }, 'unit'],
    ['noto‘g‘ri guruh ID', { groupId: 'yoq' }, 'groupId'],
    ['probelli shtrix-kod', { barcode: '478 000' }, 'barcode'],
    ['bo‘sh nom', { name: '  ' }, 'name'],
    ['noma’lum maydon', { stock: '100' }, ''],
  ])('validatsiya: %s → 400', async (_label, overrides, field) => {
    const res = await api('post', '/products', adminToken).send(productBody(overrides)).expect(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
    if (field) {
      expect(res.body.error.details.map((d: { field: string }) => d.field)).toContain(field);
    }
  });

  it('mavjud bo‘lmagan guruh → 404 (maydon xatosi bilan)', async () => {
    const res = await api('post', '/products', adminToken)
      .send(productBody({ groupId: '01990000-0000-7000-8000-000000000000' }))
      .expect(404);
    expect(res.body.error.details).toEqual([{ field: 'groupId', message: 'Ma’lumot topilmadi' }]);
  });

  it('shtrix-kod ixtiyoriy (bir nechta mahsulot shtrix-kodsiz); takroriy → 409 BARCODE_TAKEN', async () => {
    const a = await createProduct({ barcode: '' });
    const b = await createProduct({ barcode: null });
    expect([a.body.barcode, b.body.barcode]).toEqual([null, null]);

    const code = barcode();
    await createProduct({ barcode: code });
    const dup = await api('post', '/products', adminToken)
      .send(productBody({ barcode: ` ${code} ` }))
      .expect(409);
    expect(dup.body.error).toMatchObject({
      code: 'BARCODE_TAKEN',
      details: [{ field: 'barcode' }],
    });
  });

  it('AC-06: bir xil shtrix-kod bilan 5 ta parallel so‘rov → aynan bittasi 201, qolganlari 409 BARCODE_TAKEN', async () => {
    const code = barcode();
    const results = await Promise.all(
      Array.from({ length: 5 }, () =>
        api('post', '/products', adminToken).send(productBody({ barcode: code })),
      ),
    );
    const statuses = results.map((r) => r.status).sort();
    expect(statuses).toEqual([201, 409, 409, 409, 409]);
    for (const r of results.filter((x) => x.status === 409)) {
      expect(r.body.error.code).toBe('BARCODE_TAKEN');
    }
    expect(await t.prisma.product.count({ where: { barcode: code } })).toBe(1);
  });

  it('arxivlangan mahsulotning shtrix-kodi qayta ishlatilmaydi (D-09)', async () => {
    const code = barcode();
    const archived = await createProduct({ barcode: code });
    await api('patch', `/products/${archived.body.id}/status`, adminToken)
      .send({ status: 'INACTIVE' })
      .expect(200);
    await api('post', '/products', adminToken)
      .send(productBody({ barcode: code }))
      .expect(409);
    const other = await createProduct();
    await api('patch', `/products/${other.body.id}`, adminToken)
      .send({ barcode: code })
      .expect(409);
  });

  it('tahrirlash: diff audit; xato bo‘lsa hech narsa saqlanmaydi; mavjud birlik bilan DONA/kasr tekshiruvi', async () => {
    const taken = barcode();
    await createProduct({ barcode: taken });
    const p = await createProduct({ unit: 'KG', allowDecimal: true });
    const edited = await api('patch', `/products/${p.body.id}`, adminToken)
      .send({ salePrice: '2200000.00', costPrice: COST, minStock: '' })
      .expect(200);
    expect(edited.body).toMatchObject({ salePrice: '2200000.00', minStock: null });
    const audit = await t.prisma.auditLog.findFirstOrThrow({
      where: { entityId: p.body.id, action: AuditAction.PRODUCT_UPDATED },
    });
    // costPrice bir xil qiymat ("1834567.00") — o'zgarish sifatida yozilmaydi.
    expect(Object.keys((audit.metadata as { changes: object }).changes).sort()).toEqual([
      'minStock',
      'salePrice',
    ]);

    await api('patch', `/products/${p.body.id}`, adminToken)
      .send({ name: 'Saqlanmasligi kerak', barcode: taken })
      .expect(409);
    await api('patch', `/products/${p.body.id}`, adminToken).send({ unit: 'DONA' }).expect(400);
    const row = await t.prisma.product.findUniqueOrThrow({ where: { id: p.body.id } });
    expect(row.name).toBe(p.body.name);
    expect(row.unit).toBe('KG');
  });
});

describe('qidiruv, filtr, saralash, pagination — serverda', () => {
  const prefix = `Qidiruv${Date.now().toString(36)}`;
  let otherGroup: string;
  let codes: string[] = [];

  beforeAll(async () => {
    otherGroup = (
      await api('post', '/product-groups', adminToken)
        .send({ name: `Boshqa ${uniqueLogin('g')}` })
        .expect(201)
    ).body.id;
    codes = [];
    for (let i = 0; i < 25; i++) {
      const code = barcode();
      codes.push(code);
      await createProduct({
        name: `${prefix} ${String(i).padStart(2, '0')}`,
        barcode: code,
        salePrice: String(1000 + i),
        groupId: i % 5 === 0 ? otherGroup : groupId,
        status: i === 24 ? 'INACTIVE' : 'ACTIVE',
      });
    }
  });

  it('birinchi sahifadan tashqarida ham topadi (3-sahifa), meta to‘g‘ri', async () => {
    const page3 = await api(
      'get',
      `/products?search=${prefix.toLowerCase()}&pageSize=10&page=3&sort=name:asc`,
      adminToken,
    ).expect(200);
    expect(page3.body.meta).toMatchObject({ page: 3, pageSize: 10, total: 25, totalPages: 3 });
    expect(page3.body.data.map((p: { name: string }) => p.name)).toEqual(
      [20, 21, 22, 23, 24].map((i) => `${prefix} ${i}`),
    );
  });

  it('shtrix-kod bo‘yicha aniq qidiruv; guruh va holat filtri; narx bo‘yicha saralash', async () => {
    const byCode = await api('get', `/products?search=${codes[7]}`, adminToken).expect(200);
    expect(byCode.body.data.map((p: { name: string }) => p.name)).toEqual([`${prefix} 07`]);

    const inGroup = await api(
      'get',
      `/products?search=${prefix}&groupId=${otherGroup}`,
      adminToken,
    );
    expect(inGroup.body.meta.total).toBe(5);

    const inactive = await api('get', `/products?search=${prefix}&status=INACTIVE`, adminToken);
    expect(inactive.body.data.map((p: { name: string }) => p.name)).toEqual([`${prefix} 24`]);

    const desc = await api(
      'get',
      `/products?search=${prefix}&sort=salePrice:desc&pageSize=3`,
      adminToken,
    );
    expect(desc.body.data.map((p: { salePrice: string }) => p.salePrice)).toEqual([
      '1024.00',
      '1023.00',
      '1022.00',
    ]);
    await api('get', '/products?sort=hash:asc', adminToken).expect(400);
  });

  it('sotuvchi: faqat faol mahsulotlar (status filtri e’tiborsiz), kelgan narxisiz', async () => {
    const res = await api('get', `/products?search=${prefix}&status=INACTIVE`, sellerToken).expect(
      200,
    );
    expect(res.body.meta.total).toBe(24);
    expect(res.body.data.every((p: { status: string }) => p.status === 'ACTIVE')).toBe(true);
    expectNoCost(res.body);
  });

  it('shtrix-kod lookup: to‘g‘ri mahsulot; arxivdagi → 404; noma’lum → 404', async () => {
    const found = await api('get', `/products/lookup?barcode=${codes[3]}`, adminToken).expect(200);
    expect(found.body.name).toBe(`${prefix} 03`);
    const archived = await api('get', `/products/lookup?barcode=${codes[24]}`, adminToken).expect(
      404,
    );
    expect(archived.body.error.message).toBe('Bu shtrix-kod bo‘yicha mahsulot topilmadi');
    await api('get', '/products/lookup?barcode=0000000000000', adminToken).expect(404);
    await api('get', '/products/lookup', adminToken).expect(400);
  });
});

describe('kelgan narxi sotuvchiga ko‘rinmaydi (OWN-06, AC-20)', () => {
  let product: { id: string; barcode: string };

  beforeAll(async () => {
    product = (await createProduct()).body;
  });

  it('ADMIN: ro‘yxat, detal, lookup va summary’da kelgan narxi bor', async () => {
    const list = await api('get', `/products?search=${product.barcode}`, adminToken);
    expect(list.body.data[0].costPrice).toBe(COST);
    const detail = await api('get', `/products/${product.id}`, adminToken).expect(200);
    expect(detail.body.costPrice).toBe(COST);
    const lookup = await api('get', `/products/lookup?barcode=${product.barcode}`, adminToken);
    expect(lookup.body.costPrice).toBe(COST);
    const summary = await api('get', `/products/${product.id}/summary`, adminToken).expect(200);
    expect(summary.body.product.costPrice).toBe(COST);
  });

  it('sotuvchi: ro‘yxat, detal, lookup (ombor bilan ham) — kalit ham, qiymat ham yo‘q', async () => {
    const list = await api('get', `/products?search=${product.barcode}`, sellerToken).expect(200);
    expect(list.body.data).toHaveLength(1);
    expect(list.body.data[0]).not.toHaveProperty('costPrice');
    expectNoCost(list.body);

    const detail = await api('get', `/products/${product.id}`, sellerToken).expect(200);
    expect(detail.body).not.toHaveProperty('costPrice');
    expectNoCost(detail.body);

    for (const query of [
      `barcode=${product.barcode}`,
      `barcode=${product.barcode}&warehouseId=${warehouseA}`,
    ]) {
      const lookup = await api('get', `/products/lookup?${query}`, sellerToken).expect(200);
      expectNoCost(lookup.body);
    }
  });

  it('sotuvchi API’ni to‘g‘ridan-to‘g‘ri chaqirsa ham: summary 403, kelgan narxi bo‘yicha saralash 400, yaratish/tahrirlash javobi yo‘q (403)', async () => {
    const summary = await api('get', `/products/${product.id}/summary`, sellerToken).expect(403);
    expectNoCost(summary.body);
    const sorted = await api('get', '/products?sort=costPrice:desc', sellerToken).expect(400);
    expectNoCost(sorted.body);
    const created = await api('post', '/products', sellerToken).send(productBody()).expect(403);
    expectNoCost(created.body);
    const patched = await api('patch', `/products/${product.id}`, sellerToken)
      .send({ costPrice: '1' })
      .expect(403);
    expectNoCost(patched.body);
  });

  it('sotuv ekranidagi tanlovlar (ombor filtri bilan qidiruv) kelgan narxini oshkor qilmaydi', async () => {
    const res = await api(
      'get',
      `/products?warehouseId=${warehouseA}&pageSize=100`,
      sellerToken,
    ).expect(200);
    expectNoCost(res.body);
  });
});

describe('ombor doirasi, tarixiy yaxlitlik va arxiv (OWN-03, D-02, D-08)', () => {
  it('qoldiq/kirim/sotilgan agregatlari; sotuvchi faqat o‘z omborini ko‘radi; begona ombor → 403', async () => {
    const p = (await createProduct({ minStock: '50' })).body;
    await withCommit(async (db) => {
      await receive(db, {
        warehouseId: warehouseA,
        actor: adminId,
        lines: [{ productId: p.id, quantity: '10', price: COST }],
      });
      await receive(db, {
        warehouseId: warehouseB,
        actor: adminId,
        lines: [{ productId: p.id, quantity: '7', price: COST }],
      });
    });
    const admin = await api('get', `/products/${p.id}`, adminToken).expect(200);
    expect(admin.body).toMatchObject({ stock: '17.000', received: '17.000', isLowStock: true });
    expect(admin.body.warehouses).toHaveLength(2);

    const seller = await api('get', `/products/${p.id}`, sellerToken).expect(200);
    expect(seller.body).toMatchObject({ stock: '10.000', received: '10.000' });
    expect(seller.body.warehouses.map((w: { warehouseId: string }) => w.warehouseId)).toEqual([
      warehouseA,
    ]);
    const denied = await api('get', `/products?warehouseId=${warehouseB}`, sellerToken).expect(403);
    expect(denied.body.error.code).toBe('WAREHOUSE_ACCESS_DENIED');

    const inA = await api(
      'get',
      `/products?warehouseId=${warehouseA}&search=${p.barcode}`,
      adminToken,
    );
    expect(inA.body.data[0].stock).toBe('10.000');
    const low = await api('get', `/products?stock=low&search=${p.barcode}`, adminToken);
    expect(low.body.meta.total).toBe(1);
  });

  it('tahrirlash va arxivlash sotuv/kirim snapshot’larini o‘zgartirmaydi; tarix saqlanadi', async () => {
    const original = (await createProduct({ name: 'Eski nom', salePrice: '100000' })).body;
    const { incomingId, saleId } = await withCommit(async (db) => {
      const customerId = await createCustomer(db, adminId);
      const { incomingId } = await receive(db, {
        warehouseId: warehouseA,
        actor: adminId,
        lines: [{ productId: original.id, quantity: '5', price: COST }],
      });
      const { saleId } = await sell(db, {
        warehouseId: warehouseA,
        userId: adminId,
        customerId,
        lines: [{ productId: original.id, quantity: '2' }],
      });
      return { incomingId, saleId };
    });

    await api('patch', `/products/${original.id}`, adminToken)
      .send({ name: 'Yangi nom', salePrice: '999999', costPrice: '1', barcode: barcode() })
      .expect(200);
    await api('patch', `/products/${original.id}/status`, adminToken)
      .send({ status: 'INACTIVE' })
      .expect(200);

    const saleItem = await t.prisma.saleItem.findFirstOrThrow({ where: { saleId } });
    expect(saleItem).toMatchObject({ productName: 'Eski nom', barcode: original.barcode });
    expect(saleItem.unitPrice.toFixed(2)).toBe('100000.00');
    expect(saleItem.unitCost.toFixed(2)).toBe(COST);
    const incomingItem = await t.prisma.incomingItem.findFirstOrThrow({ where: { incomingId } });
    expect(incomingItem).toMatchObject({ productName: 'Eski nom', barcode: original.barcode });
    expect(incomingItem.costPrice.toFixed(2)).toBe(COST);

    const archived = await api('get', `/products/${original.id}`, adminToken).expect(200);
    expect(archived.body).toMatchObject({
      status: 'INACTIVE',
      received: '5.000',
      sold: '2.000',
      stock: '3.000',
    });
    const summary = await api('get', `/products/${original.id}/summary`, adminToken).expect(200);
    expect(summary.body).toMatchObject({
      totalRevenue: '200000.00',
      grossProfit: expect.any(String),
    });
    expect(summary.body.recentSales).toEqual([
      expect.objectContaining({ saleId, quantity: '2.000', unitPrice: '100000.00' }),
    ]);
    await api('get', `/products/${original.id}`, sellerToken).expect(404);

    const statusAudit = await t.prisma.auditLog.findMany({
      where: { entityId: original.id, action: AuditAction.PRODUCT_STATUS_CHANGED },
    });
    expect(statusAudit.map((a) => a.metadata)).toEqual([
      expect.objectContaining({ from: 'ACTIVE', to: 'INACTIVE' }),
    ]);
  });
});
