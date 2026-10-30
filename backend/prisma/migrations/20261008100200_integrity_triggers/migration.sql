-- Divine.uz — yaxlitlik trigger'lari (docs/DATABASE.md §4, §5.2).
--
-- Maqsad: muhim invariantlar faqat application kodiga bog'liq bo'lmasin. Hatto to'g'ridan-to'g'ri SQL
-- (yoki xato service) ham ledger'ni, auditni, yakunlangan hujjatlarni buza olmaydi.
--
-- Xato kodlari (SQLSTATE, "DV" klassi) — Phase 3'da AppError'ga map qilinadi:
--   DV001  o'zgarmas yozuvni o'zgartirish / o'chirish urinishi          → 409 (yoki 500 — dastur xatosi)
--   DV002  hujjat DRAFT holatida emas (tasdiqlangan/bekor qilingan kirim) → 409 INCOMING_NOT_DRAFT
--   DV003  ledger ↔ stock ↔ hujjat invarianti buzildi                    → 500 (dastur xatosi, log)
--   DV004  hujjat bo'sh yoki totallari qatorlar yig'indisiga mos emas      → 500 (dastur xatosi, log)

-- ═════════════════════════════════════════════════════════════════════════════════════════════
-- 1. O'zgarmas jadvallar: audit_logs, inventory_movements, sales, sale_items (D-03, D-06, D-07)
-- ═════════════════════════════════════════════════════════════════════════════════════════════

CREATE FUNCTION "divine_forbid_mutation"() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION '"%" jadvali o''zgarmas: % taqiqlangan', TG_TABLE_NAME, TG_OP
    USING ERRCODE = 'DV001';
END;
$$;

CREATE TRIGGER "audit_logs_immutable" BEFORE UPDATE OR DELETE ON "audit_logs"
  FOR EACH ROW EXECUTE FUNCTION "divine_forbid_mutation"();
CREATE TRIGGER "inventory_movements_immutable" BEFORE UPDATE OR DELETE ON "inventory_movements"
  FOR EACH ROW EXECUTE FUNCTION "divine_forbid_mutation"();
CREATE TRIGGER "sales_immutable" BEFORE UPDATE OR DELETE ON "sales"
  FOR EACH ROW EXECUTE FUNCTION "divine_forbid_mutation"();
CREATE TRIGGER "sale_items_immutable" BEFORE UPDATE OR DELETE ON "sale_items"
  FOR EACH ROW EXECUTE FUNCTION "divine_forbid_mutation"();

-- TRUNCATE qatorli trigger'larni chetlab o'tadi — tarixiy jadvallarda u ham taqiqlanadi.
CREATE TRIGGER "audit_logs_no_truncate" BEFORE TRUNCATE ON "audit_logs"
  FOR EACH STATEMENT EXECUTE FUNCTION "divine_forbid_mutation"();
CREATE TRIGGER "inventory_movements_no_truncate" BEFORE TRUNCATE ON "inventory_movements"
  FOR EACH STATEMENT EXECUTE FUNCTION "divine_forbid_mutation"();
CREATE TRIGGER "sales_no_truncate" BEFORE TRUNCATE ON "sales"
  FOR EACH STATEMENT EXECUTE FUNCTION "divine_forbid_mutation"();
CREATE TRIGGER "sale_items_no_truncate" BEFORE TRUNCATE ON "sale_items"
  FOR EACH STATEMENT EXECUTE FUNCTION "divine_forbid_mutation"();
CREATE TRIGGER "warehouse_stock_no_truncate" BEFORE TRUNCATE ON "warehouse_stock"
  FOR EACH STATEMENT EXECUTE FUNCTION "divine_forbid_mutation"();
CREATE TRIGGER "incoming_no_truncate" BEFORE TRUNCATE ON "incoming"
  FOR EACH STATEMENT EXECUTE FUNCTION "divine_forbid_mutation"();
CREATE TRIGGER "incoming_items_no_truncate" BEFORE TRUNCATE ON "incoming_items"
  FOR EACH STATEMENT EXECUTE FUNCTION "divine_forbid_mutation"();

-- ═════════════════════════════════════════════════════════════════════════════════════════════
-- 2. Kirim hujjati: DRAFT → CONFIRMED | CANCELLED, keyin o'zgarmaydi (A-24, D-07)
-- ═════════════════════════════════════════════════════════════════════════════════════════════

CREATE FUNCTION "divine_incoming_guard"() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  v_items  integer;
  v_qty    numeric;
  v_amount numeric;
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW."status" <> 'DRAFT' THEN
      RAISE EXCEPTION 'Kirim faqat DRAFT holatida yaratiladi (berilgan: %)', NEW."status"
        USING ERRCODE = 'DV002';
    END IF;
    RETURN NEW;
  END IF;

  IF OLD."status" <> 'DRAFT' THEN
    RAISE EXCEPTION 'Kirim % holatida: uni o''zgartirib yoki o''chirib bo''lmaydi', OLD."status"
      USING ERRCODE = 'DV002';
  END IF;

  IF TG_OP = 'DELETE' THEN
    RETURN OLD;
  END IF;

  -- Tasdiqlash paytida: hujjat bo'sh emas va totallar qatorlar yig'indisiga teng (TZ misoli: 50+30+100+20 = 200).
  IF NEW."status" = 'CONFIRMED' THEN
    SELECT count(*), coalesce(sum("quantity"), 0), coalesce(sum("line_total"), 0)
      INTO v_items, v_qty, v_amount
      FROM "incoming_items" WHERE "incoming_id" = NEW."id";
    IF v_items = 0 THEN
      RAISE EXCEPTION 'Bo''sh kirimni tasdiqlab bo''lmaydi' USING ERRCODE = 'DV004';
    END IF;
    IF NEW."total_quantity" <> v_qty OR NEW."total_amount" <> v_amount THEN
      RAISE EXCEPTION 'Kirim totallari (% / %) qatorlar yig''indisiga (% / %) mos emas',
        NEW."total_quantity", NEW."total_amount", v_qty, v_amount
        USING ERRCODE = 'DV004';
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER "incoming_guard" BEFORE INSERT OR UPDATE OR DELETE ON "incoming"
  FOR EACH ROW EXECUTE FUNCTION "divine_incoming_guard"();

-- Kirim qatorlari faqat ota-hujjat DRAFT bo'lganda o'zgaradi.
-- `FOR SHARE` ota-qatorni bloklaydi: parallel tasdiqlash bilan poyga (tasdiqlangandan keyin qator qo'shilishi) bo'lmaydi.
CREATE FUNCTION "divine_incoming_items_guard"() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  v_incoming_id uuid;
  v_status      "incoming_status";
BEGIN
  IF TG_OP = 'UPDATE' AND NEW."incoming_id" <> OLD."incoming_id" THEN
    RAISE EXCEPTION 'Kirim qatorini boshqa hujjatga ko''chirib bo''lmaydi' USING ERRCODE = 'DV002';
  END IF;

  v_incoming_id := CASE WHEN TG_OP = 'DELETE' THEN OLD."incoming_id" ELSE NEW."incoming_id" END;
  SELECT "status" INTO v_status FROM "incoming" WHERE "id" = v_incoming_id FOR SHARE;

  -- Ota-hujjat topilmasa — u hozir o'chirilmoqda (ON DELETE CASCADE); o'chirish faqat DRAFT uchun ruxsat.
  IF v_status IS NOT NULL AND v_status <> 'DRAFT' THEN
    RAISE EXCEPTION 'Kirim % holatida: qatorlarini o''zgartirib bo''lmaydi', v_status
      USING ERRCODE = 'DV002';
  END IF;

  RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
END;
$$;

CREATE TRIGGER "incoming_items_guard" BEFORE INSERT OR UPDATE OR DELETE ON "incoming_items"
  FOR EACH ROW EXECUTE FUNCTION "divine_incoming_items_guard"();

-- ═════════════════════════════════════════════════════════════════════════════════════════════
-- 3. Inventory ledger: har bir harakat hujjat qatoriga va joriy qoldiqqa mos (INV-1, INV-3, INV-4, INV-7)
-- ═════════════════════════════════════════════════════════════════════════════════════════════
--
-- Yozish tartibi (DATABASE.md §5.3): avval `warehouse_stock` atomik o'zgartiriladi (qator lock qilinadi),
-- keyin `RETURNING quantity` qiymati `balance_after` sifatida harakatga yoziladi. Shu sababli:
--   balance_after = oldingi harakatning balance_after + quantity = joriy warehouse_stock.quantity.
-- Ledger tartibi `id` (IDENTITY) bo'yicha: stock qatori lock qilingani uchun bir ombor+mahsulot bo'yicha
-- harakatlar ketma-ket yoziladi, `created_at` esa tranzaksiya boshlangan vaqt bo'lgani uchun tartib manbai emas.

CREATE FUNCTION "divine_inventory_movement_validate"() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  v_doc_id     uuid;
  v_doc_wh     uuid;
  v_doc_status text;
  v_product    uuid;
  v_qty        numeric;
  v_cost       numeric;
  v_prev       numeric;
  v_stock      numeric;
BEGIN
  IF NEW."movement_type" NOT IN ('INCOMING', 'SALE') THEN
    RAISE EXCEPTION '% harakati hali qo''llab-quvvatlanmaydi (D-03)', NEW."movement_type"
      USING ERRCODE = 'DV003';
  END IF;

  -- Hujjat qatoriga moslik: mahsulot, ombor, miqdor (ishora bilan) va tannarx aynan bir xil.
  IF NEW."reference_type" = 'INCOMING' THEN
    SELECT i."incoming_id", d."warehouse_id", d."status"::text, i."product_id", i."quantity", i."cost_price"
      INTO v_doc_id, v_doc_wh, v_doc_status, v_product, v_qty, v_cost
      FROM "incoming_items" i JOIN "incoming" d ON d."id" = i."incoming_id"
     WHERE i."id" = NEW."reference_item_id";
    IF NOT FOUND
       OR v_doc_id <> NEW."reference_id"
       OR v_doc_status <> 'CONFIRMED'
       OR v_doc_wh <> NEW."warehouse_id"
       OR v_product <> NEW."product_id"
       OR v_qty <> NEW."quantity"
       OR NEW."unit_cost" IS DISTINCT FROM v_cost THEN
      RAISE EXCEPTION 'Kirim harakati tasdiqlangan kirim qatoriga mos emas (item %)', NEW."reference_item_id"
        USING ERRCODE = 'DV003';
    END IF;
  ELSE
    SELECT i."sale_id", s."warehouse_id", i."product_id", i."quantity", i."unit_cost"
      INTO v_doc_id, v_doc_wh, v_product, v_qty, v_cost
      FROM "sale_items" i JOIN "sales" s ON s."id" = i."sale_id"
     WHERE i."id" = NEW."reference_item_id";
    IF NOT FOUND
       OR v_doc_id <> NEW."reference_id"
       OR v_doc_wh <> NEW."warehouse_id"
       OR v_product <> NEW."product_id"
       OR NEW."quantity" <> -v_qty
       OR NEW."unit_cost" IS DISTINCT FROM v_cost THEN
      RAISE EXCEPTION 'Sotuv harakati sotuv qatoriga mos emas (item %)', NEW."reference_item_id"
        USING ERRCODE = 'DV003';
    END IF;
  END IF;

  -- Ledger zanjiri: oldingi balans + quantity = balance_after.
  SELECT "balance_after" INTO v_prev
    FROM "inventory_movements"
   WHERE "warehouse_id" = NEW."warehouse_id" AND "product_id" = NEW."product_id"
   ORDER BY "id" DESC
   LIMIT 1;
  IF NEW."balance_after" <> coalesce(v_prev, 0) + NEW."quantity" THEN
    RAISE EXCEPTION 'balance_after (%) = oldingi balans (%) + quantity (%) bo''lishi kerak',
      NEW."balance_after", coalesce(v_prev, 0), NEW."quantity"
      USING ERRCODE = 'DV003';
  END IF;

  -- Harakat stock o'zgarishidan keyin yoziladi: balance_after = joriy qoldiq (INV-3).
  SELECT "quantity" INTO v_stock
    FROM "warehouse_stock"
   WHERE "warehouse_id" = NEW."warehouse_id" AND "product_id" = NEW."product_id";
  IF v_stock IS DISTINCT FROM NEW."balance_after" THEN
    RAISE EXCEPTION 'balance_after (%) joriy qoldiqqa (%) teng emas: avval warehouse_stock yangilanishi kerak',
      NEW."balance_after", v_stock
      USING ERRCODE = 'DV003';
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER "inventory_movements_validate" BEFORE INSERT ON "inventory_movements"
  FOR EACH ROW EXECUTE FUNCTION "divine_inventory_movement_validate"();

-- Har bir stock o'zgarishi ledger yozuvi bilan birga bo'lishi shart (INV-1): tranzaksiya yakunida
-- joriy qoldiq = oxirgi harakatning balance_after (harakat bo'lmasa — 0). Ledger'siz stock o'zgarishi COMMIT'da rad etiladi.
CREATE FUNCTION "divine_warehouse_stock_matches_ledger"() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  v_wh      uuid;
  v_product uuid;
  v_stock   numeric;
  v_ledger  numeric;
BEGIN
  IF TG_OP = 'DELETE' THEN
    v_wh := OLD."warehouse_id"; v_product := OLD."product_id";
  ELSE
    v_wh := NEW."warehouse_id"; v_product := NEW."product_id";
  END IF;

  SELECT "quantity" INTO v_stock
    FROM "warehouse_stock" WHERE "warehouse_id" = v_wh AND "product_id" = v_product;
  SELECT "balance_after" INTO v_ledger
    FROM "inventory_movements" WHERE "warehouse_id" = v_wh AND "product_id" = v_product
   ORDER BY "id" DESC LIMIT 1;

  IF coalesce(v_stock, 0) <> coalesce(v_ledger, 0) THEN
    RAISE EXCEPTION 'Qoldiq (%) ledger balansiga (%) mos emas: stock faqat inventory_movements bilan birga o''zgaradi',
      coalesce(v_stock, 0), coalesce(v_ledger, 0)
      USING ERRCODE = 'DV003';
  END IF;
  RETURN NULL;
END;
$$;

CREATE CONSTRAINT TRIGGER "warehouse_stock_matches_ledger"
  AFTER INSERT OR UPDATE OR DELETE ON "warehouse_stock"
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION "divine_warehouse_stock_matches_ledger"();

-- ═════════════════════════════════════════════════════════════════════════════════════════════
-- 4. Hujjat ↔ ledger to'liqligi (tranzaksiya yakunida tekshiriladi)
-- ═════════════════════════════════════════════════════════════════════════════════════════════

-- Sotuv: kamida bitta qator, totallar = qatorlar yig'indisi, har bir qator uchun aynan bitta harakat.
-- Qator qo'shilganda ham ishga tushadi: yakunlangan (o'zgarmas) sotuvga keyinroq qator qo'shib bo'lmaydi,
-- chunki sotuv totallari endi mos kelmaydi.
CREATE FUNCTION "divine_sale_consistency_check"() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  v_sale_id uuid;
  v_sale    "sales"%ROWTYPE;
  v_items   integer;
  v_qty     numeric;
  v_amount  numeric;
  v_cost    numeric;
  v_moves   integer;
BEGIN
  -- Alohida IF shoxlari: PL/pgSQL `NEW."sale_id"` ifodasini faqat sale_items uchun parse qilishi kerak.
  IF TG_TABLE_NAME = 'sales' THEN
    v_sale_id := NEW."id";
  ELSE
    v_sale_id := NEW."sale_id";
  END IF;
  SELECT * INTO v_sale FROM "sales" WHERE "id" = v_sale_id;

  SELECT count(*), coalesce(sum("quantity"), 0), coalesce(sum("line_total"), 0), coalesce(sum("line_cost"), 0)
    INTO v_items, v_qty, v_amount, v_cost
    FROM "sale_items" WHERE "sale_id" = v_sale_id;

  IF v_items = 0 THEN
    RAISE EXCEPTION 'Sotuvda kamida bitta mahsulot bo''lishi kerak (sotuv %)', v_sale_id USING ERRCODE = 'DV004';
  END IF;
  IF v_sale."total_quantity" <> v_qty OR v_sale."total_amount" <> v_amount OR v_sale."total_cost" <> v_cost THEN
    RAISE EXCEPTION 'Sotuv totallari qatorlar yig''indisiga mos emas (sotuv %)', v_sale_id USING ERRCODE = 'DV004';
  END IF;

  SELECT count(*) INTO v_moves
    FROM "inventory_movements" WHERE "reference_type" = 'SALE' AND "reference_id" = v_sale_id;
  IF v_moves <> v_items THEN
    RAISE EXCEPTION 'Sotuvning % qatoridan % tasi uchun ombor harakati yozilgan (sotuv %)', v_items, v_moves, v_sale_id
      USING ERRCODE = 'DV003';
  END IF;
  RETURN NULL;
END;
$$;

CREATE CONSTRAINT TRIGGER "sales_consistency"
  AFTER INSERT ON "sales"
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION "divine_sale_consistency_check"();
CREATE CONSTRAINT TRIGGER "sale_items_consistency"
  AFTER INSERT ON "sale_items"
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION "divine_sale_consistency_check"();

-- Tasdiqlangan kirim: har bir qator uchun aynan bitta harakat (stock oshgan).
CREATE FUNCTION "divine_incoming_ledger_check"() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  v_items integer;
  v_moves integer;
BEGIN
  SELECT count(*) INTO v_items FROM "incoming_items" WHERE "incoming_id" = NEW."id";
  SELECT count(*) INTO v_moves
    FROM "inventory_movements" WHERE "reference_type" = 'INCOMING' AND "reference_id" = NEW."id";
  IF v_moves <> v_items THEN
    RAISE EXCEPTION 'Tasdiqlangan kirimning % qatoridan % tasi uchun ombor harakati yozilgan (kirim %)',
      v_items, v_moves, NEW."id"
      USING ERRCODE = 'DV003';
  END IF;
  RETURN NULL;
END;
$$;

CREATE CONSTRAINT TRIGGER "incoming_confirmed_ledger"
  AFTER UPDATE ON "incoming"
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW
  WHEN (NEW."status" = 'CONFIRMED')
  EXECUTE FUNCTION "divine_incoming_ledger_check"();
