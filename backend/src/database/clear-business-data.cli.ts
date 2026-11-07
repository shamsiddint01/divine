/**
 * Saytning biznes ma'lumotlarini tozalash (`scripts/render/clear-data.sh`): mahsulot, ombor, sotuv, mijoz,
 * nasiya, xarajat. Qoladi: userlar, rollar, sozlamalar, audit jurnali, to'lov muddati va superadmin.
 * O'zgarmas jadvallarning trigger'lari shu tranzaksiya ichida o'chirilib, yana yoqiladi.
 * Hujjat raqamlari boshidan boshlanadi (S-000001, N-000001).
 */
// `.env` yuklovchi BIRINCHI import bo'lishi shart (qarang: config/load-env-file.ts).
import '../config/load-env-file.js';
import pg from 'pg';
import { pgPoolConfig } from './pg-connection.js';

const TABLES = [
  'credit_payments',
  'credit_installments',
  'credits',
  'sale_items',
  'sales',
  'inventory_movements',
  'warehouse_sales_totals',
  'warehouse_stock',
  'incoming_items',
  'incoming',
  'expenses',
  'expense_categories',
  'customers',
  'products',
  'product_groups',
  'user_warehouses',
  'warehouses',
];

const url = process.env.DATABASE_URL;
if (!url || process.env.CONFIRM_CLEAR !== 'HA') {
  process.stderr.write('DATABASE_URL va CONFIRM_CLEAR=HA kerak\n');
  process.exit(1);
}

const client = new pg.Client(pgPoolConfig(url));
await client.connect();
try {
  await client.query('BEGIN');
  for (const table of TABLES) await client.query(`ALTER TABLE "${table}" DISABLE TRIGGER USER`);
  await client.query(`TRUNCATE ${TABLES.map((t) => `"${t}"`).join(', ')} RESTART IDENTITY`);
  for (const table of TABLES) await client.query(`ALTER TABLE "${table}" ENABLE TRIGGER USER`);
  await client.query('COMMIT');
  process.stdout.write('Ma’lumotlar tozalandi.\n');
} catch (error) {
  await client.query('ROLLBACK');
  process.stderr.write(`Tozalanmadi, hech narsa o‘zgarmadi: ${(error as Error).message}\n`);
  process.exitCode = 1;
} finally {
  await client.end();
}
