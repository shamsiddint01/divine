import { afterAll, describe, expect, it } from 'vitest';
import {
  CHECK_DEFERRED,
  closePool,
  expectPgError,
  getPool,
  withCommit,
  withRollback,
  type Db,
} from './support/db.js';
import {
  InsufficientStockError,
  baseContext,
  changeStock,
  createCustomer,
  createDraftIncoming,
  createProduct,
  receive,
  sell,
} from './support/fixtures.js';

afterAll(closePool);

async function stockOf(
  db: Db,
  warehouseId: string,
  productId: string,
): Promise<string | undefined> {
  const { rows } = await db.query<{ quantity: string }>(
    `SELECT quantity FROM warehouse_stock WHERE warehouse_id = $1 AND product_id = $2`,
    [warehouseId, productId],
  );
  return rows[0]?.quantity;
}

async function driftFor(db: Db, warehouseId: string) {
  const stock = await db.query(`SELECT * FROM reconcile_inventory_stock WHERE warehouse_id = $1`, [
    warehouseId,
  ]);
  const docs = await db.query(
    `SELECT * FROM reconcile_document_movements WHERE warehouse_id = $1`,
    [warehouseId],
  );
  return { stock: stock.rows, documents: docs.rows };
}

describe('kirim → stock → ledger (TZ §7 misoli)', () => {
  it('Telefon 50 + Naushnik 30 + Kabel 100 + Sichqoncha 20 = 200; har biri ledger bilan', async () => {
    await withRollback(async (db) => {
      const { admin, warehouseId, groupId } = await baseContext(db);
      const lines = [
        ['Telefon', '50'],
        ['Naushnik', '30'],
        ['Kabel', '100'],
        ['Sichqoncha', '20'],
      ] as const;
      const products: string[] = [];
      for (const [name] of lines)
        products.push(await createProduct(db, { groupId, actor: admin, name }));

      const { incomingId } = await receive(db, {
        warehouseId,
        actor: admin,
        lines: lines.map(([, quantity], i) => ({ productId: products[i]!, quantity })),
      });
      await db.query(CHECK_DEFERRED);

      const {
        rows: [doc],
      } = await db.query<{ status: string; total_quantity: string }>(
        `SELECT status, total_quantity FROM incoming WHERE id = $1`,
        [incomingId],
      );
      expect(doc).toEqual({ status: 'CONFIRMED', total_quantity: '200.000' });

      for (const [i, [, quantity]] of lines.entries()) {
        expect(await stockOf(db, warehouseId, products[i]!)).toBe(`${quantity}.000`);
      }
      const { rows: moves } = await db.query<{
        movement_type: string;
        quantity: string;
        balance_after: string;
      }>(
        `SELECT movement_type, quantity, balance_after FROM inventory_movements WHERE reference_id = $1`,
        [incomingId],
      );
      expect(moves).toHaveLength(4);
      expect(
        moves.every((m) => m.movement_type === 'INCOMING' && m.quantity === m.balance_after),
      ).toBe(true);
      expect(await driftFor(db, warehouseId)).toEqual({ stock: [], documents: [] });
    });
  });

  it('totallar qatorlar yig‘indisiga mos bo‘lmasa tasdiqlanmaydi; bo‘sh kirim tasdiqlanmaydi', async () => {
    await withRollback(async (db) => {
      const { admin, warehouseId, groupId } = await baseContext(db);
      const productId = await createProduct(db, { groupId, actor: admin });
      const { incomingId } = await createDraftIncoming(db, {
        warehouseId,
        actor: admin,
        lines: [{ productId, quantity: '50' }],
      });
      await db.query(`UPDATE incoming SET total_quantity = 199 WHERE id = $1`, [incomingId]);
      const confirm = `UPDATE incoming SET status = 'CONFIRMED', confirmed_by = $2, confirmed_at = now() WHERE id = $1`;
      await expectPgError(db, confirm, [incomingId, admin], { code: 'DV004', message: /mos emas/ });

      const empty = await createDraftIncoming(db, { warehouseId, actor: admin, lines: [] });
      await expectPgError(db, confirm, [empty.incomingId, admin], {
        code: 'DV004',
        message: /Bo'sh|Bo‘sh/,
      });
    });
  });

  it('tasdiqlangan kirim uchun ledger yozilmasa — COMMIT rad etiladi', async () => {
    await withRollback(async (db) => {
      const { admin, warehouseId, groupId } = await baseContext(db);
      const productId = await createProduct(db, { groupId, actor: admin });
      const { incomingId } = await createDraftIncoming(db, {
        warehouseId,
        actor: admin,
        lines: [{ productId, quantity: '5' }],
      });
      await db.query(
        `UPDATE incoming SET status = 'CONFIRMED', confirmed_by = $2, confirmed_at = now() WHERE id = $1`,
        [incomingId, admin],
      );
      await expectPgError(db, CHECK_DEFERRED, [], { code: 'DV003', message: /ombor harakati/ });
    });
  });

  it('DRAFT kirim qatoriga ledger yozib bo‘lmaydi (stock faqat tasdiqlashda oshadi)', async () => {
    await withRollback(async (db) => {
      const { admin, warehouseId, groupId } = await baseContext(db);
      const productId = await createProduct(db, { groupId, actor: admin });
      const { incomingId, itemIds } = await createDraftIncoming(db, {
        warehouseId,
        actor: admin,
        lines: [{ productId, quantity: '5' }],
      });
      await changeStock(db, warehouseId, productId, '5');
      await expectPgError(
        db,
        `INSERT INTO inventory_movements (warehouse_id, product_id, movement_type, quantity, balance_after,
           unit_cost, reference_type, reference_id, reference_item_id, created_by)
         VALUES ($1, $2, 'INCOMING', 5, 5, 1000, 'INCOMING', $3, $4, $5)`,
        [warehouseId, productId, incomingId, itemIds[0], admin],
        { code: 'DV003' },
      );
    });
  });
});

describe('ledger invariantlari (DB darajasida)', () => {
  const insertMovement = `INSERT INTO inventory_movements (warehouse_id, product_id, movement_type, quantity,
      balance_after, unit_cost, reference_type, reference_id, reference_item_id, created_by)
    VALUES ($1, $2, $3, $4, $5, $6, 'INCOMING', $7, $8, $9)`;

  async function confirmedDraft(db: Db) {
    const ctx = await baseContext(db);
    const productId = await createProduct(db, {
      groupId: ctx.groupId,
      actor: ctx.admin,
      costPrice: '1000.00',
    });
    const { incomingId, itemIds } = await createDraftIncoming(db, {
      warehouseId: ctx.warehouseId,
      actor: ctx.admin,
      lines: [{ productId, quantity: '5' }],
    });
    await db.query(
      `UPDATE incoming SET status = 'CONFIRMED', confirmed_by = $2, confirmed_at = now() WHERE id = $1`,
      [incomingId, ctx.admin],
    );
    return { ...ctx, productId, incomingId, itemId: itemIds[0]! };
  }

  it('stock o‘zgarmasdan ledger yozilsa — rad etiladi (INV-3)', async () => {
    await withRollback(async (db) => {
      const c = await confirmedDraft(db);
      await expectPgError(
        db,
        insertMovement,
        [
          c.warehouseId,
          c.productId,
          'INCOMING',
          '5',
          '5',
          '1000.00',
          c.incomingId,
          c.itemId,
          c.admin,
        ],
        { code: 'DV003', message: /joriy qoldiqqa/ },
      );
    });
  });

  it('noto‘g‘ri balance_after — rad etiladi (ledger zanjiri)', async () => {
    await withRollback(async (db) => {
      const c = await confirmedDraft(db);
      await changeStock(db, c.warehouseId, c.productId, '5');
      await expectPgError(
        db,
        insertMovement,
        [
          c.warehouseId,
          c.productId,
          'INCOMING',
          '5',
          '6',
          '1000.00',
          c.incomingId,
          c.itemId,
          c.admin,
        ],
        { code: 'DV003', message: /balance_after/ },
      );
    });
  });

  it('hujjat qatoriga mos kelmaydigan harakat (miqdor/mahsulot/tannarx) — rad etiladi (INV-4)', async () => {
    await withRollback(async (db) => {
      const c = await confirmedDraft(db);
      const other = await createProduct(db, { groupId: c.groupId, actor: c.admin });
      await changeStock(db, c.warehouseId, c.productId, '4');
      await expectPgError(
        db,
        insertMovement,
        [
          c.warehouseId,
          c.productId,
          'INCOMING',
          '4',
          '4',
          '1000.00',
          c.incomingId,
          c.itemId,
          c.admin,
        ],
        { code: 'DV003', message: /mos emas/ },
      );
      await expectPgError(
        db,
        insertMovement,
        [c.warehouseId, other, 'INCOMING', '5', '5', '1000.00', c.incomingId, c.itemId, c.admin],
        { code: 'DV003' },
      );
      await expectPgError(
        db,
        insertMovement,
        [c.warehouseId, c.productId, 'INCOMING', '4', '4', '1.00', c.incomingId, c.itemId, c.admin],
        { code: 'DV003' },
      );
    });
  });

  it('bitta hujjat qatori ikki marta post qilinmaydi (idempotency, INV-4)', async () => {
    await withRollback(async (db) => {
      const c = await confirmedDraft(db);
      await changeStock(db, c.warehouseId, c.productId, '5');
      await db.query(insertMovement, [
        c.warehouseId,
        c.productId,
        'INCOMING',
        '5',
        '5',
        '1000.00',
        c.incomingId,
        c.itemId,
        c.admin,
      ]);
      await changeStock(db, c.warehouseId, c.productId, '5');
      await expectPgError(
        db,
        insertMovement,
        [
          c.warehouseId,
          c.productId,
          'INCOMING',
          '5',
          '10',
          '1000.00',
          c.incomingId,
          c.itemId,
          c.admin,
        ],
        { code: '23505', constraint: 'inventory_movements_reference_type_reference_item_id_key' },
      );
    });
  });

  it('zaxira harakat turlari (ADJUSTMENT/RETURN/TRANSFER) hozircha rad etiladi (D-03)', async () => {
    await withRollback(async (db) => {
      const c = await confirmedDraft(db);
      await changeStock(db, c.warehouseId, c.productId, '5');
      await expectPgError(
        db,
        insertMovement,
        [c.warehouseId, c.productId, 'ADJUSTMENT', '5', '5', null, c.incomingId, c.itemId, c.admin],
        { code: 'DV003', message: /D-03/ },
      );
    });
  });

  it('ledger‘siz stock o‘zgarishi tranzaksiya yakunida rad etiladi (INV-1)', async () => {
    await withRollback(async (db) => {
      const { admin, warehouseId, groupId } = await baseContext(db);
      const productId = await createProduct(db, { groupId, actor: admin });
      await changeStock(db, warehouseId, productId, '100');
      await expectPgError(db, CHECK_DEFERRED, [], { code: 'DV003', message: /ledger balansiga/ });
    });
  });

  it('kirim harakati manfiy, sotuv harakati musbat bo‘la olmaydi (INV-6)', async () => {
    await withRollback(async (db) => {
      const c = await confirmedDraft(db);
      // Trigger CHECK'dan oldin ishlaydi va DV003 beradi; CHECK mustaqil himoya ekanini
      // trigger'lar o'chirilgan holatda (superuser replica rejimi) tekshiramiz.
      await db.query(`SET LOCAL session_replication_role = replica`);
      await expectPgError(
        db,
        insertMovement,
        [c.warehouseId, c.productId, 'INCOMING', '-5', '0', null, c.incomingId, c.itemId, c.admin],
        { code: '23514', constraint: 'inventory_movements_direction' },
      );
    });
  });
});

describe('sotuv → stock ↓ → ledger', () => {
  it('sotuv qoldiqni kamaytiradi, narx va tannarx snapshot qilinadi, foyda = (narx − tannarx) × miqdor', async () => {
    await withRollback(async (db) => {
      const { admin, warehouseId, groupId } = await baseContext(db);
      const productId = await createProduct(db, {
        groupId,
        actor: admin,
        costPrice: '7000.00',
        salePrice: '10000.00',
      });
      const customerId = await createCustomer(db, admin);
      await receive(db, { warehouseId, actor: admin, lines: [{ productId, quantity: '10' }] });
      const { saleId } = await sell(db, {
        warehouseId,
        userId: admin,
        customerId,
        lines: [{ productId, quantity: '3' }],
      });
      await db.query(CHECK_DEFERRED);

      expect(await stockOf(db, warehouseId, productId)).toBe('7.000');
      const {
        rows: [item],
      } = await db.query(
        `SELECT unit_price, unit_cost, line_total, line_cost, line_total - line_cost AS profit
           FROM sale_items WHERE sale_id = $1`,
        [saleId],
      );
      expect(item).toEqual({
        unit_price: '10000.00',
        unit_cost: '7000.00',
        line_total: '30000.00',
        line_cost: '21000.00',
        profit: '9000.00',
      });
      const {
        rows: [move],
      } = await db.query(
        `SELECT movement_type, quantity, balance_after, unit_cost FROM inventory_movements
          WHERE reference_type = 'SALE' AND reference_id = $1`,
        [saleId],
      );
      expect(move).toEqual({
        movement_type: 'SALE',
        quantity: '-3.000',
        balance_after: '7.000',
        unit_cost: '7000.00',
      });
      expect(await driftFor(db, warehouseId)).toEqual({ stock: [], documents: [] });
    });
  });

  it('qoldiqdan ko‘p sotib bo‘lmaydi: shartli UPDATE 0 qator, to‘g‘ridan UPDATE esa CHECK bilan rad etiladi', async () => {
    await withRollback(async (db) => {
      const { admin, warehouseId, groupId } = await baseContext(db);
      const productId = await createProduct(db, { groupId, actor: admin });
      const customerId = await createCustomer(db, admin);
      await receive(db, { warehouseId, actor: admin, lines: [{ productId, quantity: '2' }] });
      await db.query('SAVEPOINT oversell');
      await expect(
        sell(db, { warehouseId, userId: admin, customerId, lines: [{ productId, quantity: '3' }] }),
      ).rejects.toBeInstanceOf(InsufficientStockError);
      await db.query('ROLLBACK TO SAVEPOINT oversell');
      await expectPgError(
        db,
        `UPDATE warehouse_stock SET quantity = quantity - 3 WHERE warehouse_id = $1 AND product_id = $2`,
        [warehouseId, productId],
        { code: '23514', constraint: 'warehouse_stock_quantity_non_negative' },
      );
      expect(await stockOf(db, warehouseId, productId)).toBe('2.000');
    });
  });

  it('sotuv totallari mos bo‘lmasa, qatorsiz yoki ledger‘siz bo‘lsa — COMMIT rad etiladi', async () => {
    await withRollback(async (db) => {
      const { admin, warehouseId, groupId } = await baseContext(db);
      const productId = await createProduct(db, { groupId, actor: admin });
      const customerId = await createCustomer(db, admin);
      const insertSale = `INSERT INTO sales (user_id, warehouse_id, customer_id, customer_name_snapshot,
          total_quantity, total_amount, total_cost, idempotency_key, request_hash)
        VALUES ($1, $2, $3, 'Mijoz', $4, $5, $6, uuidv7(), repeat('c', 64)) RETURNING id`;

      await db.query('SAVEPOINT s1');
      await db.query(insertSale, [admin, warehouseId, customerId, '1', '1500.00', '1000.00']);
      await expectPgError(db, CHECK_DEFERRED, [], { code: 'DV004', message: /kamida bitta/ });
      await db.query('ROLLBACK TO SAVEPOINT s1');

      const {
        rows: [sale],
      } = await db.query<{ id: string }>(insertSale, [
        admin,
        warehouseId,
        customerId,
        '2',
        '1500.00',
        '1000.00',
      ]);
      await db.query(
        `INSERT INTO sale_items (sale_id, product_id, product_name, quantity, unit_price, unit_cost)
         VALUES ($1, $2, 'X', 1, 1500, 1000)`,
        [sale!.id, productId],
      );
      await expectPgError(db, CHECK_DEFERRED, [], { code: 'DV004', message: /totallari/ });
    });
  });

  it('yakunlangan sotuvga keyinroq qator qo‘shib bo‘lmaydi', async () => {
    const saleId = await withCommit(async (db) => {
      const { admin, warehouseId, groupId } = await baseContext(db);
      const productId = await createProduct(db, { groupId, actor: admin });
      const customerId = await createCustomer(db, admin);
      await receive(db, { warehouseId, actor: admin, lines: [{ productId, quantity: '5' }] });
      return (
        await sell(db, {
          warehouseId,
          userId: admin,
          customerId,
          lines: [{ productId, quantity: '1' }],
        })
      ).saleId;
    });
    await withRollback(async (db) => {
      const { admin, groupId } = await baseContext(db);
      const other = await createProduct(db, { groupId, actor: admin });
      await db.query(
        `INSERT INTO sale_items (sale_id, product_id, product_name, quantity, unit_price, unit_cost)
         VALUES ($1, $2, 'Qo‘shimcha', 1, 1, 1)`,
        [saleId, other],
      );
      await expectPgError(db, CHECK_DEFERRED, [], { code: 'DV004' });
    });
  });
});

describe('sotilgan miqdor yig‘masi — warehouse_sales_totals (Phase 17, REQ-167)', () => {
  const totals = async (db: Db, warehouseId: string) =>
    (
      await db.query<{ product_id: string; quantity: string }>(
        `SELECT product_id, quantity FROM warehouse_sales_totals WHERE warehouse_id = $1 ORDER BY product_id`,
        [warehouseId],
      )
    ).rows;

  it('har bir sotuv ledger SALE harakati orqali yig‘mani oshiradi; sale_items yig‘indisiga teng; reconcile_sales_totals bo‘sh', async () => {
    await withRollback(async (db) => {
      const { admin, warehouseId, groupId } = await baseContext(db);
      const a = await createProduct(db, { groupId, actor: admin });
      const b = await createProduct(db, { groupId, actor: admin });
      const customerId = await createCustomer(db, admin);
      await receive(db, {
        warehouseId,
        actor: admin,
        lines: [
          { productId: a, quantity: '10' },
          { productId: b, quantity: '10' },
        ],
      });
      expect(await totals(db, warehouseId)).toEqual([]); // kirim sotuv emas
      await sell(db, { warehouseId, userId: admin, customerId, lines: [{ productId: a, quantity: '3' }] });
      await sell(db, {
        warehouseId,
        userId: admin,
        customerId,
        lines: [
          { productId: a, quantity: '1' },
          { productId: b, quantity: '2' },
        ],
      });
      await db.query(CHECK_DEFERRED);
      expect(await totals(db, warehouseId)).toEqual(
        [
          { product_id: a, quantity: '4.000' },
          { product_id: b, quantity: '2.000' },
        ].sort((x, y) => x.product_id.localeCompare(y.product_id)),
      );
      const { rows } = await db.query(`SELECT * FROM reconcile_sales_totals`);
      expect(rows).toEqual([]);
    });
  });

  it('ilova roli yig‘mani to‘g‘ridan-to‘g‘ri o‘zgartira olmaydi (faqat trigger), lekin sotuv uni yangilaydi', async () => {
    await withRollback(async (db) => {
      const { admin, warehouseId, groupId } = await baseContext(db);
      const productId = await createProduct(db, { groupId, actor: admin });
      const customerId = await createCustomer(db, admin);
      await receive(db, { warehouseId, actor: admin, lines: [{ productId, quantity: '5' }] });
      await db.query('SET LOCAL ROLE divine_app');
      await sell(db, { warehouseId, userId: admin, customerId, lines: [{ productId, quantity: '2' }] });
      expect(await totals(db, warehouseId)).toEqual([{ product_id: productId, quantity: '2.000' }]);
      await expectPgError(db, `UPDATE warehouse_sales_totals SET quantity = 999`, [], { code: '42501' });
      await expectPgError(
        db,
        `INSERT INTO warehouse_sales_totals (warehouse_id, product_id, quantity) VALUES ($1, $2, 1)`,
        [warehouseId, productId],
        { code: '42501' },
      );
    });
  });
});

describe('parallel sotuvlar (REQ-161, BR-07)', () => {
  it('10 dona qoldiqqa 20 ta parallel 1 donalik sotuvdan aynan 10 tasi o‘tadi, qoldiq 0', async () => {
    const ctx = await withCommit(async (db) => {
      const base = await baseContext(db);
      const productId = await createProduct(db, { groupId: base.groupId, actor: base.admin });
      const customerId = await createCustomer(db, base.admin);
      await receive(db, {
        warehouseId: base.warehouseId,
        actor: base.admin,
        lines: [{ productId, quantity: '10' }],
      });
      return { ...base, productId, customerId };
    });

    const attempts = await Promise.allSettled(
      Array.from({ length: 20 }, () =>
        withCommit((db) =>
          sell(db, {
            warehouseId: ctx.warehouseId,
            userId: ctx.admin,
            customerId: ctx.customerId,
            lines: [{ productId: ctx.productId, quantity: '1' }],
          }),
        ),
      ),
    );
    const ok = attempts.filter((a) => a.status === 'fulfilled').length;
    const rejected = attempts.filter((a) => a.status === 'rejected');
    expect(ok).toBe(10);
    expect(
      rejected.every((r) => r.status === 'rejected' && r.reason instanceof InsufficientStockError),
    ).toBe(true);

    const db = await getPool().connect();
    try {
      expect(await stockOf(db, ctx.warehouseId, ctx.productId)).toBe('0.000');
      const {
        rows: [ledger],
      } = await db.query<{ n: string; total: string; min_balance: string }>(
        `SELECT count(*) AS n, sum(quantity) AS total, min(balance_after) AS min_balance
           FROM inventory_movements WHERE warehouse_id = $1 AND product_id = $2`,
        [ctx.warehouseId, ctx.productId],
      );
      expect(ledger).toEqual({ n: '11', total: '0.000', min_balance: '0.000' });
      expect(await driftFor(db, ctx.warehouseId)).toEqual({ stock: [], documents: [] });
    } finally {
      db.release();
    }
  });
});

describe('reconciliation view‘lari (DATABASE.md §5.4)', () => {
  it('trigger‘lar chetlab o‘tilgan buzilishni aniqlaydi', async () => {
    await withRollback(async (db) => {
      const { admin, warehouseId, groupId } = await baseContext(db);
      const productId = await createProduct(db, { groupId, actor: admin });
      const customerId = await createCustomer(db, admin);
      await receive(db, { warehouseId, actor: admin, lines: [{ productId, quantity: '10' }] });
      await sell(db, {
        warehouseId,
        userId: admin,
        customerId,
        lines: [{ productId, quantity: '4' }],
      });
      expect(await driftFor(db, warehouseId)).toEqual({ stock: [], documents: [] });

      // Superuser trigger'larni o'chirib, stock'ni ledger'siz o'zgartiradi (masalan, qo'lda "tuzatish").
      await db.query(`SET LOCAL session_replication_role = replica`);
      await db.query(
        `UPDATE warehouse_stock SET quantity = 99 WHERE warehouse_id = $1 AND product_id = $2`,
        [warehouseId, productId],
      );
      await db.query(`UPDATE customers SET purchase_count = 5 WHERE id = $1`, [customerId]);
      await db.query(`SET LOCAL session_replication_role = origin`);

      const drift = await driftFor(db, warehouseId);
      expect(drift.stock).toEqual([
        {
          warehouse_id: warehouseId,
          product_id: productId,
          stock_quantity: '99.000',
          ledger_quantity: '6.000',
          last_balance_after: '6.000',
        },
      ]);
      const { rows: customers } = await db.query(
        `SELECT customer_id, stored_purchase_count, actual_purchase_count
           FROM reconcile_customer_aggregates WHERE customer_id = $1`,
        [customerId],
      );
      expect(customers).toEqual([
        { customer_id: customerId, stored_purchase_count: 5, actual_purchase_count: 1 },
      ]);
    });
  });
});
