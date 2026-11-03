import { randomUUID } from 'node:crypto';
import { AuditAction } from '@divine/shared';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { InventoryRepository } from '../../src/modules/inventory/inventory.repository.js';
import {
  type AuthTestApp,
  createAuthApp,
  createUser,
  login,
  uniqueIp,
  uniqueLogin,
} from './support/auth-app.js';
import { closePool, withCommit } from './support/db.js';
import { createGroup, createProduct, createWarehouse, receive } from './support/fixtures.js';

const PASSWORD = '582913';
const CARD_COST = '600.00';
const SALE_PRICE = '1000.00';

let t: AuthTestApp;
let adminId: string;
let adminToken: string;
let sellerId: string;
let sellerToken: string;
let otherSellerToken: string;
let warehouseA: string;
let warehouseB: string;
let groupId: string;

const bearer = (token: string) => ({ Authorization: `Bearer ${token}` });
function api(method: 'get' | 'post' | 'patch' | 'put' | 'delete', path: string, token?: string) {
  const req = request(t.app.getHttpServer())
    [method](`/api/v1${path}`)
    .set('X-Forwarded-For', uniqueIp());
  return token ? req.set(bearer(token)) : req;
}

async function signIn(loginName: string) {
  return (await login(t, { login: loginName, password: PASSWORD }).expect(200)).body
    .accessToken as string;
}

/** Kartochka: kelgan narxi 600, sotuv narxi 1000; omborga `stock` miqdorda (kirim narxi 450 — D-16). */
async function product(stock = '10', opts: { unit?: 'KG'; warehouseId?: string } = {}) {
  return withCommit(async (db) => {
    const id = await createProduct(db, {
      groupId,
      actor: adminId,
      costPrice: CARD_COST,
      salePrice: SALE_PRICE,
    });
    if (opts.unit) {
      await db.query(`UPDATE products SET unit = 'KG', allow_decimal = true WHERE id = $1`, [id]);
    }
    if (stock !== '0') {
      await receive(db, {
        warehouseId: opts.warehouseId ?? warehouseA,
        actor: adminId,
        lines: [{ productId: id, quantity: stock, price: '450.00' }],
      });
    }
    return id;
  });
}

function sell(
  body: Record<string, unknown>,
  token = sellerToken,
  key: string | null = randomUUID(),
) {
  const req = api('post', '/sales', token);
  return (key ? req.set('Idempotency-Key', key) : req).send(body);
}

const saleBody = (productId: string, quantity = '1', extra: Record<string, unknown> = {}) => ({
  warehouseId: warehouseA,
  customer: { name: `Mijoz ${uniqueLogin('c')}` },
  items: [{ productId, quantity }],
  ...extra,
});

async function stockOf(productId: string, warehouseId = warehouseA): Promise<string> {
  const row = await t.prisma.warehouseStock.findUnique({
    where: { warehouseId_productId: { warehouseId, productId } },
  });
  return row ? row.quantity.toFixed(3) : '0.000';
}

const salesCount = (productId: string) => t.prisma.saleItem.count({ where: { productId } });

beforeAll(async () => {
  t = await createAuthApp();
  const admin = await createUser(t, { password: PASSWORD, role: 'ADMIN' });
  adminId = admin.id;
  adminToken = await signIn(admin.login);
  [warehouseA, warehouseB, groupId] = await withCommit(async (db) => [
    await createWarehouse(db, adminId),
    await createWarehouse(db, adminId),
    await createGroup(db, adminId),
  ]);
  const seller = await createUser(t, { password: PASSWORD, warehouseIds: [warehouseA] });
  sellerId = seller.id;
  sellerToken = await signIn(seller.login);
  const other = await createUser(t, { password: PASSWORD, warehouseIds: [warehouseA] });
  otherSellerToken = await signIn(other.login);
});

afterAll(async () => {
  await t?.close();
  await closePool();
});

describe('sotuv yaratish (AC-11, BR-09, BR-15, D-16)', () => {
  it('to‘g‘ri sotuv: qoldiq ↓, ledger, snapshot, server totallari, mijoz va yig‘malari, audit', async () => {
    const p = await product('10');
    const card = await t.prisma.product.findUniqueOrThrow({ where: { id: p } });
    const res = await sell({
      warehouseId: warehouseA,
      customer: { name: '  Aziz Karimov ', phone: '93 111 22 33' },
      items: [{ productId: p, quantity: '3' }],
    }).expect(201);
    expect(res.body).toMatchObject({
      number: expect.stringMatching(/^S-\d{6,}$/),
      status: 'COMPLETED',
      user: { id: sellerId },
      warehouse: { id: warehouseA },
      customer: { name: 'Aziz Karimov', phone: '+998931112233' },
      itemsCount: 1,
      totalQuantity: '3.000',
      totalAmount: '3000.00',
      items: [
        {
          productId: p,
          productName: card.name,
          barcode: card.barcode,
          quantity: '3.000',
          unitPrice: SALE_PRICE,
          lineTotal: '3000.00',
        },
      ],
    });
    // Sotuvchi javobida tannarx/foyda yo'q (OWN-06).
    expect(res.text).not.toMatch(/totalCost|grossProfit|unitCost|lineProfit|600\.00|450\.00/);

    expect(await stockOf(p)).toBe('7.000');
    const [move] = await t.prisma.inventoryMovement.findMany({
      where: { referenceId: res.body.id },
    });
    expect(move).toMatchObject({ movementType: 'SALE', createdById: sellerId });
    expect(move!.quantity.toFixed(3)).toBe('-3.000');
    expect(move!.balanceAfter.toFixed(3)).toBe('7.000');
    // D-16: tannarx — kartochkadagi 600 (kirim narxi 450 emas).
    expect(move!.unitCost?.toFixed(2)).toBe(CARD_COST);
    const item = await t.prisma.saleItem.findFirstOrThrow({ where: { saleId: res.body.id } });
    expect(item.unitCost.toFixed(2)).toBe(CARD_COST);

    const customer = await t.prisma.customer.findUniqueOrThrow({
      where: { id: res.body.customer.id },
    });
    expect(customer).toMatchObject({
      name: 'Aziz Karimov',
      phone: '+998931112233',
      purchaseCount: 1,
    });
    expect(customer.totalSpent.toFixed(2)).toBe('3000.00');
    expect(customer.lastPurchaseAt).not.toBeNull();

    const audit = await t.prisma.auditLog.findMany({
      where: { entityId: { in: [res.body.id, customer.id] } },
      orderBy: { id: 'asc' },
    });
    expect(audit.map((a) => a.action)).toEqual([
      AuditAction.CUSTOMER_CREATED,
      AuditAction.SALE_CREATED,
    ]);
    expect(audit[0]!.metadata).toEqual({ hasPhone: true, hasNotes: false, source: 'sale' });
    expect(audit[1]!.metadata).toMatchObject({
      saleNumber: res.body.number,
      warehouseId: warehouseA,
      itemsCount: 1,
      totalAmount: '3000.00',
    });
    expect(JSON.stringify(audit.map((a) => a.metadata))).not.toMatch(/Aziz|931112233/);

    // ADMIN detalida tannarx va foyda bor: 3 × (1000 − 600) = 1200.
    const detail = await api('get', `/sales/${res.body.id}`, adminToken).expect(200);
    expect(detail.body).toMatchObject({
      totalCost: '1800.00',
      grossProfit: '1200.00',
      items: [{ unitCost: CARD_COST, lineProfit: '1200.00' }],
    });
  });

  it('mavjud mijoz (`id`): snapshot mijozdan, yig‘malar oshadi; mijoz keyin tahrirlansa sotuv o‘zgarmaydi', async () => {
    const p = await product('5');
    const c = (
      await api('post', '/customers', adminToken).send({ name: uniqueLogin('Doimiy'), phone: '' })
    ).body;
    const first = await sell(saleBody(p, '1', { customer: { id: c.id } })).expect(201);
    await sell(saleBody(p, '2', { customer: { id: c.id } })).expect(201);
    expect(first.body.customer).toEqual({ id: c.id, name: c.name, phone: null });
    const stored = await t.prisma.customer.findUniqueOrThrow({ where: { id: c.id } });
    expect(stored.purchaseCount).toBe(2);
    expect(stored.totalSpent.toFixed(2)).toBe('3000.00');

    await api('patch', `/customers/${c.id}`, adminToken).send({ name: 'Yangi ism' }).expect(200);
    const again = await api('get', `/sales/${first.body.id}`, adminToken).expect(200);
    expect(again.body.customer.name).toBe(c.name);
    const missing = await sell(
      saleBody(p, '1', { customer: { id: '01990000-0000-7000-8000-000000000000' } }),
    ).expect(404);
    expect(missing.body.error.details).toEqual([expect.objectContaining({ field: 'customer.id' })]);
  });

  it('ismsiz sotuv (2026-11-03): telefonsiz — bitta umumiy mijoz; telefon bilan — shu raqamli mijoz yoki yangisi', async () => {
    const p = await product('5');
    const a = await sell(saleBody(p, '1', { customer: {} })).expect(201);
    const b = await sell(saleBody(p, '1', { customer: { name: '  ', phone: '' } })).expect(201);
    expect(a.body.customer).toMatchObject({ name: WALK_IN_CUSTOMER_NAME, phone: null });
    expect(b.body.customer.id).toBe(a.body.customer.id);
    const walkIn = await t.prisma.customer.findUniqueOrThrow({ where: { id: a.body.customer.id } });
    expect(walkIn.purchaseCount).toBe(2);

    const digits = () => String(Math.floor(1_000_000 + Math.random() * 8_999_999));
    const phone = `+99893${digits()}`;
    const known = (
      await api('post', '/customers', adminToken).send({ name: uniqueLogin('Tel'), phone })
    ).body;
    const c = await sell(saleBody(p, '1', { customer: { phone } })).expect(201);
    expect(c.body.customer).toEqual({ id: known.id, name: known.name, phone });

    const freshPhone = `+99894${digits()}`;
    const d = await sell(saleBody(p, '1', { customer: { phone: freshPhone } })).expect(201);
    expect(d.body.customer).toMatchObject({ name: WALK_IN_CUSTOMER_NAME, phone: freshPhone });
    expect(d.body.customer.id).not.toBe(a.body.customer.id);
  });

  it('D-18(1): ism va telefon mavjud mijoznikiga teng bo‘lsa ham — har doim yangi mijoz; mavjudining yig‘malari o‘zgarmaydi', async () => {
    const p = await product('5');
    const name = uniqueLogin('Bir xil');
    const existing = (
      await api('post', '/customers', adminToken).send({ name, phone: '+998935550101' })
    ).body;
    const a = await sell(saleBody(p, '1', { customer: { name, phone: '93 555 01 01' } })).expect(
      201,
    );
    const b = await sell(saleBody(p, '1', { customer: { name, phone: '+998935550101' } })).expect(
      201,
    );
    const ids = [existing.id, a.body.customer.id, b.body.customer.id];
    expect(new Set(ids).size).toBe(3);
    const rows = await t.prisma.customer.findMany({ where: { id: { in: ids } } });
    expect(rows.every((c) => c.name === name && c.phone === '+998935550101')).toBe(true);
    const old = rows.find((c) => c.id === existing.id)!;
    expect(old.purchaseCount).toBe(0);
    expect(old.totalSpent.toFixed(2)).toBe('0.00');
    expect(old.lastPurchaseAt).toBeNull();
  });

  it('AC-15/16: ismsiz mijoz → 400 (`customer.name`); telefonsiz → 201', async () => {
    const p = await product('3');
    for (const customer of [{}, { name: '  ' }, { phone: '+998901234567' }]) {
      const res = await sell(saleBody(p, '1', { customer })).expect(400);
      expect(res.body.error.details).toEqual(
        expect.arrayContaining([expect.objectContaining({ field: 'customer.name' })]),
      );
    }
    const ok = await sell(saleBody(p, '1', { customer: { name: 'Telefonsiz' } })).expect(201);
    expect(ok.body.customer.phone).toBeNull();
    expect(await salesCount(p)).toBe(1);
  });

  it('takroriy qatorlar birlashtiriladi (BR-19); kg kasr miqdor; client narxi va totali → 400', async () => {
    const p = await product('10');
    const kg = await product('5', { unit: 'KG' });
    const res = await sell({
      warehouseId: warehouseA,
      customer: { name: 'Birlashtirish' },
      items: [
        { productId: p, quantity: '1' },
        { productId: kg, quantity: '1.250' },
        { productId: p, quantity: '2' },
      ],
    }).expect(201);
    expect(res.body.itemsCount).toBe(2);
    expect(res.body.totalQuantity).toBe('4.250');
    expect(res.body.totalAmount).toBe('4250.00');
    expect(await stockOf(p)).toBe('7.000');
    for (const extra of [
      { items: [{ productId: p, quantity: '1', unitPrice: '1' }] },
      { totalAmount: '1' },
    ]) {
      const bad = await sell(saleBody(p, '1', extra)).expect(400);
      expect(bad.body.error.code).toBe('VALIDATION_ERROR');
    }
    expect(await stockOf(p)).toBe('7.000');
  });

  it('validatsiya: kasr dona → 422, nofaol mahsulot → 422, noma’lum mahsulot → 404, bo‘sh → 400, nofaol ombor → 422', async () => {
    const p = await product('5');
    const frac = await sell(saleBody(p, '1.5')).expect(422);
    expect(frac.body.error).toMatchObject({
      code: 'INVALID_QUANTITY',
      details: [{ field: 'items[0].quantity' }],
    });
    const inactive = await product('5');
    await t.prisma.product.update({ where: { id: inactive }, data: { status: 'INACTIVE' } });
    expect((await sell(saleBody(inactive)).expect(422)).body.error.code).toBe('PRODUCT_INACTIVE');
    const unknown = await sell(saleBody('01990000-0000-7000-8000-000000000000')).expect(404);
    expect(unknown.body.error.details).toEqual([
      expect.objectContaining({ field: 'items[0].productId' }),
    ]);
    await sell(saleBody(p, '1', { items: [] })).expect(400);

    const w = await withCommit((db) => createWarehouse(db, adminId));
    const pw = await product('5', { warehouseId: w });
    await api('patch', `/warehouses/${w}/status`, adminToken)
      .send({ status: 'INACTIVE' })
      .expect(200);
    const off = await sell(saleBody(pw, '1', { warehouseId: w }), adminToken).expect(422);
    expect(off.body.error.code).toBe('WAREHOUSE_INACTIVE');
    expect(await stockOf(pw, w)).toBe('5.000');
  });
});

describe('qoldiq va parallel sotuvlar (AC-12, AC-13, REQ-077)', () => {
  it('AC-12: qoldiqdan ko‘p → 409, barcha yetmayotgan qatorlar xabarda; hech narsa o‘zgarmaydi', async () => {
    const p1 = await product('3');
    const p2 = await product('1');
    const name = (await t.prisma.product.findUniqueOrThrow({ where: { id: p1 } })).name;
    const customerName = uniqueLogin('Yetmadi');
    const res = await sell({
      warehouseId: warehouseA,
      customer: { name: customerName },
      items: [
        { productId: p1, quantity: '5' },
        { productId: p2, quantity: '2' },
      ],
    }).expect(409);
    expect(res.body.error.code).toBe('INSUFFICIENT_STOCK');
    expect(res.body.error.details).toEqual([
      { field: 'items[0].quantity', message: `«${name}» uchun omborda faqat 3 dona bor` },
      expect.objectContaining({ field: 'items[1].quantity' }),
    ]);
    expect(await stockOf(p1)).toBe('3.000');
    expect(await stockOf(p2)).toBe('1.000');
    expect(await salesCount(p1)).toBe(0);
    expect(await t.prisma.customer.count({ where: { name: customerName } })).toBe(0);
  });

  it('AC-13: qoldiq 10, 20 ta parallel sotuv → aniq 10 tasi o‘tadi, qoldiq 0, ledger va reconciliation toza', async () => {
    const p = await product('10');
    const results = await Promise.all(Array.from({ length: 20 }, () => sell(saleBody(p, '1'))));
    const statuses = results.map((r) => r.status);
    expect(statuses.filter((s) => s === 201)).toHaveLength(10);
    expect(statuses.filter((s) => s === 409)).toHaveLength(10);
    expect(await stockOf(p)).toBe('0.000');
    expect(await salesCount(p)).toBe(10);
    expect(
      await t.prisma.inventoryMovement.count({ where: { productId: p, movementType: 'SALE' } }),
    ).toBe(10);
    const drift = await t.prisma.$queryRaw<unknown[]>`
      SELECT * FROM reconcile_inventory_stock WHERE product_id = ${p}::uuid`;
    expect(drift).toEqual([]);
  });

  it('atomiklik: ledger yozish o‘rtasida xato → sotuv, qatorlar, qoldiq, yangi mijoz va audit yo‘q', async () => {
    const p1 = await product('5');
    const p2 = await product('5');
    const customerName = uniqueLogin('Atom');
    const repo = t.app.get(InventoryRepository, { strict: false });
    const original = repo.insertMovement.bind(repo);
    let calls = 0;
    const spy = vi.spyOn(repo, 'insertMovement').mockImplementation(async (...args) => {
      calls += 1;
      if (calls === 2) throw new Error('sun’iy nosozlik');
      return original(...args);
    });
    try {
      const res = await sell({
        warehouseId: warehouseA,
        customer: { name: customerName },
        items: [
          { productId: p1, quantity: '1' },
          { productId: p2, quantity: '1' },
        ],
      });
      expect(res.status).toBe(500);
      expect(res.text).not.toContain('sun’iy');
    } finally {
      spy.mockRestore();
    }
    expect(calls).toBe(2);
    expect(await stockOf(p1)).toBe('5.000');
    expect(await stockOf(p2)).toBe('5.000');
    expect(await salesCount(p1)).toBe(0);
    expect(await t.prisma.customer.count({ where: { name: customerName } })).toBe(0);
  });
});

describe('idempotentlik (AC-14, BR-23, REQ-145)', () => {
  it('bir xil kalit + bir xil payload → o‘sha sotuv (200), qoldiq bir marta; ekvivalent payload ham', async () => {
    const p = await product('10');
    const kg = await product('10', { unit: 'KG' });
    const key = randomUUID();
    const body = {
      warehouseId: warehouseA,
      customer: { name: 'Takror' },
      items: [
        { productId: p, quantity: '2' },
        { productId: kg, quantity: '1.5' },
      ],
    };
    const first = await sell(body, sellerToken, key).expect(201);
    const second = await sell(body, sellerToken, key).expect(200);
    expect(second.body.id).toBe(first.body.id);
    // Qatorlar tartibi va miqdor yozilishi farq qilsa ham — bir xil payload.
    const equivalent = {
      ...body,
      items: [
        { productId: kg, quantity: '1.500' },
        { productId: p, quantity: '1' },
        { productId: p, quantity: '1.000' },
      ],
    };
    expect((await sell(equivalent, sellerToken, key).expect(200)).body.id).toBe(first.body.id);
    expect(await stockOf(p)).toBe('8.000');
    expect(await salesCount(p)).toBe(1);
    expect(await t.prisma.customer.count({ where: { name: 'Takror' } })).toBeGreaterThanOrEqual(1);
  });

  it('kalit boshqa payload yoki boshqa user bilan → 409 IDEMPOTENCY_KEY_REUSED; kalitsiz → 400', async () => {
    const p = await product('10');
    const key = randomUUID();
    await sell(saleBody(p, '1', { customer: { name: 'Bir' } }), sellerToken, key).expect(201);
    const other = await sell(
      saleBody(p, '2', { customer: { name: 'Bir' } }),
      sellerToken,
      key,
    ).expect(409);
    expect(other.body.error.code).toBe('IDEMPOTENCY_KEY_REUSED');
    const otherUser = await sell(
      saleBody(p, '1', { customer: { name: 'Bir' } }),
      otherSellerToken,
      key,
    ).expect(409);
    expect(otherUser.body.error.code).toBe('IDEMPOTENCY_KEY_REUSED');
    const noKey = await sell(saleBody(p), sellerToken, null).expect(400);
    expect(noKey.body.error.code).toBe('IDEMPOTENCY_KEY_REQUIRED');
    const badKey = await sell(saleBody(p), sellerToken, 'abc').expect(400);
    expect(badKey.body.error.details).toEqual([
      expect.objectContaining({ field: 'Idempotency-Key' }),
    ]);
    expect(await stockOf(p)).toBe('9.000');
  });

  it('bir xil kalit bilan 5 ta parallel so‘rov → bitta sotuv; qolganlari o‘sha sotuvni qaytaradi', async () => {
    const p = await product('10');
    const key = randomUUID();
    const body = saleBody(p, '1', { customer: { name: 'Parallel' } });
    const results = await Promise.all(
      Array.from({ length: 5 }, () => sell(body, sellerToken, key)),
    );
    expect(results.map((r) => r.status).sort()).toEqual([200, 200, 200, 200, 201]);
    expect(new Set(results.map((r) => r.body.id)).size).toBe(1);
    expect(await stockOf(p)).toBe('9.000');
    expect(await salesCount(p)).toBe(1);
  });
});

describe('ruxsatlar va ko‘rish (OWN-02, OWN-04, OWN-05, AC-19)', () => {
  it('anonim → 401; biriktirilmagan ombor → 403, hech narsa o‘zgarmaydi', async () => {
    const p = await product('5', { warehouseId: warehouseB });
    await api('post', '/sales').set('Idempotency-Key', randomUUID()).send(saleBody(p)).expect(401);
    await api('get', '/sales').expect(401);
    const res = await sell(saleBody(p, '1', { warehouseId: warehouseB })).expect(403);
    expect(res.body.error.code).toBe('WAREHOUSE_ACCESS_DENIED');
    expect(await stockOf(p, warehouseB)).toBe('5.000');
    // ADMIN — istalgan faol ombordan.
    await sell(saleBody(p, '1', { warehouseId: warehouseB }), adminToken).expect(201);
  });

  it('D-18(4), D-03: sotuvni tahrirlash, bekor qilish, qaytarish, o‘chirish yo‘q (ADMIN uchun ham) → 404; sotuv va qoldiq o‘zgarmaydi', async () => {
    const p = await product('5');
    const sale = (await sell(saleBody(p, '2'))).body;
    const attempts = [
      api('patch', `/sales/${sale.id}`, adminToken).send({ totalAmount: '0' }),
      api('put', `/sales/${sale.id}`, adminToken).send({ totalAmount: '0' }),
      api('delete', `/sales/${sale.id}`, adminToken),
      api('post', `/sales/${sale.id}/cancel`, adminToken),
      api('post', `/sales/${sale.id}/return`, adminToken),
      api('patch', `/sales/${sale.id}/status`, adminToken).send({ status: 'CANCELLED' }),
    ];
    for (const res of await Promise.all(attempts)) expect(res.status).toBe(404);
    const after = await api('get', `/sales/${sale.id}`, adminToken).expect(200);
    expect(after.body).toMatchObject({ status: 'COMPLETED', totalAmount: '2000.00' });
    expect(await stockOf(p)).toBe('3.000');
  });

  it('AC-19: sotuvchi faqat o‘z sotuvlarini ko‘radi; begona sotuv → 404; `userId` filtri chetlab o‘tolmaydi; ADMIN — hammasi', async () => {
    const p = await product('10');
    const mine = (await sell(saleBody(p, '1'))).body;
    const theirs = (await sell(saleBody(p, '1'), otherSellerToken)).body;
    await api('get', `/sales/${mine.id}`, sellerToken).expect(200);
    await api('get', `/sales/${theirs.id}`, sellerToken).expect(404);
    const list = await api('get', `/sales?productId=${p}&pageSize=100`, sellerToken).expect(200);
    expect(list.body.data.map((s: { id: string }) => s.id)).toEqual([mine.id]);
    const bypass = await api('get', `/sales?productId=${p}&userId=${theirs.user.id}`, sellerToken);
    expect(bypass.body.data.map((s: { id: string }) => s.id)).toEqual([mine.id]);
    expect(list.body.summary).toEqual({ count: 1, totalQuantity: '1.000', totalAmount: '1000.00' });
    expect(list.text).not.toMatch(/totalCost|grossProfit/);
    const all = await api('get', `/sales?productId=${p}`, adminToken).expect(200);
    expect(all.body.meta.total).toBe(2);
    expect(all.body.summary).toMatchObject({
      count: 2,
      totalAmount: '2000.00',
      totalCost: '1200.00',
      grossProfit: '800.00',
    });
    expect(all.body.data[0]).not.toHaveProperty('items');
  });

  it('filtrlar: raqam, mijoz ismi, ombor, user, sana; saralash', async () => {
    const p = await product('10');
    const tag = uniqueLogin('Filtr');
    const a = (await sell(saleBody(p, '1', { customer: { name: `${tag} Ali` } }))).body;
    const b = (await sell(saleBody(p, '3', { customer: { name: `${tag} Vali` } }), adminToken))
      .body;
    const byNumber = await api('get', `/sales?search=${a.number}`, adminToken);
    expect(byNumber.body.data.map((s: { id: string }) => s.id)).toEqual([a.id]);
    const byName = await api('get', `/sales?search=${tag} vali`, adminToken);
    expect(byName.body.data.map((s: { id: string }) => s.id)).toEqual([b.id]);
    const byUser = await api('get', `/sales?productId=${p}&userId=${sellerId}`, adminToken);
    expect(byUser.body.data.map((s: { id: string }) => s.id)).toEqual([a.id]);
    const sorted = await api('get', `/sales?productId=${p}&sort=totalAmount:desc`, adminToken);
    expect(sorted.body.data.map((s: { id: string }) => s.id)).toEqual([b.id, a.id]);
    const past = await api('get', `/sales?productId=${p}&dateTo=2000-01-01`, adminToken);
    expect(past.body.meta.total).toBe(0);
    const other = await api('get', `/sales?productId=${p}&warehouseId=${warehouseB}`, adminToken);
    expect(other.body.meta.total).toBe(0);
    await api('get', '/sales?sort=customer:asc', adminToken).expect(400);
  });

  it('reconciliation sotuvlardan keyin toza: qoldiq, hujjatlar va mijoz yig‘malari', async () => {
    const rec = await api('get', '/inventory/reconciliation', adminToken).expect(200);
    const ours = await t.prisma.$queryRaw<unknown[]>`
      SELECT * FROM reconcile_customer_aggregates r
        JOIN sales s ON s.customer_id = r.customer_id
       WHERE s.warehouse_id IN (${warehouseA}::uuid, ${warehouseB}::uuid)`;
    expect(ours).toEqual([]);
    const docs = await t.prisma.$queryRaw<unknown[]>`
      SELECT * FROM reconcile_document_movements WHERE warehouse_id IN (${warehouseA}::uuid, ${warehouseB}::uuid)`;
    expect(docs).toEqual([]);
    expect(
      rec.body.mismatches.filter((m: { warehouseId: string }) =>
        [warehouseA, warehouseB].includes(m.warehouseId),
      ),
    ).toEqual([]);
  });
});
