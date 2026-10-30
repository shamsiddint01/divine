import { ALL_PERMISSIONS, AuditAction, type Permission } from '@divine/shared';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import type { AccessContext } from '../../src/common/auth/access-context.js';
import { InventoryRepository } from '../../src/modules/inventory/inventory.repository.js';
import { IncomingService } from '../../src/modules/incoming/incoming.service.js';
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
  createGroup,
  createProduct,
  createWarehouse,
  sell,
} from './support/fixtures.js';

const PASSWORD = '582913';
const COST = '1834567.00';
const meta = { ip: null, userAgent: null, requestId: null };

let t: AuthTestApp;
let adminId: string;
let adminToken: string;
let sellerToken: string;
let warehouseA: string;
let warehouseB: string;
let groupId: string;

const bearer = (token: string) => ({ Authorization: `Bearer ${token}` });
function api(method: 'get' | 'post' | 'patch', path: string, token?: string) {
  const req = request(t.app.getHttpServer())
    [method](`/api/v1${path}`)
    .set('X-Forwarded-For', uniqueIp());
  return token ? req.set(bearer(token)) : req;
}

async function signIn(loginName: string) {
  return (await login(t, { login: loginName, password: PASSWORD }).expect(200)).body
    .accessToken as string;
}

async function product(opts: { name?: string; unit?: 'DONA' | 'KG'; status?: 'INACTIVE' } = {}) {
  const id = await withCommit((db) =>
    createProduct(db, { groupId, actor: adminId, name: opts.name, costPrice: COST }),
  );
  if (opts.unit === 'KG') {
    await t.prisma.product.update({ where: { id }, data: { unit: 'KG', allowDecimal: true } });
  }
  if (opts.status) await t.prisma.product.update({ where: { id }, data: { status: opts.status } });
  return id;
}

const line = (productId: string, quantity: string, costPrice = '1000.00') => ({
  productId,
  quantity,
  costPrice,
});

async function draft(items: ReturnType<typeof line>[], warehouseId = warehouseA) {
  const res = await api('post', '/incoming', adminToken)
    .send({ date: '2026-10-06', warehouseId, notes: 'Yetkazib beruvchi: Test', items })
    .expect(201);
  return res.body as {
    id: string;
    number: string;
    status: string;
    totalQuantity: string;
    totalAmount: string;
    items: { id: string; productId: string; productName: string; barcode: string | null }[];
  };
}

const confirm = (id: string, token = adminToken) => api('post', `/incoming/${id}/confirm`, token);

async function stockOf(warehouseId: string, productId: string): Promise<string> {
  const row = await t.prisma.warehouseStock.findUnique({
    where: { warehouseId_productId: { warehouseId, productId } },
  });
  return row ? row.quantity.toFixed(3) : '0.000';
}

const movementsOf = (referenceId: string) =>
  t.prisma.inventoryMovement.findMany({ where: { referenceId }, orderBy: { id: 'asc' } });

/** Admin kontekstidan nusxa: berilgan ruxsatlarsiz va (ixtiyoriy) faqat berilgan omborlar bilan. */
function context(without: Permission[], warehouseIds?: string[]): AccessContext {
  return {
    userId: adminId,
    login: 'test',
    role: 'ADMIN',
    permissions: new Set(ALL_PERMISSIONS.filter((p) => !without.includes(p))),
    warehouseIds: new Set(warehouseIds ?? []),
    issuedAt: 0,
  };
}

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
  sellerToken = await signIn(seller.login);
});

afterAll(async () => {
  await t?.close();
  await closePool();
});

describe('ruxsatlar (RBAC §5)', () => {
  it('anonim → 401; sotuvchi (o‘z ombori bilan ham) ro‘yxat, detal, yaratish, tahrirlash, tasdiqlash, bekor qilish → 403', async () => {
    const p = await product();
    const doc = await draft([line(p, '1')]);
    await api('get', '/incoming').expect(401);
    const attempts = [
      api('get', '/incoming', sellerToken),
      api('get', `/incoming/${doc.id}`, sellerToken),
      api('post', '/incoming', sellerToken).send({
        date: '2026-10-06',
        warehouseId: warehouseA,
        items: [line(p, '5')],
      }),
      api('patch', `/incoming/${doc.id}`, sellerToken).send({ items: [line(p, '999')] }),
      confirm(doc.id, sellerToken),
      api('post', `/incoming/${doc.id}/cancel`, sellerToken),
    ];
    for (const res of await Promise.all(attempts)) {
      expect(res.status).toBe(403);
      expect(res.body.error.code).toBe('FORBIDDEN');
      expect(res.text).not.toMatch(/costPrice|totalAmount|1000\.00/);
    }
    expect(await stockOf(warehouseA, p)).toBe('0.000');
    const unchanged = await api('get', `/incoming/${doc.id}`, adminToken).expect(200);
    expect(unchanged.body).toMatchObject({ status: 'DRAFT', totalQuantity: '1.000' });
  });

  it('ombor doirasi: biriktirilmagan ombor ID bilan yaratish → 403; begona hujjat → 404; ro‘yxat doirada', async () => {
    const p = await product();
    const docB = await draft([line(p, '2')], warehouseB);
    const service = t.app.get(IncomingService);
    // `incoming.*` bor, lekin `warehouses.read_all` yo'q va faqat A omborga biriktirilgan user.
    const scoped = context(['warehouses.read_all'], [warehouseA]);
    await expect(
      service.create(
        scoped,
        { date: '2026-10-06', warehouseId: warehouseB, items: [line(p, '1')] },
        meta,
      ),
    ).rejects.toMatchObject({ code: 'WAREHOUSE_ACCESS_DENIED', status: 403 });
    await expect(service.get(scoped, docB.id)).rejects.toMatchObject({ code: 'NOT_FOUND' });
    await expect(service.confirm(scoped, docB.id, meta)).rejects.toMatchObject({
      code: 'NOT_FOUND',
    });
    await expect(
      service.list(scoped, {
        page: 1,
        pageSize: 20,
        sort: { field: 'date', direction: 'desc' },
        warehouseId: warehouseB,
      }),
    ).rejects.toMatchObject({ code: 'WAREHOUSE_ACCESS_DENIED' });
    const own = await service.list(scoped, {
      page: 1,
      pageSize: 100,
      sort: { field: 'date', direction: 'desc' },
    });
    expect(own.data.every((d) => d.warehouseId === warehouseA)).toBe(true);
    expect(await stockOf(warehouseB, p)).toBe('0.000');
  });
});

describe('qoralama: yaratish, validatsiya, server totallari (AC-07, AC-08, REQ-065)', () => {
  it('TZ misoli 50+30+100+20 → 200; summa serverda; snapshot; audit; qoldiq o‘zgarmaydi', async () => {
    const ids = [await product(), await product(), await product(), await product()];
    const doc = await draft([
      line(ids[0]!, '50', '1800000.00'),
      line(ids[1]!, '30', '95000.00'),
      line(ids[2]!, '100', '15000.00'),
      line(ids[3]!, '20', '60000.00'),
    ]);
    expect(doc).toMatchObject({
      status: 'DRAFT',
      totalQuantity: '200.000',
      // 90 000 000 + 2 850 000 + 1 500 000 + 1 200 000
      totalAmount: '95550000.00',
    });
    expect(doc.number).toMatch(/^K-\d{6,}$/);
    const products = await t.prisma.product.findMany({ where: { id: { in: ids } } });
    for (const item of doc.items) {
      const p = products.find((x) => x.id === item.productId)!;
      expect(item).toMatchObject({ productName: p.name, barcode: p.barcode });
    }
    for (const id of ids) expect(await stockOf(warehouseA, id)).toBe('0.000');
    expect(await movementsOf(doc.id)).toEqual([]);
    const audit = await t.prisma.auditLog.findMany({ where: { entityId: doc.id } });
    expect(audit.map((a) => a.action)).toEqual([AuditAction.INCOMING_CREATED]);
    expect(audit[0]!.metadata).toMatchObject({
      number: doc.number,
      itemsCount: 4,
      totalQuantity: '200.000',
    });
  });

  it('yaxlitlash bitta qoidada: 2.5 × 0.99 = 2.48 (qator), total = Σ qatorlar', async () => {
    const kg = await product({ unit: 'KG' });
    const dona = await product();
    const doc = await draft([line(kg, '2.5', '0.99'), line(dona, '3', '0.33')]);
    expect(doc.totalQuantity).toBe('5.500');
    // 2.475 → 2.48; 3 × 0.33 = 0.99
    expect(doc.totalAmount).toBe('3.47');
  });

  it('client totallari qabul qilinmaydi: `totalAmount`/`lineTotal` → 400, hech narsa yaratilmaydi', async () => {
    const p = await product();
    const before = await t.prisma.incoming.count();
    for (const body of [
      { date: '2026-10-06', warehouseId: warehouseA, items: [line(p, '1')], totalAmount: '1' },
      { date: '2026-10-06', warehouseId: warehouseA, items: [line(p, '1')], totalQuantity: '99' },
      {
        date: '2026-10-06',
        warehouseId: warehouseA,
        items: [{ ...line(p, '1'), lineTotal: '999999' }],
      },
    ]) {
      const res = await api('post', '/incoming', adminToken).send(body).expect(400);
      expect(res.body.error.code).toBe('VALIDATION_ERROR');
    }
    expect(await t.prisma.incoming.count()).toBe(before);
  });

  it.each([
    ['nol miqdor', { quantity: '0' }],
    ['manfiy miqdor', { quantity: '-3' }],
    ['manfiy narx', { costPrice: '-1' }],
    ['4 kasrli miqdor', { quantity: '1.2345' }],
    ['NaN narx', { costPrice: 'NaN' }],
    ['Infinity miqdor', { quantity: 'Infinity' }],
    ['juda katta narx', { costPrice: '99999999999999999' }],
    ['son turidagi miqdor', { quantity: 5 }],
  ])('qator validatsiyasi: %s → 400', async (_label, patch) => {
    const p = await product();
    const res = await api('post', '/incoming', adminToken)
      .send({ date: '2026-10-06', warehouseId: warehouseA, items: [{ ...line(p, '1'), ...patch }] })
      .expect(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
  });

  it('ombor, mahsulot va miqdor siyosati: 404 / 422 maydon bilan; takroriy mahsulot va bo‘sh qatorlar → 400', async () => {
    const p = await product();
    const inactive = await product({ status: 'INACTIVE' });
    const send = (body: Record<string, unknown>) =>
      api('post', '/incoming', adminToken).send({
        date: '2026-10-06',
        warehouseId: warehouseA,
        ...body,
      });

    const missingWarehouse = await send({
      warehouseId: '01990000-0000-7000-8000-000000000000',
      items: [line(p, '1')],
    }).expect(404);
    expect(missingWarehouse.body.error.code).toBe('NOT_FOUND');
    const missingProduct = await send({
      items: [line(p, '1'), line('01990000-0000-7000-8000-000000000000', '1')],
    }).expect(404);
    expect(missingProduct.body.error.details).toEqual([
      expect.objectContaining({ field: 'items[1].productId' }),
    ]);
    const inactiveRes = await send({ items: [line(inactive, '1')] }).expect(422);
    expect(inactiveRes.body.error).toMatchObject({
      code: 'PRODUCT_INACTIVE',
      details: [{ field: 'items[0].productId' }],
    });
    const fraction = await send({ items: [line(p, '1.5')] }).expect(422);
    expect(fraction.body.error).toMatchObject({
      code: 'INVALID_QUANTITY',
      details: [{ field: 'items[0].quantity' }],
    });
    const dup = await send({ items: [line(p, '1'), line(p, '2')] }).expect(400);
    expect(dup.body.error.details).toEqual([
      expect.objectContaining({ field: 'items[1].productId', message: 'Mahsulot takrorlangan' }),
    ]);
    await send({ items: [] }).expect(400);
    await send({ items: [line(p, '1')], date: '2026-02-30' }).expect(400);
  });

  it('tahrirlash: qatorlar to‘liq almashtiriladi, totallar qayta hisoblanadi, qoldiq o‘zgarmaydi, audit', async () => {
    const p1 = await product();
    const p2 = await product();
    const doc = await draft([line(p1, '10', '500.00')]);
    const res = await api('patch', `/incoming/${doc.id}`, adminToken)
      .send({ notes: '', items: [line(p1, '4', '500.00'), line(p2, '6', '250.50')] })
      .expect(200);
    expect(res.body).toMatchObject({
      status: 'DRAFT',
      notes: null,
      totalQuantity: '10.000',
      totalAmount: '3503.00',
      itemsCount: 2,
    });
    const header = await api('patch', `/incoming/${doc.id}`, adminToken)
      .send({ date: '2026-10-07', warehouseId: warehouseB })
      .expect(200);
    expect(header.body).toMatchObject({
      date: '2026-10-07',
      warehouseId: warehouseB,
      itemsCount: 2,
    });
    expect(await stockOf(warehouseA, p1)).toBe('0.000');
    expect(await stockOf(warehouseB, p1)).toBe('0.000');
    const updates = await t.prisma.auditLog.findMany({
      where: { entityId: doc.id, action: AuditAction.INCOMING_UPDATED },
      orderBy: { id: 'asc' },
    });
    expect(updates).toHaveLength(2);
    expect(updates[0]!.metadata).toMatchObject({
      changes: { notes: { from: 'Yetkazib beruvchi: Test', to: null } },
      items: { replaced: true, from: { itemsCount: 1 }, to: { itemsCount: 2 } },
    });
    expect(updates[1]!.metadata).toMatchObject({
      changes: { date: { to: '2026-10-07' }, warehouseId: { from: warehouseA, to: warehouseB } },
    });
    await api('patch', `/incoming/${doc.id}`, adminToken).send({}).expect(400);
  });
});

describe('tasdiqlash (AC-09, AC-10, BR-08, REQ-064, REQ-145)', () => {
  it('qoldiq to‘g‘ri oshadi; ledger (unitCost = kelgan narxi, balance_after); takroriy tasdiqlash → 409, qoldiq bir marta', async () => {
    const p1 = await product();
    const p2 = await product({ unit: 'KG' });
    // Avvalgi qoldiq bilan: balance_after zanjiri davom etadi.
    const first = await draft([line(p1, '3', '700.00')]);
    await confirm(first.id).expect(200);
    const doc = await draft([line(p1, '7', '800.00'), line(p2, '1.250', '12000.00')]);
    const res = await confirm(doc.id).expect(200);
    expect(res.body).toMatchObject({ status: 'CONFIRMED', confirmedBy: { id: adminId } });
    expect(res.body.confirmedAt).toEqual(expect.any(String));
    expect(await stockOf(warehouseA, p1)).toBe('10.000');
    expect(await stockOf(warehouseA, p2)).toBe('1.250');

    const ledger = await movementsOf(doc.id);
    expect(
      ledger
        .map((m) => [
          m.productId,
          m.movementType,
          m.quantity.toFixed(3),
          m.balanceAfter.toFixed(3),
          m.unitCost?.toFixed(2),
        ])
        .sort(),
    ).toEqual(
      [
        [p1, 'INCOMING', '7.000', '10.000', '800.00'],
        [p2, 'INCOMING', '1.250', '1.250', '12000.00'],
      ].sort(),
    );
    const again = await confirm(doc.id).expect(409);
    expect(again.body.error).toMatchObject({
      code: 'INCOMING_NOT_DRAFT',
      details: [{ field: 'status', message: 'CONFIRMED' }],
    });
    expect(await stockOf(warehouseA, p1)).toBe('10.000');
    expect(await movementsOf(doc.id)).toHaveLength(2);
    const audit = await t.prisma.auditLog.findMany({
      where: { entityId: doc.id, action: AuditAction.INCOMING_CONFIRMED },
    });
    expect(audit).toHaveLength(1);
    expect(audit[0]!.metadata).toMatchObject({
      number: doc.number,
      warehouseId: warehouseA,
      itemsCount: 2,
      totalQuantity: '8.250',
      totalAmount: '20600.00',
    });
  });

  it('parallel: 5 ta bir vaqtdagi tasdiqlashdan aniq bittasi o‘tadi, qoldiq bir marta oshadi', async () => {
    const p = await product();
    const doc = await draft([line(p, '4')]);
    const results = await Promise.all(Array.from({ length: 5 }, () => confirm(doc.id)));
    expect(results.map((r) => r.status).sort()).toEqual([200, 409, 409, 409, 409]);
    expect(await stockOf(warehouseA, p)).toBe('4.000');
    expect(await movementsOf(doc.id)).toHaveLength(1);
  });

  it('noto‘g‘ri qator (nofaol mahsulot, kasr siyosati) — butun tasdiqlash rad etiladi, hech narsa o‘zgarmaydi', async () => {
    const good = await product();
    const bad = await product({ unit: 'KG' });
    const doc = await draft([line(good, '5'), line(bad, '1.5')]);
    // Qoralamadan keyin mahsulot "dona"ga o'tkazildi: 1.5 endi ruxsat etilmaydi.
    await t.prisma.product.update({
      where: { id: bad },
      data: { unit: 'DONA', allowDecimal: false },
    });
    const fraction = await confirm(doc.id).expect(422);
    expect(fraction.body.error).toMatchObject({
      code: 'INVALID_QUANTITY',
      details: [{ field: 'items[1].quantity' }],
    });
    await t.prisma.product.update({ where: { id: good }, data: { status: 'INACTIVE' } });
    const inactive = await confirm(doc.id).expect(422);
    expect(inactive.body.error.code).toBe('PRODUCT_INACTIVE');

    expect(await stockOf(warehouseA, good)).toBe('0.000');
    expect(await movementsOf(doc.id)).toEqual([]);
    const stored = await t.prisma.incoming.findUniqueOrThrow({ where: { id: doc.id } });
    expect(stored).toMatchObject({ status: 'DRAFT', confirmedById: null, confirmedAt: null });
  });

  it('atomiklik: ledger yozish o‘rtasida xato → qoldiq, ledger, holat va audit to‘liq qaytariladi', async () => {
    const p1 = await product();
    const p2 = await product();
    const doc = await draft([line(p1, '2'), line(p2, '3')]);
    const repo = t.app.get(InventoryRepository, { strict: false });
    const original = repo.insertMovement.bind(repo);
    let calls = 0;
    const spy = vi.spyOn(repo, 'insertMovement').mockImplementation(async (...args) => {
      calls += 1;
      // Birinchi qator to'liq yoziladi (stock ↑ + ledger), ikkinchisida — nosozlik.
      if (calls === 2) throw new Error('sun’iy nosozlik: ikkinchi qator');
      return original(...args);
    });
    try {
      const res = await confirm(doc.id);
      expect(res.status).toBe(500);
      expect(res.text).not.toContain('sun’iy');
    } finally {
      spy.mockRestore();
    }
    expect(calls).toBe(2);
    expect(await stockOf(warehouseA, p1)).toBe('0.000');
    expect(await stockOf(warehouseA, p2)).toBe('0.000');
    expect(await movementsOf(doc.id)).toEqual([]);
    expect((await t.prisma.incoming.findUniqueOrThrow({ where: { id: doc.id } })).status).toBe(
      'DRAFT',
    );
    expect(
      await t.prisma.auditLog.count({
        where: { entityId: doc.id, action: AuditAction.INCOMING_CONFIRMED },
      }),
    ).toBe(0);
    // Nosozlik bartaraf etilgach — hujjat odatdagidek tasdiqlanadi.
    await confirm(doc.id).expect(200);
    expect(await stockOf(warehouseA, p2)).toBe('3.000');
  });

  it('nofaol ombor: yaratish, tahrirlash va tasdiqlash → 422 WAREHOUSE_INACTIVE; bekor qilish mumkin', async () => {
    const w = await withCommit((db) => createWarehouse(db, adminId));
    const p = await product();
    const doc = await draft([line(p, '2')], w);
    await api('patch', `/warehouses/${w}/status`, adminToken)
      .send({ status: 'INACTIVE' })
      .expect(200);
    const res = await confirm(doc.id).expect(422);
    expect(res.body.error.code).toBe('WAREHOUSE_INACTIVE');
    await api('patch', `/incoming/${doc.id}`, adminToken).send({ notes: 'x' }).expect(422);
    await api('post', '/incoming', adminToken)
      .send({ date: '2026-10-06', warehouseId: w, items: [line(p, '1')] })
      .expect(422);
    expect(await stockOf(w, p)).toBe('0.000');
    const cancelled = await api('post', `/incoming/${doc.id}/cancel`, adminToken).expect(200);
    expect(cancelled.body).toMatchObject({ status: 'CANCELLED', cancelledBy: { id: adminId } });
  });

  it('tasdiqlangan va bekor qilingan hujjat o‘zgarmaydi: PATCH/cancel/confirm → 409; DB trigger ham rad etadi', async () => {
    const p = await product();
    const doc = await draft([line(p, '5')]);
    await confirm(doc.id).expect(200);
    for (const res of [
      await api('patch', `/incoming/${doc.id}`, adminToken).send({ items: [line(p, '500')] }),
      await api('post', `/incoming/${doc.id}/cancel`, adminToken),
    ]) {
      expect(res.status).toBe(409);
      expect(res.body.error.code).toBe('INCOMING_NOT_DRAFT');
    }
    await expect(
      t.prisma
        .$executeRaw`UPDATE incoming_items SET quantity = 500 WHERE incoming_id = ${doc.id}::uuid`,
    ).rejects.toThrow();
    expect(await stockOf(warehouseA, p)).toBe('5.000');

    const other = await draft([line(p, '1')]);
    await api('post', `/incoming/${other.id}/cancel`, adminToken).expect(200);
    await confirm(other.id).expect(409);
    expect(await stockOf(warehouseA, p)).toBe('5.000');
  });
});

describe('tarix, kelgan narxi va reconciliation', () => {
  it('mahsulot keyin tahrirlansa ham hujjat snapshot’lari o‘zgarmaydi', async () => {
    const p = await product({ name: `Eski nom ${uniqueLogin('n')}` });
    const before = await t.prisma.product.findUniqueOrThrow({ where: { id: p } });
    const doc = await draft([line(p, '2', '1500.00')]);
    await confirm(doc.id).expect(200);
    await api('patch', `/products/${p}`, adminToken)
      .send({
        name: `Yangi nom ${uniqueLogin('n')}`,
        barcode: `479${Date.now().toString().slice(-9)}`,
        costPrice: '1',
      })
      .expect(200);
    const res = await api('get', `/incoming/${doc.id}`, adminToken).expect(200);
    expect(res.body.items[0]).toMatchObject({
      productName: before.name,
      barcode: before.barcode,
      costPrice: '1500.00',
      lineTotal: '3000.00',
    });
    expect(res.body.totalAmount).toBe('3000.00');
  });

  it('D-16: kelgan narxi 0 qabul qilinadi; o‘tgan va kelajak sanalar qabul qilinadi; o‘chirish endpointi yo‘q', async () => {
    const p = await product();
    const free = await draft([line(p, '2', '0')]);
    expect(free).toMatchObject({ status: 'DRAFT', totalAmount: '0.00' });
    await confirm(free.id).expect(200);
    for (const date of ['2020-01-01', '2030-12-31']) {
      const res = await api('post', '/incoming', adminToken)
        .send({ date, warehouseId: warehouseA, items: [line(p, '1')] })
        .expect(201);
      expect(res.body.date).toBe(date);
    }
    const del = await request(t.app.getHttpServer())
      .delete(`/api/v1/incoming/${free.id}`)
      .set(bearer(adminToken));
    expect(del.status).toBe(404);
    expect(await t.prisma.incoming.count({ where: { id: free.id, status: 'CONFIRMED' } })).toBe(1);
  });

  it('D-16: kirim mahsulot kartochkasidagi `cost_price`ni o‘zgartirmaydi; foyda va ombor qiymati kartochka tannarxidan', async () => {
    const w = await withCommit((db) => createWarehouse(db, adminId));
    const p = await product(); // kartochkada kelgan narxi = COST (1 834 567.00)
    const doc = await draft([line(p, '5', '1500.00')], w);
    await confirm(doc.id).expect(200);

    // 1) Kartochka o'zgarmadi; kirim narxi hujjat tarixida va ledger'da saqlandi.
    const card = await t.prisma.product.findUniqueOrThrow({ where: { id: p } });
    expect(card.costPrice.toFixed(2)).toBe(COST);
    const incomingItem = await t.prisma.incomingItem.findFirstOrThrow({
      where: { incomingId: doc.id },
    });
    expect(incomingItem.costPrice.toFixed(2)).toBe('1500.00');
    const [incomingMove] = await movementsOf(doc.id);
    expect(incomingMove!.unitCost?.toFixed(2)).toBe('1500.00');

    // 2) Sotuv (DATABASE §5.3 algoritmi — Phase 10 sotuv servisi aynan shuni bajaradi) tannarxni kartochkadan oladi.
    const { saleId } = await withCommit(async (db) =>
      sell(db, {
        warehouseId: w,
        userId: adminId,
        customerId: await createCustomer(db, adminId),
        lines: [{ productId: p, quantity: '2', price: '2000000.00' }],
      }),
    );
    const saleItem = await t.prisma.saleItem.findFirstOrThrow({ where: { saleId } });
    expect(saleItem.unitCost.toFixed(2)).toBe(COST);
    expect(saleItem.lineCost.toFixed(2)).toBe('3669134.00');

    // 3) Foyda (`GET /products/:id/summary`) = tushum − miqdor × kartochka tannarxi; kirim narxi (1500) emas.
    const summary = await api('get', `/products/${p}/summary`, adminToken).expect(200);
    expect(summary.body).toMatchObject({
      totalRevenue: '4000000.00',
      totalCost: '3669134.00',
      grossProfit: '330866.00',
    });
    expect(summary.body.grossProfit).not.toBe('3997000.00');
    // 4) Ombor qiymati ham kartochka tannarxida: 3 × 1 834 567.00.
    const detail = await api('get', `/warehouses/${w}`, adminToken).expect(200);
    expect(detail.body).toMatchObject({ totalQuantity: '3.000', stockValue: '5503701.00' });
    // 5) Kartochka tannarxi o'zgarsa — eski sotuv foydasi o'zgarmaydi (snapshot, D-02).
    await api('patch', `/products/${p}`, adminToken).send({ costPrice: '1.00' }).expect(200);
    const after = await api('get', `/products/${p}/summary`, adminToken).expect(200);
    expect(after.body.grossProfit).toBe('330866.00');
  });

  it('`products.read_cost`siz: costPrice, lineTotal, totalAmount kaliti yo‘q; summa bo‘yicha saralash → 400', async () => {
    const p = await product();
    const doc = await draft([line(p, '3', '1834567.00')]);
    const service = t.app.get(IncomingService);
    const noCost = context(['products.read_cost']);
    const detail = await service.get(noCost, doc.id);
    expect(detail).not.toHaveProperty('totalAmount');
    expect(detail.items?.[0]).not.toHaveProperty('costPrice');
    expect(detail.items?.[0]).not.toHaveProperty('lineTotal');
    const list = await service.list(noCost, {
      page: 1,
      pageSize: 5,
      sort: { field: 'date', direction: 'desc' },
    });
    expect(JSON.stringify([detail, list])).not.toMatch(/1834567|5503701/);
    await expect(
      service.list(noCost, {
        page: 1,
        pageSize: 5,
        sort: { field: 'totalAmount', direction: 'desc' },
      }),
    ).rejects.toMatchObject({ code: 'VALIDATION_ERROR' });
    // ADMIN (ruxsati bor) — ko'radi.
    const admin = await api('get', `/incoming/${doc.id}`, adminToken).expect(200);
    expect(admin.body).toMatchObject({ totalAmount: '5503701.00' });
  });

  it('qidiruv va filtrlar: raqam (K-…), holat, ombor, mahsulot, sana; saralash', async () => {
    const p = await product();
    const a = await draft([line(p, '1')]);
    const b = await draft([line(p, '2')], warehouseB);
    await confirm(b.id).expect(200);
    const byNumber = await api('get', `/incoming?search=${a.number}`, adminToken).expect(200);
    expect(byNumber.body.data.map((d: { id: string }) => d.id)).toEqual([a.id]);
    const digits = await api('get', `/incoming?search=${Number(a.number.slice(2))}`, adminToken);
    expect(digits.body.data.map((d: { id: string }) => d.id)).toEqual([a.id]);
    const byProduct = await api(
      'get',
      `/incoming?productId=${p}&status=CONFIRMED&warehouseId=${warehouseB}`,
      adminToken,
    ).expect(200);
    expect(byProduct.body.data.map((d: { id: string }) => d.id)).toEqual([b.id]);
    expect(byProduct.body.data[0]).not.toHaveProperty('items');
    const range = await api('get', `/incoming?productId=${p}&dateFrom=2026-10-07`, adminToken);
    expect(range.body.meta.total).toBe(0);
    const sorted = await api('get', `/incoming?productId=${p}&sort=totalQuantity:desc`, adminToken);
    expect(sorted.body.data.map((d: { id: string }) => d.id)).toEqual([b.id, a.id]);
    await api('get', '/incoming?sort=notes:asc', adminToken).expect(400);
    await api('get', '/incoming?status=DELETED', adminToken).expect(400);
  });

  it('reconciliation kirimdan keyin ham toza: qoldiq = ledger, hujjat ↔ harakatlar mos', async () => {
    const w = await withCommit((db) => createWarehouse(db, adminId));
    const p1 = await product();
    const p2 = await product();
    const doc = await draft([line(p1, '9'), line(p2, '4')], w);
    await confirm(doc.id).expect(200);
    const second = await draft([line(p1, '1')], w);
    await confirm(second.id).expect(200);
    const rec = await api('get', '/inventory/reconciliation', adminToken).expect(200);
    expect(rec.body.mismatches.map((m: { warehouseId: string }) => m.warehouseId)).not.toContain(w);
    const ids = [doc.id, second.id];
    const docIssues = [
      ...(await t.prisma.$queryRaw<unknown[]>`
        SELECT * FROM reconcile_document_movements WHERE document_id = ANY(${ids}::uuid[])`),
      ...(await t.prisma.$queryRaw<unknown[]>`
        SELECT * FROM reconcile_document_totals WHERE document_id = ANY(${ids}::uuid[])`),
    ];
    expect(docIssues).toEqual([]);
    const detail = await api('get', `/warehouses/${w}`, adminToken).expect(200);
    expect(detail.body).toMatchObject({
      totalQuantity: '14.000',
      productCount: 2,
      incoming30: '14.000',
    });
    const product1 = await api('get', `/products/${p1}`, adminToken).expect(200);
    expect(product1.body).toMatchObject({ received: '10.000', stock: '10.000' });
  });
});
