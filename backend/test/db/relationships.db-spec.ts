import { PrismaPg } from '@prisma/adapter-pg';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import { pgPoolConfig } from '../../src/database/pg-connection.js';
import { Prisma, PrismaClient } from '../../src/generated/prisma/client.js';
import { FAKE_PASSWORD_HASH } from './support/fixtures.js';

/**
 * Relationlar Prisma Client orqali (keyingi phase'lardagi repository qatlami aynan shu API'ni ishlatadi).
 * Har bir test interaktiv tranzaksiyada bajariladi va oxirida ataylab ROLLBACK qilinadi.
 */
let prisma: PrismaClient;

class Rollback extends Error {}

async function inRollback(fn: (tx: Prisma.TransactionClient) => Promise<void>): Promise<void> {
  await expect(
    prisma.$transaction(async (tx) => {
      await fn(tx);
      throw new Rollback();
    }),
  ).rejects.toBeInstanceOf(Rollback);
}

let seq = 0;
const suffix = () => `${Date.now().toString(36)}${(seq++).toString(36)}`;

async function admin(tx: Prisma.TransactionClient) {
  return tx.user.create({
    data: {
      login: `admin${suffix()}`,
      passwordHash: FAKE_PASSWORD_HASH,
      role: { connect: { code: 'ADMIN' } },
    },
  });
}

beforeAll(() => {
  prisma = new PrismaClient({ adapter: new PrismaPg(pgPoolConfig(inject('databaseUrl'))) });
});

afterAll(async () => {
  await prisma.$disconnect();
});

describe('relationlar (Prisma)', () => {
  it('role ↔ permissions (seed) va user → role', async () => {
    await inRollback(async (tx) => {
      const user = await tx.user.create({
        data: {
          login: `kassir${suffix()}`,
          passwordHash: FAKE_PASSWORD_HASH,
          role: { connect: { code: 'USER' } },
        },
        include: { role: { include: { permissions: { include: { permission: true } } } } },
      });
      expect(user.role.code).toBe('USER');
      expect(user.role.permissions.map((rp) => rp.permission.code)).toContain('sales.create');
      expect(user.role.permissions.map((rp) => rp.permission.code)).not.toContain('reports.read');
    });
  });

  it('user ↔ warehouses (many-to-many, D-04); takroriy biriktirish P2002', async () => {
    await inRollback(async (tx) => {
      const a = await admin(tx);
      const [w1, w2] = await Promise.all(
        ['Chilonzor', 'Yunusobod'].map((name) =>
          tx.warehouse.create({ data: { name: `${name} ${suffix()}`, createdById: a.id } }),
        ),
      );
      const user = await tx.user.create({
        data: {
          login: `sotuvchi${suffix()}`,
          passwordHash: FAKE_PASSWORD_HASH,
          role: { connect: { code: 'USER' } },
          createdBy: { connect: { id: a.id } },
          warehouses: {
            create: [
              { warehouseId: w1!.id, createdById: a.id },
              { warehouseId: w2!.id, createdById: a.id },
            ],
          },
        },
        include: { warehouses: { include: { warehouse: true } }, createdBy: true },
      });
      expect(user.warehouses.map((uw) => uw.warehouse.id).sort()).toEqual([w1!.id, w2!.id].sort());
      expect(user.createdBy?.id).toBe(a.id);

      const wh = await tx.warehouse.findUniqueOrThrow({
        where: { id: w1!.id },
        include: { users: true },
      });
      expect(wh.users.map((u) => u.userId)).toEqual([user.id]);
    });

    await expect(
      prisma.$transaction(async (tx) => {
        const a = await admin(tx);
        const w = await tx.warehouse.create({
          data: { name: `Dup ${suffix()}`, createdById: a.id },
        });
        await tx.userWarehouse.create({
          data: { userId: a.id, warehouseId: w.id, createdById: a.id },
        });
        await tx.userWarehouse.create({
          data: { userId: a.id, warehouseId: w.id, createdById: a.id },
        });
      }),
    ).rejects.toMatchObject({ code: 'P2002' });
  });

  it('product → group, stock → warehouse/product, incoming → warehouse/items', async () => {
    await inRollback(async (tx) => {
      const a = await admin(tx);
      const group = await tx.productGroup.create({
        data: { name: `Telefonlar ${suffix()}`, createdById: a.id },
      });
      const wh = await tx.warehouse.create({
        data: { name: `Asosiy ${suffix()}`, createdById: a.id },
      });
      const product = await tx.product.create({
        data: {
          name: 'iPhone 15',
          groupId: group.id,
          barcode: `479${suffix()}`,
          costPrice: '9000000.00',
          salePrice: '11500000.00',
          createdById: a.id,
        },
        include: { group: true },
      });
      expect(product.group.id).toBe(group.id);
      // Pul qiymatlari Decimal sifatida, aniqlik yo'qolmasdan (API qatlami string qaytaradi).
      expect(product.salePrice!.toFixed(2)).toBe('11500000.00');

      const incoming = await tx.incoming.create({
        data: {
          incomingDate: new Date('2026-10-08'),
          warehouseId: wh.id,
          createdById: a.id,
          items: {
            create: [
              {
                productId: product.id,
                productName: product.name,
                barcode: product.barcode,
                quantity: '2',
                costPrice: '9000000.00',
              },
            ],
          },
        },
        include: { warehouse: true, items: { include: { product: true } } },
      });
      expect(incoming.warehouse.id).toBe(wh.id);
      expect(incoming.status).toBe('DRAFT');
      expect(incoming.items).toHaveLength(1);
      // GENERATED ustun: DB hisoblagan.
      expect(incoming.items[0]!.lineTotal.toFixed(2)).toBe('18000000.00');
      expect(incoming.number).toBeTypeOf('bigint');

      await tx.warehouseStock.create({
        data: { warehouseId: wh.id, productId: product.id, quantity: '0' },
      });
      const stock = await tx.warehouseStock.findUniqueOrThrow({
        where: { warehouseId_productId: { warehouseId: wh.id, productId: product.id } },
        include: { warehouse: true, product: true },
      });
      expect([stock.warehouse.id, stock.product.id]).toEqual([wh.id, product.id]);
    });
  });

  it('sale → customer / user / items (snapshot bilan)', async () => {
    await inRollback(async (tx) => {
      const a = await admin(tx);
      const group = await tx.productGroup.create({
        data: { name: `G ${suffix()}`, createdById: a.id },
      });
      const wh = await tx.warehouse.create({ data: { name: `W ${suffix()}`, createdById: a.id } });
      const product = await tx.product.create({
        data: {
          name: 'Kabel',
          groupId: group.id,
          costPrice: '15000',
          salePrice: '25000',
          createdById: a.id,
        },
      });
      const customer = await tx.customer.create({ data: { name: 'Dilnoza', createdById: a.id } });
      const sale = await tx.sale.create({
        data: {
          userId: a.id,
          warehouseId: wh.id,
          customerId: customer.id,
          customerNameSnapshot: customer.name,
          totalQuantity: '2',
          totalAmount: '50000.00',
          totalCost: '30000.00',
          idempotencyKey: '01928c5e-0000-7000-8000-00000000abcd',
          requestHash: 'd'.repeat(64),
          items: {
            create: [
              {
                productId: product.id,
                productName: product.name,
                quantity: '2',
                unitPrice: '25000',
                unitCost: '15000',
              },
            ],
          },
        },
        include: { customer: true, user: true, warehouse: true, items: true },
      });
      expect(sale.customer.name).toBe('Dilnoza');
      expect(sale.user.id).toBe(a.id);
      expect(sale.status).toBe('COMPLETED');
      expect(sale.items[0]!.lineTotal.toFixed(2)).toBe('50000.00');
      expect(sale.items[0]!.lineCost.toFixed(2)).toBe('30000.00');

      const history = await tx.customer.findUniqueOrThrow({
        where: { id: customer.id },
        include: { sales: { include: { items: true } } },
      });
      expect(history.sales.map((s) => s.id)).toEqual([sale.id]);
    });
  });

  it('audit → actor (NULL = tizim)', async () => {
    await inRollback(async (tx) => {
      const a = await admin(tx);
      await tx.auditLog.create({
        data: {
          actorId: a.id,
          action: 'USER_CREATED',
          entityType: 'USER',
          entityId: a.id,
          metadata: { login: a.login },
        },
      });
      await tx.auditLog.create({
        data: {
          action: 'AUTH_LOGIN_FAILED',
          entityType: 'SESSION',
          metadata: { reason: 'INVALID_CREDENTIALS' },
        },
      });
      const logs = await tx.auditLog.findMany({
        where: { OR: [{ actorId: a.id }, { action: 'AUTH_LOGIN_FAILED', actorId: null }] },
        include: { actor: true },
        orderBy: { id: 'asc' },
      });
      expect(logs.map((l) => l.actor?.id ?? null).slice(-2)).toEqual([a.id, null]);
      const actorLogs = await tx.user.findUniqueOrThrow({
        where: { id: a.id },
        include: { auditLogs: true },
      });
      expect(actorLogs.auditLogs).toHaveLength(1);
    });
  });

  it('expense → category (majburiy, D-19); holat maydoni yo‘q (D-11)', async () => {
    await inRollback(async (tx) => {
      const a = await admin(tx);
      const category = await tx.expenseCategory.create({
        data: { name: `Ijara ${suffix()}`, createdById: a.id },
      });
      const expense = await tx.expense.create({
        data: {
          expenseDate: new Date('2026-10-08'),
          amount: '3500000.00',
          categoryId: category.id,
          createdById: a.id,
        },
        include: { category: true, createdBy: true },
      });
      expect(expense.category.id).toBe(category.id);
      expect(expense).not.toHaveProperty('status');
      expect(expense.createdBy.id).toBe(a.id);
    });
  });
});
