import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { closePool, expectPgError, withCommit, withRollback } from './support/db.js';
import {
  baseContext,
  confirmIncoming,
  createCustomer,
  createDraftIncoming,
  createProduct,
  receive,
  sell,
} from './support/fixtures.js';

/** COMMIT qilingan haqiqiy tarix: audit yozuvi, kirim va sotuv (ledger bilan). */
let fixture: {
  auditId: string;
  movementId: string;
  saleId: string;
  saleItemId: string;
  incomingId: string;
  incomingItemId: string;
};

beforeAll(async () => {
  fixture = await withCommit(async (db) => {
    const { admin, warehouseId, groupId } = await baseContext(db);
    const productId = await createProduct(db, { groupId, actor: admin });
    const customerId = await createCustomer(db, admin);
    const incoming = await receive(db, {
      warehouseId,
      actor: admin,
      lines: [{ productId, quantity: '10' }],
    });
    const sale = await sell(db, {
      warehouseId,
      userId: admin,
      customerId,
      lines: [{ productId, quantity: '2' }],
    });
    const {
      rows: [audit],
    } = await db.query<{ id: string }>(
      `INSERT INTO audit_logs (actor_id, action, entity_type, entity_id, metadata, request_id)
       VALUES ($1, 'SALE_CREATED', 'SALE', $2, '{"total":"3000.00"}', 'req-1') RETURNING id`,
      [admin, sale.saleId],
    );
    const {
      rows: [movement],
    } = await db.query<{ id: string }>(
      `SELECT id FROM inventory_movements WHERE reference_id = $1`,
      [sale.saleId],
    );
    return {
      auditId: audit!.id,
      movementId: movement!.id,
      saleId: sale.saleId,
      saleItemId: sale.itemIds[0]!,
      incomingId: incoming.incomingId,
      incomingItemId: incoming.itemIds[0]!,
    };
  });
});

afterAll(closePool);

describe.each([
  ['sxema egasi (trigger himoyasi)', null, 'DV001'],
  ['divine_app (huquq himoyasi)', 'divine_app', '42501'],
])('o‘zgarmas jadvallar — %s', (_label, role, code) => {
  const asRole = async (fn: Parameters<typeof withRollback>[0]) =>
    withRollback(async (db) => {
      if (role) await db.query(`SET LOCAL ROLE ${role}`);
      return fn(db);
    });

  it('audit_logs: UPDATE va DELETE rad etiladi (D-06 — ADMIN ham o‘zgartira olmaydi)', async () => {
    await asRole(async (db) => {
      await expectPgError(
        db,
        `UPDATE audit_logs SET action = 'X' WHERE id = $1`,
        [fixture.auditId],
        {
          code,
        },
      );
      await expectPgError(db, `DELETE FROM audit_logs WHERE id = $1`, [fixture.auditId], { code });
      await expectPgError(db, `TRUNCATE audit_logs`, [], { code });
    });
  });

  it('inventory_movements: ledger o‘zgarmaydi (INV-5)', async () => {
    await asRole(async (db) => {
      await expectPgError(
        db,
        `UPDATE inventory_movements SET quantity = -1 WHERE id = $1`,
        [fixture.movementId],
        { code },
      );
      await expectPgError(
        db,
        `DELETE FROM inventory_movements WHERE id = $1`,
        [fixture.movementId],
        {
          code,
        },
      );
      await expectPgError(db, `TRUNCATE inventory_movements CASCADE`, [], { code });
    });
  });

  it('sales va sale_items: yakunlangan sotuv o‘zgarmaydi (D-07)', async () => {
    await asRole(async (db) => {
      await expectPgError(db, `UPDATE sales SET total_amount = 0 WHERE id = $1`, [fixture.saleId], {
        code,
      });
      await expectPgError(db, `DELETE FROM sales WHERE id = $1`, [fixture.saleId], { code });
      await expectPgError(
        db,
        `UPDATE sale_items SET unit_price = 0 WHERE id = $1`,
        [fixture.saleItemId],
        { code },
      );
      await expectPgError(db, `DELETE FROM sale_items WHERE id = $1`, [fixture.saleItemId], {
        code,
      });
    });
  });
});

describe('audit_logs: yozish', () => {
  it('ilova roli audit yozuvi qo‘sha oladi va o‘qiy oladi', async () => {
    await withRollback(async (db) => {
      await db.query('SET LOCAL ROLE divine_app');
      const { rows } = await db.query<{ action: string; metadata: unknown }>(
        `INSERT INTO audit_logs (action, entity_type, metadata) VALUES ('AUTH_LOGIN_FAILED', 'SESSION', '{"login":"ali"}')
         RETURNING action, metadata`,
      );
      expect(rows[0]).toEqual({ action: 'AUTH_LOGIN_FAILED', metadata: { login: 'ali' } });
    });
  });
});

describe('kirim hujjati holati (A-24, D-07)', () => {
  it('tasdiqlangan kirim va uning qatorlari o‘zgarmaydi, o‘chirilmaydi', async () => {
    await withRollback(async (db) => {
      await expectPgError(
        db,
        `UPDATE incoming SET notes = 'tahrir' WHERE id = $1`,
        [fixture.incomingId],
        { code: 'DV002' },
      );
      await expectPgError(db, `DELETE FROM incoming WHERE id = $1`, [fixture.incomingId], {
        code: 'DV002',
      });
      await expectPgError(
        db,
        `UPDATE incoming_items SET quantity = 999 WHERE id = $1`,
        [fixture.incomingItemId],
        { code: 'DV002' },
      );
      await expectPgError(
        db,
        `DELETE FROM incoming_items WHERE id = $1`,
        [fixture.incomingItemId],
        { code: 'DV002' },
      );
      await expectPgError(
        db,
        `INSERT INTO incoming_items (incoming_id, product_id, product_name, quantity, cost_price)
         SELECT $1, product_id, product_name, 1, 1 FROM incoming_items WHERE id = $2`,
        [fixture.incomingId, fixture.incomingItemId],
        { code: 'DV002' },
      );
      await expectPgError(db, `TRUNCATE incoming CASCADE`, [], { code: 'DV001' });
    });
  });

  it('kirim faqat DRAFT holatida yaratiladi', async () => {
    await withRollback(async (db) => {
      const { admin, warehouseId } = await baseContext(db);
      await expectPgError(
        db,
        `INSERT INTO incoming (incoming_date, warehouse_id, status, confirmed_by, confirmed_at, created_by)
         VALUES ('2026-10-08', $1, 'CONFIRMED', $2, now(), $2)`,
        [warehouseId, admin],
        { code: 'DV002' },
      );
    });
  });

  it('DRAFT: tahrirlash va o‘chirish mumkin (qatorlar CASCADE bilan)', async () => {
    await withRollback(async (db) => {
      const { admin, warehouseId, groupId } = await baseContext(db);
      const productId = await createProduct(db, { groupId, actor: admin });
      const { incomingId } = await createDraftIncoming(db, {
        warehouseId,
        actor: admin,
        lines: [{ productId, quantity: '3' }],
      });
      await db.query(`UPDATE incoming_items SET quantity = 4 WHERE incoming_id = $1`, [incomingId]);
      await db.query(`UPDATE incoming SET notes = 'Yetkazib beruvchi: X' WHERE id = $1`, [
        incomingId,
      ]);
      await db.query(`DELETE FROM incoming WHERE id = $1`, [incomingId]);
      const { rowCount } = await db.query(`SELECT 1 FROM incoming_items WHERE incoming_id = $1`, [
        incomingId,
      ]);
      expect(rowCount).toBe(0);
    });
  });

  it('DRAFT → CANCELLED, keyin hujjat qulflanadi; bekor qilingan kirim tasdiqlanmaydi', async () => {
    await withRollback(async (db) => {
      const { admin, warehouseId, groupId } = await baseContext(db);
      const productId = await createProduct(db, { groupId, actor: admin });
      const { incomingId } = await createDraftIncoming(db, {
        warehouseId,
        actor: admin,
        lines: [{ productId, quantity: '3' }],
      });
      await db.query(
        `UPDATE incoming SET status = 'CANCELLED', cancelled_by = $2, cancelled_at = now() WHERE id = $1`,
        [incomingId, admin],
      );
      await expectPgError(
        db,
        `UPDATE incoming SET status = 'CONFIRMED', confirmed_by = $2, confirmed_at = now(),
                cancelled_by = NULL, cancelled_at = NULL WHERE id = $1`,
        [incomingId, admin],
        { code: 'DV002' },
      );
    });
  });

  it('holat va vaqt/actor maydonlari mos bo‘lishi shart', async () => {
    await withRollback(async (db) => {
      const { admin, warehouseId, groupId } = await baseContext(db);
      const productId = await createProduct(db, { groupId, actor: admin });
      const { incomingId } = await createDraftIncoming(db, {
        warehouseId,
        actor: admin,
        lines: [{ productId, quantity: '3' }],
      });
      await expectPgError(
        db,
        `UPDATE incoming SET status = 'CONFIRMED' WHERE id = $1`,
        [incomingId],
        { code: '23514', constraint: 'incoming_confirmed_consistency' },
      );
      await confirmIncoming(db, incomingId, admin);
    });
  });
});
