import { afterAll, describe, expect, inject, it } from 'vitest';
import { closePool, expectPgError, getPool, withRollback } from './support/db.js';
import { createUser } from './support/fixtures.js';
import { runPrisma } from './support/global-setup.js';

const TABLES = [
  'audit_logs',
  'control_admins',
  'control_events',
  'control_payments',
  'control_sites',
  'credit_installments',
  'credit_payments',
  'credits',
  'customers',
  'expense_categories',
  'expenses',
  'incoming',
  'incoming_items',
  'inventory_movements',
  'permissions',
  'product_groups',
  'products',
  'role_permissions',
  'roles',
  'sale_items',
  'sales',
  'settings',
  'site_access_requests',
  'site_license',
  'support_feedback',
  'support_replies',
  'support_tickets',
  'user_sessions',
  'user_warehouses',
  'users',
  'warehouse_sales_totals',
  'warehouse_stock',
  'warehouses',
];
const IMMUTABLE = ['audit_logs', 'control_events', 'inventory_movements', 'sale_items', 'sales'];
/** Hosila yig'malar (Phase 17): faqat trigger yozadi (SECURITY DEFINER) — ilova faqat o'qiydi. */
const DERIVED = ['warehouse_sales_totals'];
const WRITABLE_TABLES = TABLES.filter((t) => !DERIVED.includes(t));

afterAll(closePool);

describe('migratsiyalar', () => {
  it('deploy takroriy ishga tushirilganda hech narsa qilmaydi (repeatable)', () => {
    const output = runPrisma(inject('databaseUrl'), ['migrate', 'deploy']);
    expect(output).toMatch(/No pending migrations to apply/);
    expect(runPrisma(inject('databaseUrl'), ['migrate', 'status'])).toMatch(
      /Database schema is up to date/,
    );
  });

  it('migratsiyalar va schema.prisma o‘rtasida drift yo‘q', () => {
    // --exit-code: farq bo'lsa 2 bilan tugaydi va execFileSync xato tashlaydi.
    const output = runPrisma(inject('databaseUrl'), [
      'migrate',
      'diff',
      '--from-config-datasource',
      '--to-schema',
      'prisma/schema.prisma',
      '--exit-code',
    ]);
    expect(output).toMatch(/No difference detected|empty migration/i);
  });

  it('DATABASE.md dagi 21 ta jadvalning hammasi mavjud', async () => {
    const { rows } = await getPool().query<{ table_name: string }>(
      `SELECT table_name FROM information_schema.tables
        WHERE table_schema = 'public' AND table_type = 'BASE TABLE' AND table_name <> '_prisma_migrations'
        ORDER BY table_name`,
    );
    expect(rows.map((r) => r.table_name)).toEqual(TABLES);
  });

  it('pg_trgm o‘rnatilgan va DB sessiya standarti UTC', async () => {
    const pool = getPool();
    const ext = await pool.query(`SELECT 1 FROM pg_extension WHERE extname = 'pg_trgm'`);
    expect(ext.rowCount).toBe(1);
    const { rows } = await pool.query<{ setconfig: string[] }>(
      `SELECT s.setconfig FROM pg_db_role_setting s JOIN pg_database d ON d.oid = s.setdatabase
        WHERE d.datname = current_database() AND s.setrole = 0`,
    );
    expect(rows[0]?.setconfig).toContain('TimeZone=UTC');
  });
});

describe('Phase 11 migratsiyasi (D-11, D-19)', () => {
  it('expenses.status ustuni va expense_status turi yo‘q; category_id NOT NULL va FK RESTRICT saqlangan', async () => {
    const pool = getPool();
    const { rows: columns } = await pool.query<{ column_name: string; is_nullable: string }>(
      `SELECT column_name, is_nullable FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = 'expenses' ORDER BY ordinal_position`,
    );
    expect(columns.map((c) => c.column_name)).toEqual([
      'id',
      'expense_date',
      'amount',
      'category_id',
      'note',
      'created_by',
      'updated_by',
      'deleted_at',
      'deleted_by',
      'created_at',
      'updated_at',
    ]);
    expect(columns.find((c) => c.column_name === 'category_id')?.is_nullable).toBe('NO');
    const type = await pool.query(`SELECT 1 FROM pg_type WHERE typname = 'expense_status'`);
    expect(type.rowCount).toBe(0);
    const { rows: fk } = await pool.query<{ rule: string }>(
      `SELECT confdeltype AS rule FROM pg_constraint WHERE conname = 'expenses_category_id_fkey'`,
    );
    expect(fk).toEqual([{ rule: 'r' }]);
  });
});

describe('ID va hisoblangan ustunlar', () => {
  it('UUID PK standart qiymati — uuidv7 (vaqt bo‘yicha tartiblangan)', async () => {
    await withRollback(async (db) => {
      const first = await createUser(db);
      const second = await createUser(db);
      const { rows } = await db.query<{ v1: number; v2: number; ordered: boolean }>(
        `SELECT uuid_extract_version($1::uuid) AS v1, uuid_extract_version($2::uuid) AS v2,
                $1::uuid < $2::uuid AS ordered`,
        [first, second],
      );
      expect(rows[0]).toEqual({ v1: 7, v2: 7, ordered: true });
    });
  });

  it('IDENTITY ustunga qo‘lda qiymat berib bo‘lmaydi', async () => {
    await withRollback(async (db) => {
      await expectPgError(db, `INSERT INTO roles (id, code, name) VALUES (99, 'USER', 'x')`, [], {
        code: '428C9',
      });
    });
  });

  it('GENERATED line_total ga qo‘lda qiymat yozib bo‘lmaydi', async () => {
    await withRollback(async (db) => {
      await expectPgError(
        db,
        `INSERT INTO sale_items (sale_id, product_id, product_name, quantity, unit_price, unit_cost, line_total)
         VALUES (uuidv7(), uuidv7(), 'x', 1, 1, 1, 999)`,
        [],
        { code: '428C9' },
      );
    });
  });
});

describe('FK delete strategiyasi (tarix yo‘qolmaydi)', () => {
  it('CASCADE faqat tarixsiz bog‘lovchi jadvallarda, qolganlari RESTRICT', async () => {
    const { rows } = await getPool().query<{ tbl: string; col: string; rule: string }>(
      `SELECT c.conrelid::regclass::text AS tbl, a.attname AS col, c.confdeltype AS rule
         FROM pg_constraint c
         JOIN pg_attribute a ON a.attrelid = c.conrelid AND a.attnum = c.conkey[1]
        WHERE c.contype = 'f' AND c.connamespace = 'public'::regnamespace`,
    );
    const nonRestrict = rows
      .filter((r) => r.rule !== 'r')
      .map((r) => `${r.tbl}.${r.col}:${r.rule}`)
      .sort();
    expect(nonRestrict).toEqual([
      'control_events.site_id:c',
      'control_payments.site_id:c',
      'incoming_items.incoming_id:c', // faqat DRAFT kirim o'chiriladi (trigger)
      'role_permissions.permission_id:c',
      'role_permissions.role_id:c',
      'support_replies.ticket_id:c',
      'support_tickets.user_id:n', // user o'chsa ham murojaat qoladi
      'user_sessions.replaced_by_id:n', // SET NULL: rotation zanjiri
      'user_sessions.user_id:c',
    ]);
    expect(rows.length).toBeGreaterThan(30);
  });
});

describe('divine_app roli (ilova runtime huquqlari)', () => {
  it('har bir (hosila bo‘lmagan) jadvalda SELECT va INSERT bor', async () => {
    const { rows } = await getPool().query<{ t: string; sel: boolean; ins: boolean }>(
      `SELECT t, has_table_privilege('divine_app', t, 'SELECT') AS sel,
              has_table_privilege('divine_app', t, 'INSERT') AS ins
         FROM unnest($1::text[]) AS t`,
      [WRITABLE_TABLES],
    );
    expect(rows.filter((r) => !r.sel || !r.ins).map((r) => r.t)).toEqual([]);
  });

  it('o‘zgarmas jadvallarda UPDATE, DELETE, TRUNCATE yo‘q; qolganlarida UPDATE bor', async () => {
    const { rows } = await getPool().query<{
      t: string;
      upd: boolean;
      del: boolean;
      trunc: boolean;
    }>(
      `SELECT t, has_table_privilege('divine_app', t, 'UPDATE') AS upd,
              has_table_privilege('divine_app', t, 'DELETE') AS del,
              has_table_privilege('divine_app', t, 'TRUNCATE') AS trunc
         FROM unnest($1::text[]) AS t`,
      [WRITABLE_TABLES],
    );
    for (const row of rows) {
      const immutable = IMMUTABLE.includes(row.t);
      expect({ t: row.t, upd: row.upd, del: row.del, trunc: row.trunc }).toEqual({
        t: row.t,
        upd: !immutable,
        del: !immutable,
        trunc: false,
      });
    }
  });

  it('hosila yig‘ma jadvallar: faqat SELECT (INSERT, UPDATE, DELETE, TRUNCATE yo‘q — yozadi faqat trigger)', async () => {
    const { rows } = await getPool().query<{ t: string; privileges: string[] }>(
      `SELECT t, ARRAY(SELECT p FROM unnest(ARRAY['SELECT','INSERT','UPDATE','DELETE','TRUNCATE']) p
                        WHERE has_table_privilege('divine_app', t, p)) AS privileges
         FROM unnest($1::text[]) AS t`,
      [DERIVED],
    );
    expect(rows).toEqual(DERIVED.map((t) => ({ t, privileges: ['SELECT'] })));
  });

  it('reconciliation view‘larini o‘qiy oladi', async () => {
    await withRollback(async (db) => {
      await db.query('SET LOCAL ROLE divine_app');
      for (const view of [
        'reconcile_inventory_stock',
        'reconcile_document_movements',
        'reconcile_document_totals',
        'reconcile_customer_aggregates',
        'reconcile_sales_totals',
      ]) {
        await expect(db.query(`SELECT count(*) FROM ${view}`)).resolves.toBeDefined();
      }
    });
  });
});

describe('indexlar (DATABASE.md §7)', () => {
  it('asosiy so‘rov indexlari mavjud', async () => {
    const { rows } = await getPool().query<{ indexname: string }>(
      `SELECT indexname FROM pg_indexes WHERE schemaname = 'public'`,
    );
    const names = new Set(rows.map((r) => r.indexname));
    for (const index of [
      'users_login_lower_key',
      'products_barcode_key',
      'products_name_trgm_idx',
      'products_group_id_idx',
      'warehouse_stock_product_id_idx',
      'inventory_movements_reference_type_reference_item_id_key',
      'sales_sold_at_idx',
      'sales_customer_id_sold_at_idx',
      'incoming_status_incoming_date_idx',
      'customers_phone_idx',
      'customers_name_trgm_idx',
      'expenses_expense_date_active_idx',
      'audit_logs_occurred_at_idx',
      'product_groups_name_lower_key',
      'warehouses_name_lower_key',
      'expense_categories_owner_name_lower_key',
    ]) {
      expect(names, index).toContain(index);
    }
  });
});
