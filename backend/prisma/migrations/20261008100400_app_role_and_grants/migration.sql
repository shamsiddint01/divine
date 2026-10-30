-- Divine.uz — DB rollari, huquqlar va vaqt zonasi (docs/DATABASE.md §6, §10).
--
-- Ikki qatlamli himoya:
--   1. Trigger'lar (oldingi migratsiya) — hatto sxema egasi ham ledger va auditni o'zgartira olmaydi.
--   2. `divine_app` (ilova runtime roli) — o'zgarmas jadvallarda faqat SELECT, INSERT huquqi bor.
--
-- `divine_app` — NOLOGIN guruh roli. Ilovaning login foydalanuvchisi unga a'zo qilinadi
-- (prod: `CREATE ROLE divine_api LOGIN PASSWORD '...' IN ROLE divine_app;`, docs/DATABASE.md §6).
-- Migratsiyani bajaruvchi foydalanuvchida CREATEROLE bo'lmasa va rol oldindan yaratilmagan bo'lsa,
-- migratsiya aniq xabar bilan TO'XTAYDI (jim o'tkazib yuborilmaydi).

DO $$
BEGIN
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'divine_app') THEN
    BEGIN
      CREATE ROLE "divine_app" NOLOGIN;
    EXCEPTION WHEN insufficient_privilege THEN
      RAISE EXCEPTION 'divine_app roli mavjud emas va uni yaratishga huquq yo''q. DBA avval bajarsin: CREATE ROLE divine_app NOLOGIN;';
    END;
  END IF;

  EXECUTE format('GRANT CONNECT, TEMPORARY ON DATABASE %I TO "divine_app"', current_database());

  -- Barcha timestamptz qiymatlar UTC'da; ulanish sozlamasidan qat'i nazar sessiya standarti UTC (DATABASE.md §10).
  EXECUTE format('ALTER DATABASE %I SET timezone TO %L', current_database(), 'UTC');
END;
$$;

GRANT USAGE ON SCHEMA "public" TO "divine_app";

-- O'zgaruvchan jadvallar: to'liq DML. Har bir yangi jadval keyingi migratsiyada ANIQ grant qilinadi
-- (default privileges ishlatilmaydi — o'zgarmas jadvalga tasodifan UPDATE huquqi berilmasligi uchun).
GRANT SELECT, INSERT, UPDATE, DELETE ON
  "roles", "permissions", "role_permissions",
  "users", "user_sessions", "user_warehouses",
  "product_groups", "products",
  "warehouses", "warehouse_stock",
  "incoming", "incoming_items",
  "customers",
  "expense_categories", "expenses",
  "settings"
TO "divine_app";

-- O'zgarmas jadvallar: faqat o'qish va qo'shish (D-03, D-06, D-07).
GRANT SELECT, INSERT ON "inventory_movements", "audit_logs", "sales", "sale_items" TO "divine_app";

GRANT SELECT ON
  "reconcile_inventory_stock", "reconcile_document_movements",
  "reconcile_document_totals", "reconcile_customer_aggregates"
TO "divine_app";

GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA "public" TO "divine_app";
