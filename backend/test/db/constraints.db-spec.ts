import { afterAll, describe, it } from 'vitest';
import { closePool, expectPgError, uid, withRollback } from './support/db.js';
import {
  FAKE_PASSWORD_HASH,
  baseContext,
  createCustomer,
  createProduct,
  createUser,
  createWarehouse,
} from './support/fixtures.js';

afterAll(closePool);

const insertUser = `INSERT INTO users (login, password_hash, role_id) VALUES ($1, $2, (SELECT id FROM roles WHERE code = 'USER'))`;

describe('users', () => {
  it('takroriy login rad etiladi — katta-kichik harf farqsiz (REQ-023)', async () => {
    await withRollback(async (db) => {
      const login = `Ali${uid()}`;
      await db.query(insertUser, [login, FAKE_PASSWORD_HASH]);
      await expectPgError(db, insertUser, [login, FAKE_PASSWORD_HASH], {
        code: '23505',
        constraint: 'users_login_lower_key',
      });
      await expectPgError(db, insertUser, [login.toLowerCase(), FAKE_PASSWORD_HASH], {
        code: '23505',
        constraint: 'users_login_lower_key',
      });
    });
  });

  it.each([
    ['probel', 'ali vali'],
    ['maxsus belgi', 'ali_vali'],
    ['kirill harfi', 'алишер'],
    ['apostrof', "o'tkir"],
    ['juda qisqa', 'ab'],
    ['juda uzun', 'a'.repeat(33)],
  ])('login qoidasiga zid (%s) — rad etiladi (BR-03)', async (_case, login) => {
    await withRollback(async (db) => {
      await expectPgError(db, insertUser, [login, FAKE_PASSWORD_HASH], {
        code: login.length > 32 ? '22001' : '23514',
        ...(login.length > 32 ? {} : { constraint: 'users_login_format' }),
      });
    });
  });

  it('parol faqat hash ko‘rinishida saqlanadi — ochiq parol rad etiladi', async () => {
    await withRollback(async (db) => {
      for (const plaintext of ['123456', 'parol123', '$argon2id$v=19$m=65536']) {
        await expectPgError(db, insertUser, [`u${uid()}`, plaintext], {
          code: '23514',
          constraint: 'users_password_hash_format',
        });
      }
    });
  });

  it('noto‘g‘ri rol FK — rad etiladi', async () => {
    await withRollback(async (db) => {
      await expectPgError(
        db,
        `INSERT INTO users (login, password_hash, role_id) VALUES ($1, $2, 999)`,
        [`u${uid()}`, FAKE_PASSWORD_HASH],
        { code: '23503', constraint: 'users_role_id_fkey' },
      );
    });
  });
});

describe('user_warehouses', () => {
  it('takroriy biriktirish rad etiladi', async () => {
    await withRollback(async (db) => {
      const admin = await createUser(db);
      const user = await createUser(db, { role: 'USER', createdBy: admin });
      const wh = await createWarehouse(db, admin);
      const sql = `INSERT INTO user_warehouses (user_id, warehouse_id, created_by) VALUES ($1, $2, $3)`;
      await db.query(sql, [user, wh, admin]);
      await expectPgError(db, sql, [user, wh, admin], {
        code: '23505',
        constraint: 'user_warehouses_pkey',
      });
    });
  });

  it('mavjud bo‘lmagan omborga biriktirish rad etiladi', async () => {
    await withRollback(async (db) => {
      const admin = await createUser(db);
      await expectPgError(
        db,
        `INSERT INTO user_warehouses (user_id, warehouse_id, created_by) VALUES ($1, uuidv7(), $1)`,
        [admin],
        { code: '23503', constraint: 'user_warehouses_warehouse_id_fkey' },
      );
    });
  });
});

describe('products', () => {
  it('takroriy shtrix-kod rad etiladi, shtrix-kodsiz mahsulotlar esa ko‘p bo‘lishi mumkin (D-05)', async () => {
    await withRollback(async (db) => {
      const { admin, groupId } = await baseContext(db);
      const barcode = `4780${uid()}`;
      await createProduct(db, { groupId, actor: admin, barcode });
      await expectPgError(
        db,
        `INSERT INTO products (name, group_id, barcode, cost_price, sale_price, created_by)
         VALUES ('Boshqa', $1, $2, 1, 1, $3)`,
        [groupId, barcode, admin],
        { code: '23505', constraint: 'products_barcode_key' },
      );
      await createProduct(db, { groupId, actor: admin, barcode: null });
      await createProduct(db, { groupId, actor: admin, barcode: null });
    });
  });

  it.each([
    ['bo‘sh satr', ''],
    ['probel bilan', '478 123'],
    ['boshqaruv belgisi', '478\t123'],
  ])('shtrix-kod formati (%s) — rad etiladi', async (_case, barcode) => {
    await withRollback(async (db) => {
      const { admin, groupId } = await baseContext(db);
      await expectPgError(
        db,
        `INSERT INTO products (name, group_id, barcode, cost_price, sale_price, created_by)
         VALUES ('X', $1, $2, 1, 1, $3)`,
        [groupId, barcode, admin],
        { code: '23514', constraint: 'products_barcode_format' },
      );
    });
  });

  it.each([
    ['manfiy tannarx', 'cost_price', '-1', '23514', 'products_cost_price_valid'],
    ['NaN tannarx', 'cost_price', 'NaN', '23514', 'products_cost_price_valid'],
    ['manfiy sotuv narxi', 'sale_price', '-0.01', '23514', 'products_sale_price_valid'],
    ['NaN sotuv narxi', 'sale_price', 'NaN', '23514', 'products_sale_price_valid'],
    ['Infinity', 'sale_price', 'Infinity', '22003', undefined],
    ['16 xonadan katta', 'sale_price', '12345678901234567', '22003', undefined],
  ])('noto‘g‘ri pul qiymati (%s) — rad etiladi', async (_case, column, value, code, constraint) => {
    await withRollback(async (db) => {
      const { admin, groupId } = await baseContext(db);
      const values = { cost_price: '1', sale_price: '1', [column]: value };
      await expectPgError(
        db,
        `INSERT INTO products (name, group_id, cost_price, sale_price, created_by) VALUES ('X', $1, $2, $3, $4)`,
        [groupId, values.cost_price, values.sale_price, admin],
        { code, ...(constraint ? { constraint } : {}) },
      );
    });
  });

  it('bo‘sh nom va noto‘g‘ri guruh — rad etiladi', async () => {
    await withRollback(async (db) => {
      const { admin, groupId } = await baseContext(db);
      const sql = `INSERT INTO products (name, group_id, cost_price, sale_price, created_by) VALUES ($1, $2, 1, 1, $3)`;
      await expectPgError(db, sql, ['   ', groupId, admin], {
        code: '23514',
        constraint: 'products_name_not_blank',
      });
      await expectPgError(db, sql, ['X', '00000000-0000-7000-8000-000000000000', admin], {
        code: '23503',
        constraint: 'products_group_id_fkey',
      });
    });
  });

  it('DONA birligidagi mahsulot kasr miqdorli bo‘la olmaydi (A-13)', async () => {
    await withRollback(async (db) => {
      const { admin, groupId } = await baseContext(db);
      await expectPgError(
        db,
        `INSERT INTO products (name, group_id, cost_price, sale_price, unit, allow_decimal, created_by)
         VALUES ('X', $1, 1, 1, 'DONA', true, $2)`,
        [groupId, admin],
        { code: '23514', constraint: 'products_unit_decimal_policy' },
      );
      await db.query(
        `INSERT INTO products (name, group_id, cost_price, sale_price, unit, allow_decimal, created_by)
         VALUES ('Shakar', $1, 1, 1, 'KG', true, $2)`,
        [groupId, admin],
      );
    });
  });
});

describe('nomlar unique (case-insensitive)', () => {
  it.each([
    ['product_groups', 'product_groups_name_lower_key'],
    ['warehouses', 'warehouses_name_lower_key'],
    // Har bir user ichida (D-23): bir xil egasi uchun takror rad etiladi.
    ['expense_categories', 'expense_categories_owner_name_lower_key'],
  ])('%s: "Nom" va "NOM" — bitta nom', async (table, constraint) => {
    await withRollback(async (db) => {
      const admin = await createUser(db);
      const name = `Nom ${uid()}`;
      await db.query(`INSERT INTO ${table} (name, created_by) VALUES ($1, $2)`, [name, admin]);
      await expectPgError(
        db,
        `INSERT INTO ${table} (name, created_by) VALUES ($1, $2)`,
        [name.toUpperCase(), admin],
        { code: '23505', constraint },
      );
    });
  });
});

describe('warehouse_stock', () => {
  it('ombor + mahsulot juftligi takrorlanmaydi', async () => {
    await withRollback(async (db) => {
      const { admin, warehouseId, groupId } = await baseContext(db);
      const productId = await createProduct(db, { groupId, actor: admin });
      const sql = `INSERT INTO warehouse_stock (warehouse_id, product_id, quantity) VALUES ($1, $2, 0)`;
      await db.query(sql, [warehouseId, productId]);
      await expectPgError(db, sql, [warehouseId, productId], {
        code: '23505',
        constraint: 'warehouse_stock_pkey',
      });
    });
  });

  it('manfiy qoldiq rad etiladi (REQ-161)', async () => {
    await withRollback(async (db) => {
      const { admin, warehouseId, groupId } = await baseContext(db);
      const productId = await createProduct(db, { groupId, actor: admin });
      await expectPgError(
        db,
        `INSERT INTO warehouse_stock (warehouse_id, product_id, quantity) VALUES ($1, $2, -1)`,
        [warehouseId, productId],
        { code: '23514', constraint: 'warehouse_stock_quantity_non_negative' },
      );
    });
  });

  it('noto‘g‘ri FK (ombor yoki mahsulot yo‘q) — rad etiladi', async () => {
    await withRollback(async (db) => {
      const { admin, warehouseId, groupId } = await baseContext(db);
      const productId = await createProduct(db, { groupId, actor: admin });
      const sql = `INSERT INTO warehouse_stock (warehouse_id, product_id) VALUES ($1, $2)`;
      await expectPgError(db, sql, [warehouseId, '00000000-0000-7000-8000-000000000000'], {
        code: '23503',
        constraint: 'warehouse_stock_product_id_fkey',
      });
      await expectPgError(db, sql, ['00000000-0000-7000-8000-000000000000', productId], {
        code: '23503',
        constraint: 'warehouse_stock_warehouse_id_fkey',
      });
    });
  });
});

describe('hujjat qatorlari', () => {
  it('kirim: nol/manfiy miqdor, manfiy tannarx va takroriy mahsulot rad etiladi', async () => {
    await withRollback(async (db) => {
      const { admin, warehouseId, groupId } = await baseContext(db);
      const productId = await createProduct(db, { groupId, actor: admin });
      const {
        rows: [doc],
      } = await db.query<{ id: string }>(
        `INSERT INTO incoming (incoming_date, warehouse_id, created_by) VALUES ('2026-10-08', $1, $2) RETURNING id`,
        [warehouseId, admin],
      );
      const sql = `INSERT INTO incoming_items (incoming_id, product_id, product_name, quantity, cost_price)
                   VALUES ($1, $2, 'X', $3, $4)`;
      await expectPgError(db, sql, [doc!.id, productId, '0', '1'], {
        code: '23514',
        constraint: 'incoming_items_quantity_positive',
      });
      await expectPgError(db, sql, [doc!.id, productId, '-5', '1'], {
        code: '23514',
        constraint: 'incoming_items_quantity_positive',
      });
      await expectPgError(db, sql, [doc!.id, productId, '5', '-1'], {
        code: '23514',
        constraint: 'incoming_items_cost_price_valid',
      });
      await db.query(sql, [doc!.id, productId, '5', '1']);
      await expectPgError(db, sql, [doc!.id, productId, '5', '1'], {
        code: '23505',
        constraint: 'incoming_items_incoming_id_product_id_key',
      });
    });
  });

  it('sotuv qatori: nol miqdor va manfiy narx rad etiladi', async () => {
    await withRollback(async (db) => {
      const { admin, warehouseId, groupId } = await baseContext(db);
      const productId = await createProduct(db, { groupId, actor: admin });
      const customerId = await createCustomer(db, admin);
      const {
        rows: [sale],
      } = await db.query<{ id: string }>(
        `INSERT INTO sales (user_id, warehouse_id, customer_id, customer_name_snapshot, total_quantity,
           total_amount, total_cost, idempotency_key, request_hash)
         VALUES ($1, $2, $3, 'Mijoz', 1, 1, 1, uuidv7(), repeat('a', 64)) RETURNING id`,
        [admin, warehouseId, customerId],
      );
      const sql = `INSERT INTO sale_items (sale_id, product_id, product_name, quantity, unit_price, unit_cost)
                   VALUES ($1, $2, 'X', $3, $4, 1)`;
      await expectPgError(db, sql, [sale!.id, productId, '0', '1'], {
        code: '23514',
        constraint: 'sale_items_quantity_positive',
      });
      await expectPgError(db, sql, [sale!.id, productId, '1', '-1'], {
        code: '23514',
        constraint: 'sale_items_unit_price_valid',
      });
    });
  });
});

describe('sales', () => {
  it('idempotency kaliti takrorlanmaydi (REQ-145)', async () => {
    await withRollback(async (db) => {
      const { admin, warehouseId } = await baseContext(db);
      const customerId = await createCustomer(db, admin);
      const sql = `INSERT INTO sales (user_id, warehouse_id, customer_id, customer_name_snapshot, total_quantity,
                     total_amount, total_cost, idempotency_key, request_hash)
                   VALUES ($1, $2, $3, 'Mijoz', 1, 1, 1, $4, repeat('a', 64))`;
      const key = '01928c5e-0000-7000-8000-000000000001';
      await db.query(sql, [admin, warehouseId, customerId, key]);
      await expectPgError(db, sql, [admin, warehouseId, customerId, key], {
        code: '23505',
        constraint: 'sales_idempotency_key_key',
      });
    });
  });

  it('mijoz ismi majburiy (BR-05), telefon formati tekshiriladi', async () => {
    await withRollback(async (db) => {
      const admin = await createUser(db);
      await expectPgError(
        db,
        `INSERT INTO customers (name, created_by) VALUES ('  ', $1)`,
        [admin],
        {
          code: '23514',
          constraint: 'customers_name_not_blank',
        },
      );
      await expectPgError(
        db,
        `INSERT INTO customers (name, phone, created_by) VALUES ('Ali', '901234567', $1)`,
        [admin],
        { code: '23514', constraint: 'customers_phone_format' },
      );
      // Telefon unique emas (A-23): bir raqamli ikki mijoz.
      await createCustomer(db, admin, 'Ali');
      await createCustomer(db, admin, 'Vali');
    });
  });
});

describe('expenses', () => {
  it('summa > 0 va NaN emas (BR-32); o‘chirish maydonlari juft; kategoriya majburiy (D-19)', async () => {
    await withRollback(async (db) => {
      const admin = await createUser(db);
      const {
        rows: [category],
      } = await db.query<{ id: string }>(
        `INSERT INTO expense_categories (name, created_by) VALUES ($1, $2) RETURNING id`,
        [`Ijara ${uid()}`, admin],
      );
      const sql = `INSERT INTO expenses (expense_date, amount, category_id, created_by, deleted_at, deleted_by)
                   VALUES ('2026-10-08', $1, $2, $3, $4, $5)`;
      for (const amount of ['0', '-100', 'NaN']) {
        await expectPgError(db, sql, [amount, category!.id, admin, null, null], {
          code: '23514',
          constraint: 'expenses_amount_positive',
        });
      }
      await expectPgError(db, sql, ['100', category!.id, admin, new Date(), null], {
        code: '23514',
        constraint: 'expenses_deleted_consistency',
      });
      await expectPgError(db, sql, ['100', null, admin, null, null], { code: '23502' });
      const { rows } = await db.query<{ amount: string }>(
        `INSERT INTO expenses (expense_date, amount, category_id, created_by)
         VALUES ('2026-10-08', '150000.50', $1, $2) RETURNING amount::text`,
        [category!.id, admin],
      );
      if (rows[0]?.amount !== '150000.50') throw new Error(`amount: ${rows[0]?.amount}`);
    });
  });
});

describe('audit_logs va settings', () => {
  it('metadata faqat JSON obyekt; action formati tekshiriladi', async () => {
    await withRollback(async (db) => {
      const sql = `INSERT INTO audit_logs (action, entity_type, metadata) VALUES ($1, 'USER', $2)`;
      await expectPgError(db, sql, ['USER_CREATED', '[1,2]'], {
        code: '23514',
        constraint: 'audit_logs_metadata_is_object',
      });
      await expectPgError(db, sql, ['user created', '{}'], {
        code: '23514',
        constraint: 'audit_logs_action_format',
      });
      await expectPgError(
        db,
        `INSERT INTO audit_logs (action, entity_type, actor_id) VALUES ('X', 'USER', uuidv7())`,
        [],
        { code: '23503', constraint: 'audit_logs_actor_id_fkey' },
      );
    });
  });

  it('sessiya: bekor qilish vaqti va sababi juft bo‘ladi', async () => {
    await withRollback(async (db) => {
      const user = await createUser(db);
      await expectPgError(
        db,
        `INSERT INTO user_sessions (user_id, token_hash, family_id, expires_at, revoked_at)
         VALUES ($1, repeat('b', 64), uuidv7(), now() + interval '7 days', now())`,
        [user],
        { code: '23514', constraint: 'user_sessions_revoked_consistency' },
      );
    });
  });
});
