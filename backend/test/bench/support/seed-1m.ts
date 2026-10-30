import { withCommit } from '../../db/support/db.js';

/*
 * REQ-167 benchmark ma'lumotlari (DATABASE §7.2, TESTING §5) — hisobotlar va yuklama testi bir xil
 * hajmda o'lchansin. Alohida Testcontainers DB'da:
 *   5 ombor, 10 guruh, 200 mahsulot, 30 sotuvchi (`bench1…bench30`, parol — `actor` bilan bir xil hash),
 *   100 000 mijoz; 1 000 000 sotuv × 2 qator (2 mln sale_items, 2 mln SALE harakati), 365 kunga teng
 *   taqsimlangan; 3 650 tasdiqlangan kirim × 3 qator, 20 000 xarajat; so'ng `ANALYZE`.
 * Seed tezligi uchun trigger'lar faqat seed tranzaksiyasida o'chiriladi (`session_replication_role =
 * replica`, faqat shu vaqtinchalik konteyner). Ledger `balance_after` bu yerda 0 — shu omborlarda
 * real yozuv (sotuv/kirim) qilinmaydi; yuklama testi yozuvlar uchun alohida, API orqali to'ldirilgan
 * omborni ishlatadi.
 */
export const BENCH_SALES = 1_000_000;

/** Natija fayllarida qayd etiladigan ma'lumot hajmi. */
export const BENCH_DATASET = {
  sales: BENCH_SALES,
  saleItems: 2 * BENCH_SALES,
  saleMovements: 2 * BENCH_SALES,
  customers: 100_000,
  products: 200,
  warehouses: 5,
  sellers: 30,
  incoming: 3_650,
  expenses: 20_000,
  days: 365,
} as const;

export async function seedSales1M(
  actor: string,
): Promise<{ sampleWarehouse: string; sampleProduct: string }> {
  const samples = { sampleWarehouse: '', sampleProduct: '' };
  await withCommit(async (db) => {
    await db.query(`SET LOCAL session_replication_role = replica`);
    await db.query(
      `INSERT INTO warehouses (name, created_by)
       SELECT 'Bench ombor ' || g, $1 FROM generate_series(1, 5) g`,
      [actor],
    );
    await db.query(
      `INSERT INTO product_groups (name, created_by)
       SELECT 'Bench guruh ' || g, $1 FROM generate_series(1, 10) g`,
      [actor],
    );
    await db.query(
      `INSERT INTO products (name, group_id, barcode, cost_price, sale_price, min_stock, created_by)
       SELECT 'Bench mahsulot ' || g,
              (SELECT id FROM product_groups WHERE name = 'Bench guruh ' || (g % 10 + 1)),
              '479' || lpad(g::text, 9, '0'), 1000 + g * 37, 1500 + g * 53,
              CASE WHEN g % 4 = 0 THEN 10 END, $1
         FROM generate_series(1, 200) g`,
      [actor],
    );
    await db.query(
      `INSERT INTO users (login, password_hash, full_name, role_id, created_by)
       SELECT 'bench' || g, (SELECT password_hash FROM users WHERE id = $1), 'Bench sotuvchi ' || g,
              (SELECT id FROM roles WHERE code = 'USER'), $1
         FROM generate_series(1, 30) g`,
      [actor],
    );
    await db.query(
      `INSERT INTO customers (name, phone, created_by)
       SELECT 'Bench mijoz ' || g, '+99890' || lpad(g::text, 7, '0'), $1
         FROM generate_series(1, 100000) g`,
      [actor],
    );
    for (const [table, filter] of [
      ['bp', `products WHERE name LIKE 'Bench mahsulot %'`],
      ['bw', `warehouses WHERE name LIKE 'Bench ombor %'`],
      ['bu', `users WHERE login LIKE 'bench%'`],
      ['bc', `customers WHERE name LIKE 'Bench mijoz %'`],
    ] as const) {
      await db.query(
        `CREATE TEMP TABLE ${table} ON COMMIT DROP AS
         SELECT (row_number() OVER (ORDER BY id) - 1)::int AS i, * FROM ${filter}`,
      );
      await db.query(`CREATE INDEX ON ${table} (i)`);
    }
    // Har bir sotuv: p1 × 1 va p2 × 2; vaqt — 365 kunga teng (~31.5 s oraliq).
    await db.query(
      `CREATE TEMP TABLE bs ON COMMIT DROP AS
       SELECT gen_random_uuid() AS id, g, bu.id AS user_id, bw.id AS warehouse_id, bc.id AS customer_id,
              bc.name AS customer_name, bc.phone AS customer_phone,
              p1.id AS p1, p1.name AS p1_name, p1.barcode AS p1_barcode, p1.sale_price AS p1_price,
              p1.cost_price AS p1_cost,
              p2.id AS p2, p2.name AS p2_name, p2.barcode AS p2_barcode, p2.sale_price AS p2_price,
              p2.cost_price AS p2_cost,
              timestamptz '2026-10-24 04:59:00+00' - make_interval(secs => g * 31.536) AS sold_at
         FROM generate_series(1, $1::int) g
         JOIN bu ON bu.i = g % 30 JOIN bw ON bw.i = g % 5 JOIN bc ON bc.i = g % 100000
         JOIN bp p1 ON p1.i = g % 200 JOIN bp p2 ON p2.i = (g + 1) % 200`,
      [BENCH_SALES],
    );
    await db.query(
      `INSERT INTO sales (id, user_id, warehouse_id, customer_id, customer_name_snapshot,
                          customer_phone_snapshot, total_quantity, total_amount, total_cost,
                          idempotency_key, request_hash, sold_at)
       SELECT id, user_id, warehouse_id, customer_id, customer_name, customer_phone, 3,
              round(p1_price, 2) + round(2 * p2_price, 2), round(p1_cost, 2) + round(2 * p2_cost, 2),
              gen_random_uuid(), md5(id::text) || md5(g::text), sold_at
         FROM bs ORDER BY sold_at`,
    );
    await db.query(
      `INSERT INTO sale_items (sale_id, product_id, product_name, barcode, quantity, unit_price, unit_cost)
       SELECT id, p1, p1_name, p1_barcode, 1, p1_price, p1_cost FROM bs
       UNION ALL
       SELECT id, p2, p2_name, p2_barcode, 2, p2_price, p2_cost FROM bs`,
    );
    await db.query(
      `INSERT INTO inventory_movements (warehouse_id, product_id, movement_type, quantity, balance_after,
         unit_cost, reference_type, reference_id, reference_item_id, created_by, created_at)
       SELECT s.warehouse_id, si.product_id, 'SALE', -si.quantity, 0, si.unit_cost, 'SALE', s.id, si.id,
              s.user_id, s.sold_at
         FROM sale_items si JOIN sales s ON s.id = si.sale_id
        WHERE s.id IN (SELECT id FROM bs)`,
    );
    // Kirimlar: kuniga 10 ta, har biri 3 qator, barchasi tasdiqlangan.
    await db.query(
      `CREATE TEMP TABLE bi ON COMMIT DROP AS
       SELECT gen_random_uuid() AS id, g, (date '2026-10-24' - (g % 365))::date AS d,
              bw.id AS warehouse_id
         FROM generate_series(1, 3650) g JOIN bw ON bw.i = g % 5`,
    );
    await db.query(
      `INSERT INTO incoming (id, incoming_date, warehouse_id, status, created_by, confirmed_by, confirmed_at)
       SELECT id, d, warehouse_id, 'CONFIRMED', $1, $1, d::timestamptz + interval '9 hours' FROM bi`,
      [actor],
    );
    await db.query(
      `INSERT INTO incoming_items (incoming_id, product_id, product_name, barcode, quantity, cost_price)
       SELECT bi.id, p.id, p.name, p.barcode, 100, p.cost_price
         FROM bi CROSS JOIN LATERAL (SELECT * FROM bp WHERE bp.i IN (bi.g % 200, (bi.g + 7) % 200,
                                                                     (bi.g + 13) % 200)) p`,
    );
    await db.query(
      `UPDATE incoming i SET total_quantity = x.q, total_amount = x.a
         FROM (SELECT incoming_id, sum(quantity) AS q, sum(line_total) AS a FROM incoming_items
                GROUP BY incoming_id) x
        WHERE x.incoming_id = i.id AND i.id IN (SELECT id FROM bi)`,
    );
    await db.query(
      `INSERT INTO inventory_movements (warehouse_id, product_id, movement_type, quantity, balance_after,
         unit_cost, reference_type, reference_id, reference_item_id, created_by, created_at)
       SELECT d.warehouse_id, ii.product_id, 'INCOMING', ii.quantity, 0, ii.cost_price, 'INCOMING', d.id,
              ii.id, $1, d.confirmed_at
         FROM incoming_items ii JOIN incoming d ON d.id = ii.incoming_id
        WHERE d.id IN (SELECT id FROM bi)`,
      [actor],
    );
    await db.query(
      `INSERT INTO warehouse_stock (warehouse_id, product_id, quantity)
       SELECT bw.id, bp.id, (bp.i * 7 + bw.i * 3) % 120 FROM bw CROSS JOIN bp`,
    );
    // Trigger'lar o'chiq (replica) — sotilgan miqdor yig'masi (Phase 17) ham ilova yozganidek to'ldiriladi:
    // ledger SALE harakatlaridan, migratsiyadagi bir martalik to'ldirish bilan bir xil.
    await db.query(
      `INSERT INTO warehouse_sales_totals (warehouse_id, product_id, quantity)
       SELECT warehouse_id, product_id, -sum(quantity) FROM inventory_movements
        WHERE movement_type = 'SALE' GROUP BY warehouse_id, product_id
       ON CONFLICT (warehouse_id, product_id)
       DO UPDATE SET quantity = warehouse_sales_totals.quantity + EXCLUDED.quantity`,
    );
    await db.query(
      `INSERT INTO expense_categories (name, created_by)
       SELECT 'Bench kategoriya ' || g, $1 FROM generate_series(1, 10) g`,
      [actor],
    );
    await db.query(
      `INSERT INTO expenses (expense_date, amount, category_id, note, created_by)
       SELECT (date '2026-10-24' - (g % 365))::date, 10000 + g % 5000,
              (SELECT id FROM expense_categories WHERE name = 'Bench kategoriya ' || (g % 10 + 1)),
              'Bench xarajat', $1
         FROM generate_series(1, 20000) g`,
      [actor],
    );
    samples.sampleWarehouse = (
      await db.query<{ id: string }>(`SELECT id FROM bw WHERE i = 0`)
    ).rows[0]!.id;
    samples.sampleProduct = (
      await db.query<{ id: string }>(`SELECT id FROM bp WHERE i = 17`)
    ).rows[0]!.id;
  });
  await withCommit(async (db) => {
    await db.query(`ANALYZE`);
  });
  return samples;
}
