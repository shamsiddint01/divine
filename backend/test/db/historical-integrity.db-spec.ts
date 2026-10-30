import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { closePool, expectPgError, withCommit, withRollback } from './support/db.js';
import { baseContext, createCustomer, createProduct, receive, sell } from './support/fixtures.js';

let ctx: {
  admin: string;
  warehouseId: string;
  groupId: string;
  productId: string;
  customerId: string;
  saleId: string;
  incomingId: string;
  barcode: string;
};

/** Tarix: 10 dona kirim (5 000) va 3 dona sotuv (8 000, tannarx 5 000) — COMMIT qilingan. */
beforeAll(async () => {
  ctx = await withCommit(async (db) => {
    const base = await baseContext(db);
    const barcode = `4781${Date.now()}`;
    const productId = await createProduct(db, {
      groupId: base.groupId,
      actor: base.admin,
      name: 'Samsung A15',
      barcode,
      costPrice: '5000.00',
      salePrice: '8000.00',
    });
    const customerId = await createCustomer(db, base.admin, 'Sardor');
    const { incomingId } = await receive(db, {
      warehouseId: base.warehouseId,
      actor: base.admin,
      lines: [{ productId, quantity: '10' }],
    });
    const { saleId } = await sell(db, {
      warehouseId: base.warehouseId,
      userId: base.admin,
      customerId,
      lines: [{ productId, quantity: '3' }],
    });
    return { ...base, productId, customerId, saleId, incomingId, barcode };
  });
});

afterAll(closePool);

describe('mahsulot arxivlanganda tarix buzilmaydi', () => {
  it('arxiv + qayta nomlash + narx o‘zgarishi: sotuv va kirim tarixi o‘zgarmaydi', async () => {
    await withRollback(async (db) => {
      await db.query(
        `UPDATE products SET status = 'INACTIVE', name = 'Samsung A15 (eski)', cost_price = 9000, sale_price = 12000
          WHERE id = $1`,
        [ctx.productId],
      );

      const {
        rows: [saleItem],
      } = await db.query(
        `SELECT si.product_name, si.barcode, si.unit_price, si.unit_cost, si.line_total, si.line_cost,
                (si.unit_price - si.unit_cost) * si.quantity AS profit,
                p.status AS product_status, p.name AS current_name
           FROM sale_items si JOIN products p ON p.id = si.product_id
          WHERE si.sale_id = $1`,
        [ctx.saleId],
      );
      expect(saleItem).toEqual({
        product_name: 'Samsung A15',
        barcode: ctx.barcode,
        unit_price: '8000.00',
        unit_cost: '5000.00',
        line_total: '24000.00',
        line_cost: '15000.00',
        profit: '9000.00000',
        product_status: 'INACTIVE',
        current_name: 'Samsung A15 (eski)',
      });

      const {
        rows: [incomingItem],
      } = await db.query(
        `SELECT product_name, cost_price, line_total FROM incoming_items WHERE incoming_id = $1`,
        [ctx.incomingId],
      );
      expect(incomingItem).toEqual({
        product_name: 'Samsung A15',
        cost_price: '5000.00',
        line_total: '50000.00',
      });

      const {
        rows: [sale],
      } = await db.query(
        `SELECT total_amount, total_cost, customer_name_snapshot FROM sales WHERE id = $1`,
        [ctx.saleId],
      );
      expect(sale).toEqual({
        total_amount: '24000.00',
        total_cost: '15000.00',
        customer_name_snapshot: 'Sardor',
      });
    });
  });

  it('mijoz ismi o‘zgarsa ham sotuvdagi snapshot o‘zgarmaydi', async () => {
    await withRollback(async (db) => {
      await db.query(`UPDATE customers SET name = 'Sardor Aliyev' WHERE id = $1`, [ctx.customerId]);
      const { rows } = await db.query(`SELECT customer_name_snapshot FROM sales WHERE id = $1`, [
        ctx.saleId,
      ]);
      expect(rows[0]).toEqual({ customer_name_snapshot: 'Sardor' });
    });
  });
});

// ON DELETE RESTRICT → SQLSTATE 23001 (restrict_violation); NO ACTION bo'lganda 23503 bo'lardi.
describe('tarixi bor yozuvlarni o‘chirib bo‘lmaydi (FK RESTRICT)', () => {
  it.each([
    // Mahsulot va omborga bir nechta jadval bog'langan — qaysi FK birinchi tekshirilishi kafolatlanmagan.
    ['mahsulot', 'products', 'productId', undefined],
    ['ombor', 'warehouses', 'warehouseId', undefined],
    ['mijoz', 'customers', 'customerId', 'sales_customer_id_fkey'],
    ['mahsulot guruhi', 'product_groups', 'groupId', 'products_group_id_fkey'],
  ] as const)('%s', async (_label, table, key, constraint) => {
    await withRollback(async (db) => {
      await expectPgError(db, `DELETE FROM ${table} WHERE id = $1`, [ctx[key]], {
        code: '23001',
        ...(constraint ? { constraint } : {}),
      });
    });
  });

  it('user (sotuvchi va hujjat muallifi)', async () => {
    await withRollback(async (db) => {
      await expectPgError(db, `DELETE FROM users WHERE id = $1`, [ctx.admin], { code: '23001' });
    });
  });
});

describe('shtrix-kod unique: arxivlangan mahsulot ham hisobga olinadi (D-09)', () => {
  it('arxivlangan mahsulotning shtrix-kodi yangi mahsulotga berilmaydi', async () => {
    await withRollback(async (db) => {
      await db.query(`UPDATE products SET status = 'INACTIVE' WHERE id = $1`, [ctx.productId]);
      await expectPgError(
        db,
        `INSERT INTO products (name, group_id, barcode, cost_price, sale_price, created_by)
         VALUES ('Yangi', $1, $2, 1, 1, $3)`,
        [ctx.groupId, ctx.barcode, ctx.admin],
        { code: '23505', constraint: 'products_barcode_key' },
      );
    });
  });

  it('arxivlangan mahsulot qayta faollashtirilishi mumkin (shtrix-kod to‘qnashuvi yo‘q)', async () => {
    await withRollback(async (db) => {
      await db.query(`UPDATE products SET status = 'INACTIVE' WHERE id = $1`, [ctx.productId]);
      await db.query(`UPDATE products SET status = 'ACTIVE' WHERE id = $1`, [ctx.productId]);
      const { rows } = await db.query(`SELECT status FROM products WHERE id = $1`, [ctx.productId]);
      expect(rows[0]).toEqual({ status: 'ACTIVE' });
    });
  });
});
