import { ALL_PERMISSIONS, AuditAction, type Permission } from '@divine/shared';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { AccessContext } from '../../src/common/auth/access-context.js';
import type { Tx } from '../../src/infrastructure/prisma/transaction-runner.js';
import { TransactionRunner } from '../../src/infrastructure/prisma/transaction-runner.js';
import type { LedgerEntry } from '../../src/modules/inventory/inventory.repository.js';
import { InventoryService } from '../../src/modules/inventory/inventory.service.js';
import { WarehousesService } from '../../src/modules/warehouses/warehouses.service.js';
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
const COST = '1834567.00';

let t: AuthTestApp;
let adminId: string;
let adminToken: string;
let sellerId: string;
let sellerToken: string;
let warehouseA: string;
let warehouseB: string;
let groupId: string;
let inventory: InventoryService;
let transactions: TransactionRunner;

const bearer = (token: string) => ({ Authorization: `Bearer ${token}` });
function api(method: 'get' | 'post' | 'patch' | 'put', path: string, token?: string) {
  const req = request(t.app.getHttpServer())
    [method](`/api/v1${path}`)
    .set('X-Forwarded-For', uniqueIp());
  return token ? req.set(bearer(token)) : req;
}

async function signIn(loginName: string) {
  return (await login(t, { login: loginName, password: PASSWORD }).expect(200)).body
    .accessToken as string;
}

const warehouseName = () => `Ombor ${uniqueLogin('w')}`;
const createViaApi = async (body: Record<string, unknown> = {}) =>
  (
    await api('post', '/warehouses', adminToken)
      .send({ name: warehouseName(), ...body })
      .expect(201)
  ).body as { id: string; name: string; status: string };

const setStatus = (id: string, status: 'ACTIVE' | 'INACTIVE') =>
  api('patch', `/warehouses/${id}/status`, adminToken).send({ status }).expect(200);

async function auditOf(entityId: string) {
  return t.prisma.auditLog.findMany({ where: { entityId }, orderBy: { id: 'asc' } });
}

async function newProduct(overrides: { minStock?: string } = {}) {
  const id = await withCommit((db) =>
    createProduct(db, { groupId, actor: adminId, costPrice: COST, salePrice: '2150000.00' }),
  );
  if (overrides.minStock) {
    await t.prisma.product.update({ where: { id }, data: { minStock: overrides.minStock } });
  }
  return id;
}

/** Kirim hujjati tasdiqlanadi va qoldiq `InventoryService.increase` orqali oshiriladi (Phase 8 tartibi). */
async function receiveViaService(
  warehouseId: string,
  productId: string,
  quantity: string,
): Promise<string> {
  const draft = await withCommit((db) =>
    createDraftIncoming(db, {
      warehouseId,
      actor: adminId,
      lines: [{ productId, quantity, price: COST }],
    }),
  );
  await transactions.run(async (tx) => {
    await tx.$executeRaw`UPDATE incoming SET status = 'CONFIRMED', confirmed_by = ${adminId}::uuid,
      confirmed_at = now() WHERE id = ${draft.incomingId}::uuid`;
    await inventory.increase(tx, [
      {
        warehouseId,
        productId,
        quantity,
        unitCost: COST,
        referenceType: 'INCOMING',
        referenceId: draft.incomingId,
        referenceItemId: draft.itemIds[0] as string,
        actorId: adminId,
      },
    ]);
  });
  return draft.incomingId;
}

/** Sotuv hujjati (snapshot, totallar, mijoz yig'malari) — `decrease` bilan bir tranzaksiyada. */
async function saleDoc(
  tx: Tx,
  opts: { warehouseId: string; customerId: string; productId: string; quantity: string },
): Promise<LedgerEntry> {
  const [sale] = await tx.$queryRaw<{ id: string }[]>`
    INSERT INTO sales (user_id, warehouse_id, customer_id, customer_name_snapshot, customer_phone_snapshot,
                       total_quantity, total_amount, total_cost, idempotency_key, request_hash)
    SELECT ${adminId}::uuid, ${opts.warehouseId}::uuid, c.id, c.name, c.phone,
           ${opts.quantity}::numeric, round(${opts.quantity}::numeric * p.sale_price, 2),
           round(${opts.quantity}::numeric * p.cost_price, 2),
           gen_random_uuid(), encode(sha256(gen_random_uuid()::text::bytea), 'hex')
      FROM customers c, products p WHERE c.id = ${opts.customerId}::uuid AND p.id = ${opts.productId}::uuid
    RETURNING id`;
  const [item] = await tx.$queryRaw<{ id: string; unitCost: string }[]>`
    INSERT INTO sale_items (sale_id, product_id, product_name, barcode, quantity, unit_price, unit_cost)
    SELECT ${sale!.id}::uuid, p.id, p.name, p.barcode, ${opts.quantity}::numeric, p.sale_price, p.cost_price
      FROM products p WHERE p.id = ${opts.productId}::uuid
    RETURNING id, unit_cost::text AS "unitCost"`;
  await tx.$executeRaw`
    UPDATE customers c SET purchase_count = c.purchase_count + 1, total_spent = c.total_spent + s.total_amount,
           last_purchase_at = greatest(c.last_purchase_at, s.sold_at), updated_at = now()
      FROM sales s WHERE s.id = ${sale!.id}::uuid AND c.id = s.customer_id`;
  return {
    warehouseId: opts.warehouseId,
    productId: opts.productId,
    quantity: opts.quantity,
    unitCost: item!.unitCost,
    referenceType: 'SALE',
    referenceId: sale!.id,
    referenceItemId: item!.id,
    actorId: adminId,
  };
}

async function stockOf(warehouseId: string, productId: string): Promise<string> {
  const row = await t.prisma.warehouseStock.findUnique({
    where: { warehouseId_productId: { warehouseId, productId } },
  });
  return row ? row.quantity.toFixed(3) : '0.000';
}

/** Admin kontekstidan ruxsat olib tashlangan nusxa (service darajasidagi cost testlari uchun). */
function contextWithout(permission: Permission): AccessContext {
  return {
    userId: adminId,
    login: 'test',
    role: 'ADMIN',
    permissions: new Set(ALL_PERMISSIONS.filter((p) => p !== permission)),
    warehouseIds: new Set(),
    issuedAt: 0,
  };
}

beforeAll(async () => {
  t = await createAuthApp();
  inventory = t.app.get(InventoryService);
  transactions = t.app.get(TransactionRunner);
  const admin = await createUser(t, { password: PASSWORD, role: 'ADMIN' });
  adminId = admin.id;
  adminToken = await signIn(admin.login);
  [warehouseA, warehouseB, groupId] = await withCommit(async (db) => [
    await createWarehouse(db, adminId, warehouseName()),
    await createWarehouse(db, adminId, warehouseName()),
    await createGroup(db, adminId),
  ]);
  const seller = await createUser(t, { password: PASSWORD, warehouseIds: [warehouseA] });
  sellerId = seller.id;
  sellerToken = await signIn(seller.login);
});

afterAll(async () => {
  await t?.close();
  await closePool();
});

describe('ruxsatlar (RBAC §5, OWN-01)', () => {
  it('anonim → 401; sotuvchi boshqaruv, detal, qoldiq, harakatlar va inventar endpointlarida → 403', async () => {
    await api('get', '/warehouses').expect(401);
    const forbidden = [
      api('post', '/warehouses', sellerToken).send({ name: warehouseName() }),
      api('patch', `/warehouses/${warehouseA}`, sellerToken).send({ name: 'Buzish' }),
      api('patch', `/warehouses/${warehouseA}/status`, sellerToken).send({ status: 'INACTIVE' }),
      // O'ziga biriktirilgan ombor bo'lsa ham: detal/qoldiq/harakatlar — `warehouses.read_all`.
      api('get', `/warehouses/${warehouseA}`, sellerToken),
      api('get', `/warehouses/${warehouseA}/stock`, sellerToken),
      api('get', `/warehouses/${warehouseA}/movements`, sellerToken),
      api('get', '/inventory/movements', sellerToken),
      api('get', `/inventory/movements?warehouseId=${warehouseA}`, sellerToken),
      api('get', '/inventory/reconciliation', sellerToken),
    ];
    for (const res of await Promise.all(forbidden)) {
      expect(res.status).toBe(403);
      expect(res.body.error.code).toBe('FORBIDDEN');
    }
    const after = await t.prisma.warehouse.findUniqueOrThrow({ where: { id: warehouseA } });
    expect(after.status).toBe('ACTIVE');
  });

  it('sotuvchi faqat biriktirilgan ACTIVE omborni ko‘radi — ko‘rsatkichlarsiz; filtrlar bilan ham chetlab o‘tib bo‘lmaydi', async () => {
    const own = await api('get', '/warehouses', sellerToken).expect(200);
    expect(own.body.data.map((w: { id: string }) => w.id)).toEqual([warehouseA]);
    expect(Object.keys(own.body.data[0]).sort()).toEqual(
      ['address', 'createdAt', 'id', 'name', 'status', 'updatedAt'].sort(),
    );
    const bName = (await t.prisma.warehouse.findUniqueOrThrow({ where: { id: warehouseB } })).name;
    for (const query of [
      `?search=${encodeURIComponent(bName)}`,
      '?status=INACTIVE',
      '?pageSize=100',
    ]) {
      const res = await api('get', `/warehouses${query}`, sellerToken).expect(200);
      expect(res.body.data.map((w: { id: string }) => w.id)).not.toContain(warehouseB);
    }
    const denied = await api('get', `/products?warehouseId=${warehouseB}`, sellerToken).expect(403);
    expect(denied.body.error.code).toBe('WAREHOUSE_ACCESS_DENIED');
    await api('get', `/products?warehouseId=${warehouseA}`, sellerToken).expect(200);
  });

  it('ADMIN barcha omborlarni ko‘rsatkichlar bilan ko‘radi; qidiruv, holat filtri, saralash, pagination', async () => {
    const tag = uniqueLogin('q');
    const created = [];
    for (const n of ['B', 'A', 'C']) created.push(await createViaApi({ name: `${tag} ${n}` }));
    await setStatus(created[2]!.id, 'INACTIVE');

    const all = await api('get', `/warehouses?search=${tag}&sort=name:asc`, adminToken).expect(200);
    expect(all.body.data.map((w: { name: string }) => w.name)).toEqual([
      `${tag} A`,
      `${tag} B`,
      `${tag} C`,
    ]);
    expect(all.body.data[0]).toMatchObject({
      productCount: 0,
      totalQuantity: '0.000',
      stockValue: '0.00',
      lowStockCount: 0,
    });
    const inactive = await api('get', `/warehouses?search=${tag}&status=INACTIVE`, adminToken);
    expect(inactive.body.data.map((w: { name: string }) => w.name)).toEqual([`${tag} C`]);
    const page = await api(
      'get',
      `/warehouses?search=${tag}&pageSize=2&page=2&sort=name:asc`,
      adminToken,
    );
    expect(page.body.meta).toMatchObject({ page: 2, pageSize: 2, total: 3, totalPages: 2 });
    expect(page.body.data.map((w: { name: string }) => w.name)).toEqual([`${tag} C`]);
    await api('get', '/warehouses?sort=address:asc', adminToken).expect(400);
    await api('get', '/warehouses?status=DELETED', adminToken).expect(400);
  });
});

describe('yaratish va tahrirlash (REQ-040)', () => {
  it('yaratish: 201, trim, bo‘sh manzil → null, audit WAREHOUSE_CREATED', async () => {
    const name = warehouseName();
    const res = await api('post', '/warehouses', adminToken)
      .send({ name: `  ${name}  `, address: '   ' })
      .expect(201);
    expect(res.body).toMatchObject({ name, address: null, status: 'ACTIVE' });
    const [audit] = await auditOf(res.body.id);
    expect(audit).toMatchObject({
      action: AuditAction.WAREHOUSE_CREATED,
      actorId: adminId,
      entityType: 'WAREHOUSE',
    });
    expect(audit!.metadata).toEqual({ name, address: null });
  });

  it.each([
    ['bo‘sh nom', { name: '   ' }],
    ['uzun nom', { name: 'x'.repeat(201) }],
    ['uzun manzil', { name: 'Ombor', address: 'x'.repeat(301) }],
    ['noma’lum maydon', { name: 'Ombor', status: 'INACTIVE' }],
    ['noto‘g‘ri tur', { name: 42 }],
  ])('validatsiya: %s → 400', async (_label, body) => {
    const res = await api('post', '/warehouses', adminToken).send(body).expect(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
  });

  it('nom case-insensitive unique: takror → 409 NAME_TAKEN; 5 ta parallel so‘rovdan bittasi o‘tadi', async () => {
    const name = warehouseName();
    await api('post', '/warehouses', adminToken).send({ name }).expect(201);
    const dup = await api('post', '/warehouses', adminToken)
      .send({ name: name.toUpperCase() })
      .expect(409);
    expect(dup.body.error).toMatchObject({ code: 'NAME_TAKEN', details: [{ field: 'name' }] });

    const parallelName = warehouseName();
    const results = await Promise.all(
      Array.from({ length: 5 }, () =>
        api('post', '/warehouses', adminToken).send({ name: parallelName }),
      ),
    );
    expect(results.map((r) => r.status).sort()).toEqual([201, 409, 409, 409, 409]);
    expect(await t.prisma.warehouse.count({ where: { name: parallelName } })).toBe(1);
  });

  it('tahrirlash: nom va manzil, o‘zgarishlar audit’da; o‘zgarishsiz — audit yo‘q; takror nom → 409; 404/400', async () => {
    const w = await createViaApi({ address: 'Chilonzor 1' });
    const other = await createViaApi();
    const newName = warehouseName();
    const res = await api('patch', `/warehouses/${w.id}`, adminToken)
      .send({ name: newName, address: '' })
      .expect(200);
    expect(res.body).toMatchObject({ name: newName, address: null });
    const updated = (await auditOf(w.id)).filter((a) => a.action === AuditAction.WAREHOUSE_UPDATED);
    expect(updated).toHaveLength(1);
    expect(updated[0]!.metadata).toEqual({
      name: newName,
      changes: {
        name: { from: w.name, to: newName },
        address: { from: 'Chilonzor 1', to: null },
      },
    });

    await api('patch', `/warehouses/${w.id}`, adminToken).send({ name: newName }).expect(200);
    expect(
      (await auditOf(w.id)).filter((a) => a.action === AuditAction.WAREHOUSE_UPDATED),
    ).toHaveLength(1);

    const dup = await api('patch', `/warehouses/${w.id}`, adminToken)
      .send({ name: other.name.toLowerCase() })
      .expect(409);
    expect(dup.body.error.code).toBe('NAME_TAKEN');
    await api('patch', `/warehouses/${w.id}`, adminToken).send({}).expect(400);
    await api('patch', '/warehouses/01990000-0000-7000-8000-000000000000', adminToken)
      .send({ name: 'Yo‘q' })
      .expect(404);
    await api('get', '/warehouses/not-a-uuid', adminToken).expect(400);
  });
});

describe('holat va yaxlitlik (BR-21, D-13)', () => {
  it('nofaol qilish → faollashtirish; bir xil holat — idempotent; audit from/to va foydalanish soni bilan', async () => {
    const w = await createViaApi();
    const user = await createUser(t, { password: PASSWORD, warehouseIds: [w.id] });

    const off = await setStatus(w.id, 'INACTIVE');
    expect(off.body.status).toBe('INACTIVE');
    await setStatus(w.id, 'INACTIVE');
    const on = await setStatus(w.id, 'ACTIVE');
    expect(on.body.status).toBe('ACTIVE');
    await api('patch', `/warehouses/${w.id}/status`, adminToken).send({ status: 'X' }).expect(400);

    const changes = (await auditOf(w.id)).filter(
      (a) => a.action === AuditAction.WAREHOUSE_STATUS_CHANGED,
    );
    expect(changes.map((a) => a.metadata)).toEqual([
      { name: w.name, from: 'ACTIVE', to: 'INACTIVE', assignedUsers: 1, productsInStock: 0 },
      { name: w.name, from: 'INACTIVE', to: 'ACTIVE', assignedUsers: 1, productsInStock: 0 },
    ]);
    expect(changes.every((a) => a.actorId === adminId)).toBe(true);
    expect(await t.prisma.userWarehouse.count({ where: { userId: user.id } })).toBe(1);
  });

  it('nofaol ombor: mavjud biriktiruv saqlanadi; yangi biriktirish → 422; sotuvchi ro‘yxatidan keyingi so‘rovda yo‘qoladi', async () => {
    const w = await createViaApi();
    await api('put', `/users/${sellerId}/warehouses`, adminToken)
      .send({ warehouseIds: [warehouseA, w.id] })
      .expect(200);
    const before = await api('get', '/warehouses', sellerToken).expect(200);
    expect(before.body.data.map((x: { id: string }) => x.id).sort()).toEqual(
      [warehouseA, w.id].sort(),
    );

    await setStatus(w.id, 'INACTIVE');
    // Xuddi shu token bilan keyingi so'rov — o'zgarish darhol kuchga kiradi.
    const after = await api('get', '/warehouses', sellerToken).expect(200);
    expect(after.body.data.map((x: { id: string }) => x.id)).toEqual([warehouseA]);
    // Biriktiruv o'chmaydi (D-13): user detali va DB'da saqlanadi.
    expect(
      await t.prisma.userWarehouse.count({ where: { userId: sellerId, warehouseId: w.id } }),
    ).toBe(1);
    const detail = await api('get', `/users/${sellerId}`, adminToken).expect(200);
    expect(detail.body.warehouses.map((x: { id: string }) => x.id)).toContain(w.id);
    // Avvaldan biriktirilgan nofaol ombor bilan saqlash mumkin; yangi userga biriktirib bo'lmaydi.
    await api('put', `/users/${sellerId}/warehouses`, adminToken)
      .send({ warehouseIds: [warehouseA, w.id] })
      .expect(200);
    const fresh = await createUser(t, { password: PASSWORD });
    const rejected = await api('put', `/users/${fresh.id}/warehouses`, adminToken)
      .send({ warehouseIds: [w.id] })
      .expect(422);
    expect(rejected.body.error.code).toBe('WAREHOUSE_INACTIVE');
    const createRejected = await api('post', '/users', adminToken)
      .send({ login: uniqueLogin('n'), fullName: 'Yangi', role: 'USER', warehouseIds: [w.id] })
      .expect(422);
    expect(createRejected.body.error.code).toBe('WAREHOUSE_INACTIVE');
    const options = await api('get', '/users/warehouse-options', adminToken).expect(200);
    expect(options.body.map((o: { id: string }) => o.id)).not.toContain(w.id);

    // Qayta faollashtirilsa — yana ko'rinadi; nom o'zgarishi ham keyingi so'rovda.
    await setStatus(w.id, 'ACTIVE');
    const renamed = warehouseName();
    await api('patch', `/warehouses/${w.id}`, adminToken).send({ name: renamed }).expect(200);
    const back = await api('get', '/warehouses', sellerToken).expect(200);
    expect(back.body.data.find((x: { id: string }) => x.id === w.id)?.name).toBe(renamed);

    await api('put', `/users/${sellerId}/warehouses`, adminToken)
      .send({ warehouseIds: [warehouseA] })
      .expect(200);
    await api('get', '/warehouses', sellerToken).expect(200);
  });
});

describe('InventoryService (DATABASE §5.3, BR-21, BR-26, REQ-161)', () => {
  it('increase/decrease: stock va ledger (balance_after) mos; reconciliation toza', async () => {
    const w = await createViaApi();
    const productId = await newProduct();
    const customerId = await withCommit((db) => createCustomer(db, adminId));
    await receiveViaService(w.id, productId, '10');
    await transactions.run(async (tx) => {
      await inventory.decrease(tx, [
        await saleDoc(tx, { warehouseId: w.id, customerId, productId, quantity: '3' }),
      ]);
    });
    expect(await stockOf(w.id, productId)).toBe('7.000');
    const ledger = await t.prisma.inventoryMovement.findMany({
      where: { warehouseId: w.id, productId },
      orderBy: { id: 'asc' },
    });
    expect(
      ledger.map((m) => [m.movementType, m.quantity.toFixed(3), m.balanceAfter.toFixed(3)]),
    ).toEqual([
      ['INCOMING', '10.000', '10.000'],
      ['SALE', '-3.000', '7.000'],
    ]);
    const drift = await t.prisma.$queryRaw<unknown[]>`
      SELECT * FROM reconcile_inventory_stock WHERE warehouse_id = ${w.id}::uuid`;
    expect(drift).toEqual([]);
  });

  it('qoldiq yetmasa — 409 INSUFFICIENT_STOCK, butun tranzaksiya bekor (hujjat ham, stock ham)', async () => {
    const w = await createViaApi();
    const productId = await newProduct();
    const customerId = await withCommit((db) => createCustomer(db, adminId));
    await receiveViaService(w.id, productId, '2');
    const salesBefore = await t.prisma.sale.count({ where: { warehouseId: w.id } });
    await expect(
      transactions.run(async (tx) => {
        await inventory.decrease(tx, [
          await saleDoc(tx, { warehouseId: w.id, customerId, productId, quantity: '3' }),
        ]);
      }),
    ).rejects.toMatchObject({ code: 'INSUFFICIENT_STOCK', status: 409 });
    expect(await stockOf(w.id, productId)).toBe('2.000');
    expect(await t.prisma.sale.count({ where: { warehouseId: w.id } })).toBe(salesBefore);
  });

  it('parallel: qoldiq 5, 10 ta parallel 1 tadan sotuv → aniq 5 tasi o‘tadi, qoldiq 0, manfiy emas', async () => {
    const w = await createViaApi();
    const productId = await newProduct();
    const customerId = await withCommit((db) => createCustomer(db, adminId));
    await receiveViaService(w.id, productId, '5');
    const results = await Promise.allSettled(
      Array.from({ length: 10 }, () =>
        transactions.run(async (tx) => {
          await inventory.decrease(tx, [
            await saleDoc(tx, { warehouseId: w.id, customerId, productId, quantity: '1' }),
          ]);
        }),
      ),
    );
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(5);
    const rejected = results.filter((r): r is PromiseRejectedResult => r.status === 'rejected');
    expect(
      rejected.every((r) => (r.reason as { code?: string }).code === 'INSUFFICIENT_STOCK'),
    ).toBe(true);
    expect(await stockOf(w.id, productId)).toBe('0.000');
  });

  it('nofaol omborga yangi kirim ham, sotuv ham → 422 WAREHOUSE_INACTIVE; qayta faollashtirilsa ishlaydi', async () => {
    const w = await createViaApi();
    const productId = await newProduct();
    const customerId = await withCommit((db) => createCustomer(db, adminId));
    await receiveViaService(w.id, productId, '4');
    await setStatus(w.id, 'INACTIVE');

    await expect(receiveViaService(w.id, productId, '1')).rejects.toMatchObject({
      code: 'WAREHOUSE_INACTIVE',
      status: 422,
    });
    await expect(
      transactions.run(async (tx) => {
        await inventory.decrease(tx, [
          await saleDoc(tx, { warehouseId: w.id, customerId, productId, quantity: '1' }),
        ]);
      }),
    ).rejects.toMatchObject({ code: 'WAREHOUSE_INACTIVE' });
    const sellerCtx: AccessContext = {
      ...contextWithout('warehouses.read_all' as Permission),
      role: 'USER',
      warehouseIds: new Set([w.id]),
    };
    await expect(
      transactions.run((tx) => inventory.assertOperationalWarehouse(tx, sellerCtx, w.id)),
    ).rejects.toMatchObject({ code: 'WAREHOUSE_INACTIVE' });
    await expect(
      transactions.run((tx) => inventory.assertOperationalWarehouse(tx, sellerCtx, warehouseB)),
    ).rejects.toMatchObject({ code: 'WAREHOUSE_ACCESS_DENIED', status: 403 });
    // Qoldiq va tarix o'zgarmagan.
    expect(await stockOf(w.id, productId)).toBe('4.000');
    expect(await t.prisma.inventoryMovement.count({ where: { warehouseId: w.id } })).toBe(1);

    await setStatus(w.id, 'ACTIVE');
    await receiveViaService(w.id, productId, '1');
    expect(await stockOf(w.id, productId)).toBe('5.000');
  });

  it('holat o‘zgarishi davom etayotgan operatsiyani kutadi (FOR SHARE ↔ FOR UPDATE)', async () => {
    const w = await createViaApi();
    const events: string[] = [];
    let release!: () => void;
    const hold = new Promise<void>((resolve) => (release = resolve));
    let locked!: () => void;
    const isLocked = new Promise<void>((resolve) => (locked = resolve));
    const operation = transactions.run(async (tx) => {
      await inventory.assertOperationalWarehouse(
        tx,
        contextWithout('inventory.read' as Permission),
        w.id,
      );
      locked();
      await hold;
      events.push('operation-commit');
    });
    await isLocked;
    const statusChange = setStatus(w.id, 'INACTIVE').then(() => events.push('status-changed'));
    await new Promise((resolve) => setTimeout(resolve, 300));
    expect(events).toEqual([]);
    release();
    await Promise.all([operation, statusChange]);
    expect(events).toEqual(['operation-commit', 'status-changed']);
  });
});

describe('detal, qoldiq, harakatlar va tarix (REQ-042, BR-26)', () => {
  it('ko‘rsatkichlar, qoldiq va harakatlar; nofaol qilish qoldiq va tarixni o‘zgartirmaydi', async () => {
    const w = await createViaApi();
    const p1 = await newProduct({ minStock: '5' });
    const p2 = await newProduct({ minStock: '1' });
    const { incomingId, saleId } = await withCommit(async (db) => {
      const customerId = await createCustomer(db, adminId);
      const { incomingId } = await receive(db, {
        warehouseId: w.id,
        actor: adminId,
        lines: [
          { productId: p1, quantity: '6', price: COST },
          { productId: p2, quantity: '2', price: '1000.00' },
        ],
      });
      const { saleId } = await sell(db, {
        warehouseId: w.id,
        userId: adminId,
        customerId,
        lines: [{ productId: p1, quantity: '2' }],
      });
      return { incomingId, saleId };
    });

    const detail = await api('get', `/warehouses/${w.id}`, adminToken).expect(200);
    expect(detail.body).toMatchObject({
      productCount: 2,
      totalQuantity: '6.000',
      // (4 + 2) × 1 834 567.00 — joriy kelgan narxi bo'yicha
      stockValue: '11007402.00',
      lowStockCount: 1,
      incoming30: '8.000',
      outgoing30: '2.000',
    });

    const stock = await api(
      'get',
      `/warehouses/${w.id}/stock?sort=quantity:desc`,
      adminToken,
    ).expect(200);
    expect(
      stock.body.data.map((r: { productId: string; quantity: string }) => [
        r.productId,
        r.quantity,
      ]),
    ).toEqual([
      [p1, '4.000'],
      [p2, '2.000'],
    ]);
    expect(stock.body.data[0]).toMatchObject({
      minStock: '5.000',
      isLowStock: true,
      costPrice: COST,
      stockValue: '7338268.00',
    });
    const low = await api('get', `/warehouses/${w.id}/stock?stock=low`, adminToken);
    expect(low.body.data.map((r: { productId: string }) => r.productId)).toEqual([p1]);

    const moves = await api('get', `/warehouses/${w.id}/movements`, adminToken).expect(200);
    expect(moves.body.meta.total).toBe(3);
    const sale = moves.body.data.find((m: { movementType: string }) => m.movementType === 'SALE');
    const saleNumber = (await t.prisma.sale.findUniqueOrThrow({ where: { id: saleId } })).number;
    expect(sale).toMatchObject({
      productId: p1,
      quantity: '-2.000',
      balanceAfter: '4.000',
      unitCost: COST,
      referenceType: 'SALE',
      referenceId: saleId,
      referenceNumber: `S-${saleNumber.toString().padStart(6, '0')}`,
      createdBy: { id: adminId },
    });
    const onlyIncoming = await api(
      'get',
      `/warehouses/${w.id}/movements?movementType=INCOMING&productId=${p2}`,
      adminToken,
    );
    expect(onlyIncoming.body.data).toHaveLength(1);
    expect(onlyIncoming.body.data[0].referenceId).toBe(incomingId);
    const global = await api(
      'get',
      `/inventory/movements?warehouseId=${w.id}&referenceType=SALE`,
      adminToken,
    );
    expect(global.body.data.map((m: { referenceId: string }) => m.referenceId)).toEqual([saleId]);
    await api(
      'get',
      `/inventory/movements?dateFrom=2026-10-10&dateTo=2026-10-01`,
      adminToken,
    ).expect(400);

    const ledgerBefore = await t.prisma.inventoryMovement.findMany({
      where: { warehouseId: w.id },
      orderBy: { id: 'asc' },
    });
    await setStatus(w.id, 'INACTIVE');
    const ledgerAfter = await t.prisma.inventoryMovement.findMany({
      where: { warehouseId: w.id },
      orderBy: { id: 'asc' },
    });
    expect(ledgerAfter).toEqual(ledgerBefore);
    const stillThere = await api('get', `/warehouses/${w.id}/stock`, adminToken).expect(200);
    expect(stillThere.body.meta.total).toBe(2);
    expect(await t.prisma.sale.count({ where: { id: saleId } })).toBe(1);
    expect(await t.prisma.incoming.count({ where: { id: incomingId, status: 'CONFIRMED' } })).toBe(
      1,
    );
    // DELETE endpointi yo'q — ombor o'chirilmaydi (tarix FK RESTRICT bilan ham himoyalangan).
    const del = await request(t.app.getHttpServer())
      .delete(`/api/v1/warehouses/${w.id}`)
      .set(bearer(adminToken));
    expect(del.status).toBe(404);
    expect(await t.prisma.warehouse.count({ where: { id: w.id } })).toBe(1);
  });

  it('kelgan narxi: `products.read_cost` bo‘lmasa stockValue/costPrice/unitCost kaliti yo‘q, stockValue bo‘yicha saralash → 400', async () => {
    const w = await createViaApi();
    const p = await newProduct();
    await receiveViaService(w.id, p, '3');
    const service = t.app.get(WarehousesService);
    const ctx = contextWithout('products.read_cost' as Permission);
    const page = { page: 1, pageSize: 20 };

    const detail = await service.get(ctx, w.id);
    expect(detail).not.toHaveProperty('stockValue');
    expect(detail.totalQuantity).toBe('3.000');
    const stock = await service.stock(ctx, w.id, {
      ...page,
      sort: { field: 'productName', direction: 'asc' },
    });
    expect(stock.data[0]).not.toHaveProperty('costPrice');
    expect(stock.data[0]).not.toHaveProperty('stockValue');
    await expect(
      service.stock(ctx, w.id, { ...page, sort: { field: 'stockValue', direction: 'desc' } }),
    ).rejects.toMatchObject({ code: 'VALIDATION_ERROR' });
    const moves = await service.movements(ctx, w.id, {
      ...page,
      sort: { field: 'createdAt', direction: 'desc' },
    });
    expect(moves.data[0]).not.toHaveProperty('unitCost');
    const list = await service.list(ctx, {
      ...page,
      sort: { field: 'name', direction: 'asc' },
      search: w.name,
    });
    expect(list.data[0]).not.toHaveProperty('stockValue');
    expect(JSON.stringify([detail, stock, moves, list])).not.toContain('1834567');
  });
});

describe('reconciliation (REQ-132, AC-23)', () => {
  it('nomuvofiqlikni topadi, audit qiladi; tuzatilgach yo‘qoladi (avtomatik tuzatish yo‘q)', async () => {
    const w = await createViaApi();
    const p = await newProduct();
    await receiveViaService(w.id, p, '6');

    const clean = await api('get', '/inventory/reconciliation', adminToken).expect(200);
    expect(clean.body.pairsChecked).toBeGreaterThan(0);
    expect(clean.body.mismatches.map((m: { warehouseId: string }) => m.warehouseId)).not.toContain(
      w.id,
    );

    // Superuser trigger'larni chetlab, qoldiqni ledger'siz o'zgartiradi ("qo'lda tuzatish" simulyatsiyasi).
    const drift = (quantity: string) =>
      withCommit(async (db) => {
        await db.query(`SET LOCAL session_replication_role = replica`);
        await db.query(
          `UPDATE warehouse_stock SET quantity = $3 WHERE warehouse_id = $1 AND product_id = $2`,
          [w.id, p, quantity],
        );
      });
    await drift('99');
    try {
      const found = await api('get', '/inventory/reconciliation', adminToken).expect(200);
      expect(found.body.mismatchCount).toBeGreaterThanOrEqual(1);
      expect(found.body.mismatches).toContainEqual(
        expect.objectContaining({
          warehouseId: w.id,
          productId: p,
          stockQuantity: '99.000',
          ledgerQuantity: '6.000',
          lastBalanceAfter: '6.000',
        }),
      );
      expect(await stockOf(w.id, p)).toBe('99.000');
    } finally {
      await drift('6');
    }
    const fixed = await api('get', '/inventory/reconciliation', adminToken).expect(200);
    expect(fixed.body.mismatches.map((m: { warehouseId: string }) => m.warehouseId)).not.toContain(
      w.id,
    );

    const runs = await t.prisma.auditLog.findMany({
      where: { action: AuditAction.INVENTORY_RECONCILIATION_RUN, actorId: adminId },
      orderBy: { id: 'asc' },
    });
    expect(runs).toHaveLength(3);
    expect(runs.every((r) => r.entityType === 'INVENTORY')).toBe(true);
    expect(runs.map((r) => (r.metadata as { source: string }).source)).toEqual([
      'api',
      'api',
      'api',
    ]);
    expect((runs[1]!.metadata as { mismatchCount: number }).mismatchCount).toBeGreaterThanOrEqual(
      1,
    );
  });
});

describe('haqiqiy backend: sotuvchi ish jarayoni (aniq biriktirilgan ombor bilan)', () => {
  it('admin ombor yaratadi va sotuvchiga biriktiradi → sotuvchi omborni, qoldiqni va shtrix-kodni ko‘radi; begona ombor yopiq', async () => {
    const w = await createViaApi({ name: `Sinov ombori ${uniqueLogin('s')}`, address: 'Toshkent' });
    const cashier = await createUser(t, { password: PASSWORD });
    await api('put', `/users/${cashier.id}/warehouses`, adminToken)
      .send({ warehouseIds: [w.id] })
      .expect(200);
    const p = await newProduct();
    await receiveViaService(w.id, p, '8');
    const barcodeValue = (await t.prisma.product.findUniqueOrThrow({ where: { id: p } })).barcode!;

    const token = await signIn(cashier.login);
    const me = await api('get', '/auth/me', token).expect(200);
    expect(me.body.warehouseIds).toEqual([w.id]);
    const list = await api('get', '/warehouses', token).expect(200);
    expect(list.body.data).toEqual([expect.objectContaining({ id: w.id, status: 'ACTIVE' })]);
    const lookup = await api(
      'get',
      `/products/lookup?barcode=${barcodeValue}&warehouseId=${w.id}`,
      token,
    ).expect(200);
    expect(lookup.body).toMatchObject({ id: p, stock: '8.000' });
    expect(lookup.body).not.toHaveProperty('costPrice');
    await api(
      'get',
      `/products/lookup?barcode=${barcodeValue}&warehouseId=${warehouseB}`,
      token,
    ).expect(403);
    await api('get', `/warehouses/${w.id}`, token).expect(403);
  });
});

describe('qoldiq hisobi: guruh va mahsulot bo‘yicha (GET /warehouses/:id/stock/summary)', () => {
  it('filtrsiz — butun ombor, guruh/qidiruv/holat bilan — faqat shu qism; birliklar alohida; kelgan narxisiz — stockValue yo‘q', async () => {
    const w = await createViaApi();
    const otherGroup = await withCommit((db) => createGroup(db, adminId));
    const pieces = await newProduct();
    const weighed = await withCommit((db) =>
      createProduct(db, {
        groupId: otherGroup,
        name: 'Hisob-un',
        actor: adminId,
        costPrice: COST,
        salePrice: '2150000.00',
      }),
    );
    await t.prisma.product.update({ where: { id: weighed }, data: { unit: 'KG' } });
    await receiveViaService(w.id, pieces, '10');
    await receiveViaService(w.id, weighed, '2.5');
    const summary = (query: string) =>
      api('get', `/warehouses/${w.id}/stock/summary${query}`, adminToken).expect(200);

    const all = await summary('');
    expect(all.body).toEqual({
      positions: 2,
      lowStockCount: 0,
      quantities: [
        { unit: 'DONA', quantity: '10.000' },
        { unit: 'KG', quantity: '2.500' },
      ],
      stockValue: '22932087.50',
    });
    const byGroup = await summary(`?groupId=${otherGroup}`);
    expect(byGroup.body).toEqual({
      positions: 1,
      lowStockCount: 0,
      quantities: [{ unit: 'KG', quantity: '2.500' }],
      stockValue: '4586417.50',
    });
    const byProduct = await summary('?search=Hisob-un');
    expect(byProduct.body).toEqual(byGroup.body);
    const none = await summary('?search=yoq-mahsulot');
    expect(none.body).toEqual({
      positions: 0,
      lowStockCount: 0,
      quantities: [],
      stockValue: '0.00',
    });

    const noCost = await t.app
      .get(WarehousesService)
      .stockSummary(contextWithout('products.read_cost' as Permission), w.id, {
        page: 1,
        pageSize: 20,
        sort: { field: 'productName', direction: 'asc' },
      });
    expect(noCost).not.toHaveProperty('stockValue');
    expect(noCost.positions).toBe(2);
    await api('get', `/warehouses/${w.id}/stock/summary`, sellerToken).expect(403);
  });
});
