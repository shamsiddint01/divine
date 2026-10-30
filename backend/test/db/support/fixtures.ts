/**
 * DB testlari uchun ma'lumot yaratuvchilar.
 *
 * `receive()` va `sell()` — docs/DATABASE.md §5.3 dagi yozish algoritmlarining TEST UCHUN namunasi
 * (service emas). Ular trigger'lar kutgan aniq tartibni ko'rsatadi: hujjat → qatorlar → (tasdiqlash) →
 * product_id bo'yicha tartiblangan stock o'zgarishi (`RETURNING quantity`) → shu balans bilan ledger yozuvi.
 * Phase 7/9 InventoryService aynan shu tartibni Prisma tranzaksiyasida bajaradi.
 */
import type { Db } from './db.js';
import { uid } from './db.js';

/** argon2id encoded ko'rinishidagi soxta hash (`users_password_hash_format` CHECK'iga mos, haqiqiy parol emas). */
export const FAKE_PASSWORD_HASH = 'v1$$argon2id$v=19$m=65536,t=3,p=1$c2FsdHNhbHQ$aGFzaGhhc2hoYXNo';

async function one<T>(db: Db, sql: string, params: unknown[]): Promise<T> {
  const { rows } = await db.query(sql, params);
  if (rows.length !== 1) throw new Error(`1 ta qator kutilgan, ${rows.length} ta keldi: ${sql}`);
  return rows[0] as T;
}

export async function createUser(
  db: Db,
  opts: { role?: 'ADMIN' | 'USER'; login?: string; createdBy?: string | null } = {},
): Promise<string> {
  const row = await one<{ id: string }>(
    db,
    `INSERT INTO users (login, password_hash, full_name, role_id, created_by)
     VALUES ($1, $2, 'Test User', (SELECT id FROM roles WHERE code = $3), $4) RETURNING id`,
    [opts.login ?? `u${uid()}`, FAKE_PASSWORD_HASH, opts.role ?? 'ADMIN', opts.createdBy ?? null],
  );
  return row.id;
}

export async function createWarehouse(
  db: Db,
  actor: string,
  name = `Ombor ${uid()}`,
): Promise<string> {
  return (
    await one<{ id: string }>(
      db,
      `INSERT INTO warehouses (name, created_by) VALUES ($1, $2) RETURNING id`,
      [name, actor],
    )
  ).id;
}

export async function createGroup(db: Db, actor: string, name = `Guruh ${uid()}`): Promise<string> {
  return (
    await one<{ id: string }>(
      db,
      `INSERT INTO product_groups (name, created_by) VALUES ($1, $2) RETURNING id`,
      [name, actor],
    )
  ).id;
}

export interface ProductOpts {
  groupId: string;
  actor: string;
  name?: string;
  barcode?: string | null;
  costPrice?: string;
  salePrice?: string;
}

export async function createProduct(db: Db, opts: ProductOpts): Promise<string> {
  return (
    await one<{ id: string }>(
      db,
      `INSERT INTO products (name, group_id, barcode, cost_price, sale_price, created_by)
       VALUES ($1, $2, $3, $4, $5, $6) RETURNING id`,
      [
        opts.name ?? `Mahsulot ${uid()}`,
        opts.groupId,
        opts.barcode === undefined ? `478${uid()}` : opts.barcode,
        opts.costPrice ?? '1000.00',
        opts.salePrice ?? '1500.00',
        opts.actor,
      ],
    )
  ).id;
}

export async function createCustomer(db: Db, actor: string, name = 'Mijoz Test'): Promise<string> {
  return (
    await one<{ id: string }>(
      db,
      `INSERT INTO customers (name, phone, created_by) VALUES ($1, '+998901234567', $2) RETURNING id`,
      [name, actor],
    )
  ).id;
}

/** Ombor + guruh + admin: ko'p testlar uchun minimal kontekst. */
export async function baseContext(db: Db) {
  const admin = await createUser(db);
  const warehouseId = await createWarehouse(db, admin);
  const groupId = await createGroup(db, admin);
  return { admin, warehouseId, groupId };
}

export interface Line {
  productId: string;
  quantity: string;
  /** Kirim: tannarx. Sotuv: sotuv narxi (berilmasa — mahsulotning joriy narxi). */
  price?: string;
}

/** Stock'ni atomik o'zgartirib, yangi qoldiqni qaytaradi (null — qoldiq yetarli emas). */
export async function changeStock(
  db: Db,
  warehouseId: string,
  productId: string,
  delta: string,
): Promise<string | null> {
  if (delta.startsWith('-')) {
    const { rows } = await db.query<{ quantity: string }>(
      `UPDATE warehouse_stock SET quantity = quantity + $3::numeric, updated_at = now()
        WHERE warehouse_id = $1 AND product_id = $2 AND quantity >= -$3::numeric
        RETURNING quantity`,
      [warehouseId, productId, delta],
    );
    return rows[0]?.quantity ?? null;
  }
  const row = await one<{ quantity: string }>(
    db,
    `INSERT INTO warehouse_stock (warehouse_id, product_id, quantity) VALUES ($1, $2, $3)
     ON CONFLICT (warehouse_id, product_id)
     DO UPDATE SET quantity = warehouse_stock.quantity + EXCLUDED.quantity, updated_at = now()
     RETURNING quantity`,
    [warehouseId, productId, delta],
  );
  return row.quantity;
}

/** DRAFT kirim + qatorlar (snapshot bilan) + server tomonda hisoblangan totallar. */
export async function createDraftIncoming(
  db: Db,
  opts: { warehouseId: string; actor: string; lines: Line[]; date?: string },
): Promise<{ incomingId: string; itemIds: string[] }> {
  const { id: incomingId } = await one<{ id: string }>(
    db,
    `INSERT INTO incoming (incoming_date, warehouse_id, created_by) VALUES ($1, $2, $3) RETURNING id`,
    [opts.date ?? '2026-10-08', opts.warehouseId, opts.actor],
  );
  const itemIds: string[] = [];
  for (const line of opts.lines) {
    const { id } = await one<{ id: string }>(
      db,
      `INSERT INTO incoming_items (incoming_id, product_id, product_name, barcode, quantity, cost_price)
       SELECT $1, p.id, p.name, p.barcode, $3, coalesce($4::numeric, p.cost_price)
         FROM products p WHERE p.id = $2
       RETURNING id`,
      [incomingId, line.productId, line.quantity, line.price ?? null],
    );
    itemIds.push(id);
  }
  await db.query(
    `UPDATE incoming SET
       total_quantity = (SELECT coalesce(sum(quantity), 0) FROM incoming_items WHERE incoming_id = $1),
       total_amount   = (SELECT coalesce(sum(line_total), 0) FROM incoming_items WHERE incoming_id = $1)
     WHERE id = $1`,
    [incomingId],
  );
  return { incomingId, itemIds };
}

/** DRAFT kirimni tasdiqlaydi: status → stock ↑ → ledger (product_id tartibida). */
export async function confirmIncoming(db: Db, incomingId: string, actor: string): Promise<void> {
  await db.query(
    `UPDATE incoming SET status = 'CONFIRMED', confirmed_by = $2, confirmed_at = now() WHERE id = $1`,
    [incomingId, actor],
  );
  const { rows: items } = await db.query<{
    id: string;
    product_id: string;
    quantity: string;
    cost_price: string;
    warehouse_id: string;
  }>(
    `SELECT i.id, i.product_id, i.quantity, i.cost_price, d.warehouse_id
       FROM incoming_items i JOIN incoming d ON d.id = i.incoming_id
      WHERE i.incoming_id = $1 ORDER BY i.product_id`,
    [incomingId],
  );
  for (const item of items) {
    const balance = await changeStock(db, item.warehouse_id, item.product_id, item.quantity);
    await db.query(
      `INSERT INTO inventory_movements (warehouse_id, product_id, movement_type, quantity, balance_after,
         unit_cost, reference_type, reference_id, reference_item_id, created_by)
       VALUES ($1, $2, 'INCOMING', $3, $4, $5, 'INCOMING', $6, $7, $8)`,
      [
        item.warehouse_id,
        item.product_id,
        item.quantity,
        balance,
        item.cost_price,
        incomingId,
        item.id,
        actor,
      ],
    );
  }
}

export async function receive(
  db: Db,
  opts: { warehouseId: string; actor: string; lines: Line[]; date?: string },
): Promise<{ incomingId: string; itemIds: string[] }> {
  const draft = await createDraftIncoming(db, opts);
  await confirmIncoming(db, draft.incomingId, opts.actor);
  return draft;
}

export class InsufficientStockError extends Error {}

/**
 * Sotuv: sales (snapshot va totallar) → sale_items (narx/tannarx snapshot) → har bir qator uchun
 * shartli stock kamaytirish (0 qator = INSUFFICIENT_STOCK) → ledger.
 */
export async function sell(
  db: Db,
  opts: {
    warehouseId: string;
    userId: string;
    customerId: string;
    lines: Line[];
    /** Hisobot/dashboard testlari uchun aniq sotuv vaqti (standart — `now()`). */
    soldAt?: Date;
  },
): Promise<{ saleId: string; itemIds: string[] }> {
  const productIds = opts.lines.map((l) => l.productId);
  const quantities = opts.lines.map((l) => l.quantity);
  const prices = opts.lines.map((l) => l.price ?? null);

  // Narx va tannarx snapshot'lari, totallar — bitta so'rovda (DB yaxlitlashi bilan bir xil: round(q*p, 2)).
  const { id: saleId } = await one<{ id: string }>(
    db,
    `WITH lines AS (
       SELECT l.product_id, l.quantity, coalesce(l.price, p.sale_price) AS unit_price, p.cost_price AS unit_cost
         FROM unnest($4::uuid[], $5::numeric[], $6::numeric[]) AS l(product_id, quantity, price)
         JOIN products p ON p.id = l.product_id
     )
     INSERT INTO sales (user_id, warehouse_id, customer_id, customer_name_snapshot, customer_phone_snapshot,
                        total_quantity, total_amount, total_cost, idempotency_key, request_hash, sold_at)
     SELECT $1, $2, c.id, c.name, c.phone,
            (SELECT sum(quantity) FROM lines),
            (SELECT sum(round(quantity * unit_price, 2)) FROM lines),
            (SELECT sum(round(quantity * unit_cost, 2)) FROM lines),
            gen_random_uuid(), encode(sha256(gen_random_uuid()::text::bytea), 'hex'),
            coalesce($7::timestamptz, now())
       FROM customers c WHERE c.id = $3
     RETURNING id`,
    [
      opts.userId,
      opts.warehouseId,
      opts.customerId,
      productIds,
      quantities,
      prices,
      opts.soldAt ?? null,
    ],
  );

  const itemIds: string[] = [];
  for (const line of opts.lines) {
    const { id } = await one<{ id: string }>(
      db,
      `INSERT INTO sale_items (sale_id, product_id, product_name, barcode, quantity, unit_price, unit_cost)
       SELECT $1, p.id, p.name, p.barcode, $3, coalesce($4::numeric, p.sale_price), p.cost_price
         FROM products p WHERE p.id = $2
       RETURNING id`,
      [saleId, line.productId, line.quantity, line.price ?? null],
    );
    itemIds.push(id);
  }

  const { rows: items } = await db.query<{
    id: string;
    product_id: string;
    quantity: string;
    unit_cost: string;
  }>(
    `SELECT id, product_id, quantity, unit_cost FROM sale_items WHERE sale_id = $1 ORDER BY product_id`,
    [saleId],
  );
  for (const item of items) {
    const balance = await changeStock(db, opts.warehouseId, item.product_id, `-${item.quantity}`);
    if (balance === null) throw new InsufficientStockError(item.product_id);
    await db.query(
      `INSERT INTO inventory_movements (warehouse_id, product_id, movement_type, quantity, balance_after,
         unit_cost, reference_type, reference_id, reference_item_id, created_by)
       VALUES ($1, $2, 'SALE', -$3::numeric, $4, $5, 'SALE', $6, $7, $8)`,
      [
        opts.warehouseId,
        item.product_id,
        item.quantity,
        balance,
        item.unit_cost,
        saleId,
        item.id,
        opts.userId,
      ],
    );
  }

  // Mijoz yig'ma ustunlari (cache) — shu tranzaksiyada (DATABASE.md §4.14).
  await db.query(
    `UPDATE customers c SET purchase_count = c.purchase_count + 1,
            total_spent = c.total_spent + s.total_amount,
            last_purchase_at = greatest(c.last_purchase_at, s.sold_at),
            updated_at = now()
       FROM sales s WHERE s.id = $1 AND c.id = s.customer_id`,
    [saleId],
  );
  return { saleId, itemIds };
}
