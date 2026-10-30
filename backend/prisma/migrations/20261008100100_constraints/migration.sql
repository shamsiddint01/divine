-- Divine.uz — CHECK constraint'lar va case-insensitive unique indexlar (docs/DATABASE.md §4).
-- Prisma bularni ifodalay olmaydi, shuning uchun qo'lda yozilgan; Prisma ularni drift deb hisoblamaydi.
--
-- Muhim: PostgreSQL NUMERIC 'NaN' qiymatini qabul qiladi va `'NaN' >= 0` TRUE qaytaradi.
-- Shuning uchun har bir pul/miqdor CHECK'ida `<> 'NaN'` ham bor. Infinity va scale'dan
-- oshgan butun qismni NUMERIC(p,s) tipining o'zi rad etadi.

-- ─── roles / permissions ─────────────────────────────────────────────────────────────────────
ALTER TABLE "roles"
  ADD CONSTRAINT "roles_name_not_blank" CHECK (btrim("name") <> '');

ALTER TABLE "permissions"
  ADD CONSTRAINT "permissions_code_format" CHECK ("code" ~ '^[a-z][a-z_]*\.[a-z][a-z_]*$'),
  ADD CONSTRAINT "permissions_description_not_blank" CHECK (btrim("description") <> '');

-- ─── users ───────────────────────────────────────────────────────────────────────────────────
-- BR-03 / A-05: faqat lotin harflari va raqamlar, 3–32 belgi, probelsiz.
ALTER TABLE "users"
  ADD CONSTRAINT "users_login_format" CHECK ("login" ~ '^[A-Za-z0-9]{3,32}$'),
  -- Faqat hash: `v<pepper-versiya>$` + argon2id encoded (SECURITY.md §5). Plaintext parol bu
  -- formatga mos kelmaydi, ya'ni xato bilan ochiq parol yozib yuborish DB darajasida rad etiladi.
  ADD CONSTRAINT "users_password_hash_format" CHECK ("password_hash" ~ '^v[0-9]+\$\$argon2id\$'),
  ADD CONSTRAINT "users_full_name_not_blank" CHECK ("full_name" IS NULL OR btrim("full_name") <> ''),
  ADD CONSTRAINT "users_failed_login_attempts_non_negative" CHECK ("failed_login_attempts" >= 0),
  ADD CONSTRAINT "users_lockout_count_non_negative" CHECK ("lockout_count" >= 0);

-- REQ-023: login unique, case-insensitive ("Ali" va "ali" — bitta login). Kiritilgan ko'rinishda saqlanadi.
CREATE UNIQUE INDEX "users_login_lower_key" ON "users" (lower("login"));

-- ─── user_sessions ───────────────────────────────────────────────────────────────────────────
ALTER TABLE "user_sessions"
  ADD CONSTRAINT "user_sessions_token_hash_format" CHECK ("token_hash" ~ '^[0-9a-f]{64}$'),
  ADD CONSTRAINT "user_sessions_expires_after_created" CHECK ("expires_at" > "created_at"),
  ADD CONSTRAINT "user_sessions_revoked_consistency" CHECK (("revoked_at" IS NULL) = ("revoked_reason" IS NULL)),
  ADD CONSTRAINT "user_sessions_revoked_reason_valid" CHECK (
    "revoked_reason" IS NULL
    OR "revoked_reason" IN ('LOGOUT', 'ROTATED', 'REUSE_DETECTED', 'PASSWORD_RESET', 'USER_BLOCKED')
  );

-- ─── product_groups ──────────────────────────────────────────────────────────────────────────
ALTER TABLE "product_groups"
  ADD CONSTRAINT "product_groups_name_not_blank" CHECK (btrim("name") <> ''),
  ADD CONSTRAINT "product_groups_description_not_blank" CHECK ("description" IS NULL OR btrim("description") <> '');

CREATE UNIQUE INDEX "product_groups_name_lower_key" ON "product_groups" (lower("name"));

-- ─── products ────────────────────────────────────────────────────────────────────────────────
ALTER TABLE "products"
  ADD CONSTRAINT "products_name_not_blank" CHECK (btrim("name") <> ''),
  -- Bo'sh satr emas (NULL ishlatiladi), probel va boshqaruv belgilarisiz chop etiladigan ASCII.
  ADD CONSTRAINT "products_barcode_format" CHECK ("barcode" IS NULL OR "barcode" ~ '^[\x21-\x7E]{1,64}$'),
  ADD CONSTRAINT "products_cost_price_valid" CHECK ("cost_price" >= 0 AND "cost_price" <> 'NaN'),
  ADD CONSTRAINT "products_sale_price_valid" CHECK ("sale_price" >= 0 AND "sale_price" <> 'NaN'),
  ADD CONSTRAINT "products_min_stock_valid" CHECK ("min_stock" IS NULL OR ("min_stock" >= 0 AND "min_stock" <> 'NaN')),
  -- A-13: dona bilan sotiladigan mahsulot kasr miqdorli bo'la olmaydi.
  ADD CONSTRAINT "products_unit_decimal_policy" CHECK ("unit" <> 'DONA' OR "allow_decimal" = false);

-- ─── warehouses ──────────────────────────────────────────────────────────────────────────────
ALTER TABLE "warehouses"
  ADD CONSTRAINT "warehouses_name_not_blank" CHECK (btrim("name") <> ''),
  ADD CONSTRAINT "warehouses_address_not_blank" CHECK ("address" IS NULL OR btrim("address") <> '');

CREATE UNIQUE INDEX "warehouses_name_lower_key" ON "warehouses" (lower("name"));

-- ─── warehouse_stock ─────────────────────────────────────────────────────────────────────────
-- REQ-161 / BR-07: manfiy qoldiqqa qarshi oxirgi himoya (asosiy himoya — shartli atomic UPDATE).
ALTER TABLE "warehouse_stock"
  ADD CONSTRAINT "warehouse_stock_quantity_non_negative" CHECK ("quantity" >= 0 AND "quantity" <> 'NaN');

-- ─── inventory_movements ─────────────────────────────────────────────────────────────────────
ALTER TABLE "inventory_movements"
  ADD CONSTRAINT "inventory_movements_quantity_non_zero" CHECK ("quantity" <> 0 AND "quantity" <> 'NaN'),
  ADD CONSTRAINT "inventory_movements_balance_non_negative" CHECK ("balance_after" >= 0 AND "balance_after" <> 'NaN'),
  ADD CONSTRAINT "inventory_movements_unit_cost_valid" CHECK ("unit_cost" IS NULL OR ("unit_cost" >= 0 AND "unit_cost" <> 'NaN')),
  -- INV-6: kirim musbat, sotuv manfiy. Zaxira turlar (D-03) uchun ishora erkin.
  ADD CONSTRAINT "inventory_movements_direction" CHECK (
    ("movement_type" = 'INCOMING' AND "quantity" > 0)
    OR ("movement_type" = 'SALE' AND "quantity" < 0)
    OR "movement_type" IN ('ADJUSTMENT', 'RETURN', 'TRANSFER')
  ),
  -- Kirim harakati faqat kirim hujjatiga, sotuv harakati faqat sotuvga ishora qiladi.
  ADD CONSTRAINT "inventory_movements_reference_matches_type" CHECK (
    "movement_type" NOT IN ('INCOMING', 'SALE') OR "movement_type"::text = "reference_type"::text
  );

-- ─── incoming ────────────────────────────────────────────────────────────────────────────────
ALTER TABLE "incoming"
  ADD CONSTRAINT "incoming_notes_not_blank" CHECK ("notes" IS NULL OR btrim("notes") <> ''),
  ADD CONSTRAINT "incoming_total_quantity_valid" CHECK ("total_quantity" >= 0 AND "total_quantity" <> 'NaN'),
  ADD CONSTRAINT "incoming_total_amount_valid" CHECK ("total_amount" >= 0 AND "total_amount" <> 'NaN'),
  ADD CONSTRAINT "incoming_confirmed_consistency" CHECK (
    ("status" = 'CONFIRMED') = ("confirmed_at" IS NOT NULL AND "confirmed_by" IS NOT NULL)
  ),
  ADD CONSTRAINT "incoming_cancelled_consistency" CHECK (
    ("status" = 'CANCELLED') = ("cancelled_at" IS NOT NULL AND "cancelled_by" IS NOT NULL)
  );

-- ─── incoming_items ──────────────────────────────────────────────────────────────────────────
ALTER TABLE "incoming_items"
  ADD CONSTRAINT "incoming_items_product_name_not_blank" CHECK (btrim("product_name") <> ''),
  ADD CONSTRAINT "incoming_items_barcode_format" CHECK ("barcode" IS NULL OR "barcode" ~ '^[\x21-\x7E]{1,64}$'),
  ADD CONSTRAINT "incoming_items_quantity_positive" CHECK ("quantity" > 0 AND "quantity" <> 'NaN'),
  ADD CONSTRAINT "incoming_items_cost_price_valid" CHECK ("cost_price" >= 0 AND "cost_price" <> 'NaN');

-- ─── customers ───────────────────────────────────────────────────────────────────────────────
ALTER TABLE "customers"
  ADD CONSTRAINT "customers_name_not_blank" CHECK (btrim("name") <> ''),
  -- A-23: `+998XXXXXXXXX` ga normallashtirilgan, unique emas.
  ADD CONSTRAINT "customers_phone_format" CHECK ("phone" IS NULL OR "phone" ~ '^\+998[0-9]{9}$'),
  ADD CONSTRAINT "customers_notes_not_blank" CHECK ("notes" IS NULL OR btrim("notes") <> ''),
  ADD CONSTRAINT "customers_purchase_count_non_negative" CHECK ("purchase_count" >= 0),
  ADD CONSTRAINT "customers_total_spent_valid" CHECK ("total_spent" >= 0 AND "total_spent" <> 'NaN');

-- ─── sales ───────────────────────────────────────────────────────────────────────────────────
ALTER TABLE "sales"
  ADD CONSTRAINT "sales_customer_name_not_blank" CHECK (btrim("customer_name_snapshot") <> ''),
  ADD CONSTRAINT "sales_customer_phone_format" CHECK (
    "customer_phone_snapshot" IS NULL OR "customer_phone_snapshot" ~ '^\+998[0-9]{9}$'
  ),
  ADD CONSTRAINT "sales_total_quantity_positive" CHECK ("total_quantity" > 0 AND "total_quantity" <> 'NaN'),
  ADD CONSTRAINT "sales_total_amount_valid" CHECK ("total_amount" >= 0 AND "total_amount" <> 'NaN'),
  ADD CONSTRAINT "sales_total_cost_valid" CHECK ("total_cost" >= 0 AND "total_cost" <> 'NaN'),
  ADD CONSTRAINT "sales_request_hash_format" CHECK ("request_hash" ~ '^[0-9a-f]{64}$');

-- ─── sale_items ──────────────────────────────────────────────────────────────────────────────
ALTER TABLE "sale_items"
  ADD CONSTRAINT "sale_items_product_name_not_blank" CHECK (btrim("product_name") <> ''),
  ADD CONSTRAINT "sale_items_barcode_format" CHECK ("barcode" IS NULL OR "barcode" ~ '^[\x21-\x7E]{1,64}$'),
  ADD CONSTRAINT "sale_items_quantity_positive" CHECK ("quantity" > 0 AND "quantity" <> 'NaN'),
  ADD CONSTRAINT "sale_items_unit_price_valid" CHECK ("unit_price" >= 0 AND "unit_price" <> 'NaN'),
  ADD CONSTRAINT "sale_items_unit_cost_valid" CHECK ("unit_cost" >= 0 AND "unit_cost" <> 'NaN');

-- ─── expense_categories / expenses ───────────────────────────────────────────────────────────
ALTER TABLE "expense_categories"
  ADD CONSTRAINT "expense_categories_name_not_blank" CHECK (btrim("name") <> '');

CREATE UNIQUE INDEX "expense_categories_name_lower_key" ON "expense_categories" (lower("name"));

ALTER TABLE "expenses"
  -- BR-32: xarajat summasi > 0.
  ADD CONSTRAINT "expenses_amount_positive" CHECK ("amount" > 0 AND "amount" <> 'NaN'),
  ADD CONSTRAINT "expenses_note_not_blank" CHECK ("note" IS NULL OR btrim("note") <> ''),
  ADD CONSTRAINT "expenses_deleted_consistency" CHECK (("deleted_at" IS NULL) = ("deleted_by" IS NULL));

-- ─── audit_logs / settings ───────────────────────────────────────────────────────────────────
ALTER TABLE "audit_logs"
  ADD CONSTRAINT "audit_logs_action_format" CHECK ("action" ~ '^[A-Z][A-Z_]*$'),
  ADD CONSTRAINT "audit_logs_entity_type_format" CHECK ("entity_type" ~ '^[A-Z][A-Z_]*$'),
  ADD CONSTRAINT "audit_logs_metadata_is_object" CHECK (jsonb_typeof("metadata") = 'object');

ALTER TABLE "settings"
  ADD CONSTRAINT "settings_key_format" CHECK ("key" ~ '^[a-z][a-z0-9_]*$');
