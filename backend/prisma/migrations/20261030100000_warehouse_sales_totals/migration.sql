-- Divine.uz — ombor × mahsulot bo'yicha sotilgan miqdor yig'masi (Phase 17, REQ-167; DATABASE.md §5.5).
--
-- Sabab: kassa katalogining standart saralashi (`sort=sold:desc`) har so'rovda ombordagi BARCHA sotuv
-- qatorlarini `sales` bilan JOIN qilib yig'ardi — bir yillik tarixli omborda (~200 000 sotuv) p95 ≈ 1,5 s,
-- yuklama ostida server to'yinib 503 qaytardi (Phase 17 yuklama testi). Endi yig'ma tayyor turadi.
--
-- Manba — o'zgarmas ledger: har bir SALE harakati (miqdor manfiy) yig'mani oshiradi. Harakatlar mahsulot
-- bo'yicha tartiblangan va o'sha (ombor, mahsulot) uchun warehouse_stock qatori allaqachon qulflangan holda
-- yoziladi (InventoryService) — yangi qulf tartibi, demak yangi deadlock yo'q. Sotuvni qaytarish yo'q (D-03):
-- yig'ma faqat o'sadi. Ilova roli jadvalga yoza olmaydi (faqat SELECT) — yozuvchi SECURITY DEFINER trigger.

CREATE TABLE "warehouse_sales_totals" (
    "warehouse_id" UUID NOT NULL,
    "product_id" UUID NOT NULL,
    "quantity" DECIMAL(14,3) NOT NULL DEFAULT 0,

    CONSTRAINT "warehouse_sales_totals_pkey" PRIMARY KEY ("warehouse_id","product_id")
);

CREATE INDEX "warehouse_sales_totals_product_id_idx" ON "warehouse_sales_totals"("product_id");

ALTER TABLE "warehouse_sales_totals" ADD CONSTRAINT "warehouse_sales_totals_warehouse_id_fkey" FOREIGN KEY ("warehouse_id") REFERENCES "warehouses"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "warehouse_sales_totals" ADD CONSTRAINT "warehouse_sales_totals_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "products"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "warehouse_sales_totals"
  ADD CONSTRAINT "warehouse_sales_totals_quantity_valid" CHECK ("quantity" >= 0 AND "quantity" <> 'NaN');

CREATE FUNCTION "warehouse_sales_totals_apply"() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  INSERT INTO "warehouse_sales_totals" ("warehouse_id", "product_id", "quantity")
  VALUES (NEW."warehouse_id", NEW."product_id", -NEW."quantity")
  ON CONFLICT ("warehouse_id", "product_id")
  DO UPDATE SET "quantity" = "warehouse_sales_totals"."quantity" + EXCLUDED."quantity";
  RETURN NULL;
END;
$$;
REVOKE ALL ON FUNCTION "warehouse_sales_totals_apply"() FROM PUBLIC;

CREATE TRIGGER "inventory_movements_sales_totals"
  AFTER INSERT ON "inventory_movements"
  FOR EACH ROW WHEN (NEW."movement_type" = 'SALE')
  EXECUTE FUNCTION "warehouse_sales_totals_apply"();

-- Mavjud ma'lumot: ledger'dan bir martalik to'ldirish (shu tranzaksiyada — trigger'dan keyin yo'qolgan harakat yo'q).
INSERT INTO "warehouse_sales_totals" ("warehouse_id", "product_id", "quantity")
SELECT "warehouse_id", "product_id", -sum("quantity")
  FROM "inventory_movements" WHERE "movement_type" = 'SALE'
 GROUP BY "warehouse_id", "product_id";

-- Nazorat (reconciliation, RUNBOOK §4): yig'ma ledger bilan teng bo'lmagan juftliklar — bo'sh bo'lishi shart.
CREATE VIEW "reconcile_sales_totals" AS
SELECT coalesce(l."warehouse_id", t."warehouse_id") AS "warehouse_id",
       coalesce(l."product_id", t."product_id") AS "product_id",
       coalesce(l."quantity", 0) AS "ledger_quantity",
       coalesce(t."quantity", 0) AS "totals_quantity"
  FROM (SELECT "warehouse_id", "product_id", -sum("quantity") AS "quantity"
          FROM "inventory_movements" WHERE "movement_type" = 'SALE'
         GROUP BY "warehouse_id", "product_id") l
  FULL JOIN "warehouse_sales_totals" t
    ON t."warehouse_id" = l."warehouse_id" AND t."product_id" = l."product_id"
 WHERE coalesce(l."quantity", 0) <> coalesce(t."quantity", 0);

-- Ilova roli: faqat o'qish (yozuvchi — trigger).
GRANT SELECT ON "warehouse_sales_totals", "reconcile_sales_totals" TO "divine_app";
