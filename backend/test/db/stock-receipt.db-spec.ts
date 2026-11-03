import {
  ALL_PERMISSIONS,
  AuditAction,
  type Permission,
  type ProductCreateInput,
} from '@divine/shared';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import type { AccessContext } from '../../src/common/auth/access-context.js';
import { InventoryRepository } from '../../src/modules/inventory/inventory.repository.js';
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

const receipt = (quantity: string, extra: Record<string, unknown> = {}) => ({
  warehouseId: warehouseA,
  quantity,
  costPrice: '1000.00',
  date: '2026-10-06',
  notes: 'Yetkazib beruvchi: Test',
  ...extra,
});

const addStock = (productId: string, body: object, token = adminToken) =>
  api('post', `/products/${productId}/stock`, token).send(body);

function newProduct(extra: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    name: `Qoldiqli mahsulot ${Math.random().toString(36).slice(2, 8)}`,
    groupId,
    costPrice: '700.00',
    salePrice: '900.00',
    unit: 'DONA',
    allowDecimal: false,
    ...extra,
  };
}

/** Mahsulotning eng so'nggi kirim hujjati (qoldiq qo'shish shu jadvalga yoziladi). */
const lastIncomingOf = (productId: string) =>
  t.prisma.incoming.findFirstOrThrow({
    where: { items: { some: { productId } } },
    orderBy: { number: 'desc' },
    include: { items: true },
  });

async function stockOf(warehouseId: string, productId: string): Promise<string> {
  const row = await t.prisma.warehouseStock.findUnique({
    where: { warehouseId_productId: { warehouseId, productId } },
  });
  return row ? row.quantity.toFixed(3) : '0.000';
}

const movementsOf = (referenceId: string) =>
  t.prisma.inventoryMovement.findMany({ where: { referenceId }, orderBy: { id: 'asc' } });

beforeAll(async () => {
  t = await createAuthApp();
  const admin = await createUser(t, { password: PASSWORD, role: 'ADMIN' });
  adminId = admin.id;
  adminToken = await signIn(admin.login);
  [warehouseA, groupId] = await withCommit(async (db) => [
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
  it('anonim → 401; sotuvchi (o‘z ombori bilan ham) qoldiq qo‘sha olmaydi va boshlang‘ich qoldiqli mahsulot yarata olmaydi → 403', async () => {
    const p = await product();
    await api('post', `/products/${p}/stock`).send(receipt('1')).expect(401);
    for (const res of [
      await addStock(p, receipt('5'), sellerToken),
      await api('post', '/products', sellerToken).send(
        newProduct({
          initialStock: { warehouseId: warehouseA, quantity: '5', date: '2026-10-06' },
        }),
      ),
    ]) {
      expect(res.status).toBe(403);
      expect(res.body.error.code).toBe('FORBIDDEN');
    }
    expect(await stockOf(warehouseA, p)).toBe('0.000');
  });

  it('eski `/incoming` endpointlari yo‘q (404) — qoldiq faqat mahsulotlar bo‘limidan qo‘shiladi', async () => {
    for (const res of [
      await api('get', '/incoming', adminToken),
      await api('post', '/incoming', adminToken).send({}),
    ]) {
      expect(res.status).toBe(404);
    }
  });

  it('`incoming.confirm`siz: boshlang‘ich qoldiq bilan yaratish → 403 va mahsulot ham yaratilmaydi', async () => {
    const keep = ALL_PERMISSIONS.filter((p: Permission) => p !== 'incoming.confirm');
    // ProductsService ruxsatni tranzaksiyadan oldin tekshiradi — service darajasida sinaymiz.
    const { ProductsService } = await import('../../src/modules/products/products.service.js');
    const service = t.app.get(ProductsService, { strict: false });
    const ctx: AccessContext = {
      userId: adminId,
      login: 'test',
      role: 'ADMIN',
      permissions: new Set(keep),
      warehouseIds: new Set(),
      issuedAt: 0,
    };
    const name = `Ruxsatsiz ${Math.random().toString(36).slice(2, 8)}`;
    await expect(
      service.create(
        ctx,
        {
          ...newProduct({ name }),
          status: 'ACTIVE',
          initialStock: { warehouseId: warehouseA, quantity: '3', date: '2026-10-06' },
        } as ProductCreateInput,
        meta,
      ),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });
    expect(await t.prisma.product.count({ where: { name } })).toBe(0);
  });
});

describe('yangi mahsulot + boshlang‘ich qoldiq (bitta tranzaksiya)', () => {
  it('qoldiq, ledger (unitCost = kartadagi kelgan narxi), kirim hujjati va audit bir vaqtda yoziladi', async () => {
    const res = await api('post', '/products', adminToken)
      .send(
        newProduct({
          initialStock: {
            warehouseId: warehouseA,
            quantity: '12',
            date: '2026-10-05',
            notes: 'Boshlang‘ich',
          },
        }),
      )
      .expect(201);
    const id = res.body.id as string;
    expect(res.body).toMatchObject({ stock: '12.000', received: '12.000', costPrice: '700.00' });
    expect(await stockOf(warehouseA, id)).toBe('12.000');

    const doc = await lastIncomingOf(id);
    expect(doc).toMatchObject({
      status: 'CONFIRMED',
      notes: 'Boshlang‘ich',
      confirmedById: adminId,
    });
    expect(doc.incomingDate.toISOString().slice(0, 10)).toBe('2026-10-05');
    expect(doc.items).toHaveLength(1);
    expect(doc.items[0]!.costPrice.toFixed(2)).toBe('700.00');
    const [move] = await movementsOf(doc.id);
    expect([move!.movementType, move!.quantity.toFixed(3), move!.unitCost?.toFixed(2)]).toEqual([
      'INCOMING',
      '12.000',
      '700.00',
    ]);
    const audit = await t.prisma.auditLog.findMany({
      where: {
        action: { in: [AuditAction.PRODUCT_CREATED, AuditAction.INCOMING_CONFIRMED] },
        OR: [{ entityId: id }, { entityId: doc.id }],
      },
    });
    expect(audit.map((a) => a.action).sort()).toEqual(
      [AuditAction.INCOMING_CONFIRMED, AuditAction.PRODUCT_CREATED].sort(),
    );
    expect(audit.find((a) => a.action === AuditAction.INCOMING_CONFIRMED)!.metadata).toMatchObject({
      warehouseId: warehouseA,
      itemsCount: 1,
      totalQuantity: '12.000',
      totalAmount: '8400.00',
    });
  });

  it('qoldiqsiz yaratish avvalgidek: kirim hujjati yo‘q, qoldiq 0', async () => {
    const res = await api('post', '/products', adminToken).send(newProduct()).expect(201);
    expect(res.body.stock).toBe('0.000');
    expect(await t.prisma.incomingItem.count({ where: { productId: res.body.id } })).toBe(0);
  });

  it('atomiklik: ombor nofaol / kasr miqdor / nofaol mahsulot → xato va mahsulot ham yaratilmaydi', async () => {
    const w = await withCommit((db) => createWarehouse(db, adminId));
    await api('patch', `/warehouses/${w}/status`, adminToken)
      .send({ status: 'INACTIVE' })
      .expect(200);
    const cases: [Record<string, unknown>, number, string, string?][] = [
      [
        { initialStock: { warehouseId: w, quantity: '2', date: '2026-10-06' } },
        422,
        'WAREHOUSE_INACTIVE',
      ],
      [
        { initialStock: { warehouseId: warehouseA, quantity: '1.5', date: '2026-10-06' } },
        422,
        'INVALID_QUANTITY',
        'initialStock.quantity',
      ],
      [
        {
          status: 'INACTIVE',
          initialStock: { warehouseId: warehouseA, quantity: '2', date: '2026-10-06' },
        },
        400,
        'VALIDATION_ERROR',
        'initialStock',
      ],
    ];
    for (const [extra, status, code, field] of cases) {
      const name = `Atomik ${Math.random().toString(36).slice(2, 8)}`;
      const res = await api('post', '/products', adminToken).send(newProduct({ name, ...extra }));
      expect(res.status, code).toBe(status);
      expect(res.body.error.code).toBe(code);
      if (field)
        expect(res.body.error.details.map((d: { field: string }) => d.field)).toContain(field);
      expect(await t.prisma.product.count({ where: { name } })).toBe(0);
    }
  });

  it('atomiklik: ledger yozishda nosozlik → mahsulot, hujjat, qoldiq va audit to‘liq qaytariladi', async () => {
    const repo = t.app.get(InventoryRepository, { strict: false });
    const spy = vi.spyOn(repo, 'insertMovement').mockRejectedValue(new Error('sun’iy nosozlik'));
    const name = `Nosozlik ${Math.random().toString(36).slice(2, 8)}`;
    try {
      const res = await api('post', '/products', adminToken).send(
        newProduct({
          name,
          initialStock: { warehouseId: warehouseA, quantity: '4', date: '2026-10-06' },
        }),
      );
      expect(res.status).toBe(500);
      expect(res.text).not.toContain('sun’iy');
    } finally {
      spy.mockRestore();
    }
    expect(await t.prisma.product.count({ where: { name } })).toBe(0);
    expect(
      await t.prisma.auditLog.count({
        where: { action: AuditAction.PRODUCT_CREATED, metadata: { path: ['name'], equals: name } },
      }),
    ).toBe(0);
  });
});

describe('mavjud mahsulotga qoldiq qo‘shish (POST /products/:id/stock)', () => {
  it('qoldiq oshadi, ledger zanjiri (balance_after) davom etadi, javobda yangilangan mahsulot', async () => {
    const p1 = await product();
    const p2 = await product({ unit: 'KG' });
    await addStock(p1, receipt('3', { costPrice: '700.00' })).expect(201);
    const res = await addStock(p1, receipt('7', { costPrice: '800.00' })).expect(201);
    expect(res.body).toMatchObject({ id: p1, stock: '10.000', received: '10.000' });
    await addStock(p2, receipt('1.250', { costPrice: '12000.00' })).expect(201);
    expect(await stockOf(warehouseA, p1)).toBe('10.000');
    expect(await stockOf(warehouseA, p2)).toBe('1.250');
    const doc = await lastIncomingOf(p1);
    const [move] = await movementsOf(doc.id);
    expect([
      move!.quantity.toFixed(3),
      move!.balanceAfter.toFixed(3),
      move!.unitCost?.toFixed(2),
    ]).toEqual(['7.000', '10.000', '800.00']);
    const audit = await t.prisma.auditLog.findFirstOrThrow({
      where: { entityId: doc.id, action: AuditAction.INCOMING_CONFIRMED },
    });
    expect(audit.metadata).toMatchObject({ totalQuantity: '7.000', totalAmount: '5600.00' });
  });

  it('xatolar maydon bilan: kasr (DONA) → 422 quantity; nofaol mahsulot → 422; nofaol ombor → 422; yo‘q mahsulot → 404; noma’lum maydon → 400', async () => {
    const p = await product();
    const inactive = await product({ status: 'INACTIVE' });
    const w = await withCommit((db) => createWarehouse(db, adminId));
    await api('patch', `/warehouses/${w}/status`, adminToken)
      .send({ status: 'INACTIVE' })
      .expect(200);

    const decimal = await addStock(p, receipt('1.5')).expect(422);
    expect(decimal.body.error).toMatchObject({
      code: 'INVALID_QUANTITY',
      details: [{ field: 'quantity' }],
    });
    expect((await addStock(inactive, receipt('1')).expect(422)).body.error.code).toBe(
      'PRODUCT_INACTIVE',
    );
    expect((await addStock(p, receipt('1', { warehouseId: w })).expect(422)).body.error.code).toBe(
      'WAREHOUSE_INACTIVE',
    );
    await addStock('00000000-0000-4000-8000-000000000000', receipt('1')).expect(404);
    await addStock(p, receipt('1', { lineTotal: '1.00' })).expect(400);
    await addStock(p, receipt('0')).expect(400);
    expect(await stockOf(warehouseA, p)).toBe('0.000');
  });

  it('parallel: 5 ta bir vaqtdagi qo‘shish — har biri bir marta, qoldiq yig‘indisi to‘g‘ri', async () => {
    const p = await product();
    const results = await Promise.all(Array.from({ length: 5 }, () => addStock(p, receipt('2'))));
    expect(results.map((r) => r.status)).toEqual([201, 201, 201, 201, 201]);
    expect(await stockOf(warehouseA, p)).toBe('10.000');
  });

  it('D-16: qoldiq qo‘shish kartadagi `cost_price`ni o‘zgartirmaydi; foyda va ombor qiymati kartadan', async () => {
    const w = await withCommit((db) => createWarehouse(db, adminId));
    const p = await product(); // kartada kelgan narxi = COST
    await addStock(p, receipt('5', { warehouseId: w, costPrice: '1500.00' })).expect(201);
    const card = await t.prisma.product.findUniqueOrThrow({ where: { id: p } });
    expect(card.costPrice.toFixed(2)).toBe(COST);
    const doc = await lastIncomingOf(p);
    expect(doc.items[0]!.costPrice.toFixed(2)).toBe('1500.00');

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
    const detail = await api('get', `/warehouses/${w}`, adminToken).expect(200);
    expect(detail.body).toMatchObject({ totalQuantity: '3.000', stockValue: '5503701.00' });
  });

  it('reconciliation toza: qoldiq = ledger, hujjat ↔ harakatlar mos; ombor `incoming30` hisoblanadi', async () => {
    const w = await withCommit((db) => createWarehouse(db, adminId));
    const p1 = await product();
    const p2 = await product();
    await addStock(p1, receipt('9', { warehouseId: w })).expect(201);
    await addStock(p2, receipt('4', { warehouseId: w })).expect(201);
    await addStock(p1, receipt('1', { warehouseId: w })).expect(201);
    const rec = await api('get', '/inventory/reconciliation', adminToken).expect(200);
    expect(rec.body.mismatches.map((m: { warehouseId: string }) => m.warehouseId)).not.toContain(w);
    const ids = (
      await t.prisma.incoming.findMany({ where: { warehouseId: w }, select: { id: true } })
    ).map((d) => d.id);
    expect(ids).toHaveLength(3);
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
  });
});
