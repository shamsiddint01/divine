-- Divine.uz — reconciliation view'lari (docs/DATABASE.md §5.4).
--
-- Har bir view FAQAT nomuvofiq qatorlarni qaytaradi: bo'sh natija = hammasi joyida.
-- Trigger'lar bu holatlarni yozish paytida oldini oladi; view'lar esa trigger'lar chetlab o'tilgan
-- (masalan, superuser `session_replication_role = replica` bilan) yoki eski ma'lumot import qilingan
-- holatlar uchun mustaqil tekshiruv. Avtomatik tuzatish yo'q — faqat inson qarori bilan (D-03 ADJUSTMENT).
-- Phase 7: `GET /inventory/reconciliation` va kunlik job shu view'larni o'qiydi.

-- INV-1, INV-3: joriy qoldiq = Σ ledger = oxirgi harakatning balance_after.
CREATE VIEW "reconcile_inventory_stock" AS
WITH "ledger" AS (
  SELECT "warehouse_id",
         "product_id",
         sum("quantity") AS "ledger_quantity",
         (array_agg("balance_after" ORDER BY "id" DESC))[1] AS "last_balance_after"
    FROM "inventory_movements"
   GROUP BY "warehouse_id", "product_id"
)
SELECT coalesce(s."warehouse_id", l."warehouse_id") AS "warehouse_id",
       coalesce(s."product_id", l."product_id")     AS "product_id",
       coalesce(s."quantity", 0)                    AS "stock_quantity",
       coalesce(l."ledger_quantity", 0)             AS "ledger_quantity",
       coalesce(l."last_balance_after", 0)          AS "last_balance_after"
  FROM "warehouse_stock" s
  FULL JOIN "ledger" l
    ON l."warehouse_id" = s."warehouse_id" AND l."product_id" = s."product_id"
 WHERE coalesce(s."quantity", 0) <> coalesce(l."ledger_quantity", 0)
    OR coalesce(s."quantity", 0) <> coalesce(l."last_balance_after", 0);

-- INV-4, INV-7: har bir hujjat qatoriga aynan mos harakat; harakatsiz qator yoki egasiz harakat yo'q.
CREATE VIEW "reconcile_document_movements" AS
SELECT 'SALE'::text            AS "document_type",
       i."sale_id"             AS "document_id",
       i."id"                  AS "item_id",
       i."product_id",
       s."warehouse_id",
       -i."quantity"           AS "expected_quantity",
       m."quantity"            AS "movement_quantity",
       CASE WHEN m."id" IS NULL THEN 'MISSING_MOVEMENT' ELSE 'MISMATCH' END AS "issue"
  FROM "sale_items" i
  JOIN "sales" s ON s."id" = i."sale_id"
  LEFT JOIN "inventory_movements" m
    ON m."reference_type" = 'SALE' AND m."reference_item_id" = i."id"
 WHERE m."id" IS NULL
    OR m."reference_id" <> i."sale_id"
    OR m."quantity" <> -i."quantity"
    OR m."product_id" <> i."product_id"
    OR m."warehouse_id" <> s."warehouse_id"
UNION ALL
SELECT 'INCOMING', i."incoming_id", i."id", i."product_id", d."warehouse_id",
       CASE WHEN d."status" = 'CONFIRMED' THEN i."quantity" END,
       m."quantity",
       CASE
         WHEN d."status" <> 'CONFIRMED' THEN 'MOVEMENT_ON_UNCONFIRMED'
         WHEN m."id" IS NULL THEN 'MISSING_MOVEMENT'
         ELSE 'MISMATCH'
       END
  FROM "incoming_items" i
  JOIN "incoming" d ON d."id" = i."incoming_id"
  LEFT JOIN "inventory_movements" m
    ON m."reference_type" = 'INCOMING' AND m."reference_item_id" = i."id"
 WHERE (d."status" = 'CONFIRMED' AND (
          m."id" IS NULL
          OR m."reference_id" <> i."incoming_id"
          OR m."quantity" <> i."quantity"
          OR m."product_id" <> i."product_id"
          OR m."warehouse_id" <> d."warehouse_id"))
    OR (d."status" <> 'CONFIRMED' AND m."id" IS NOT NULL)
UNION ALL
SELECT m."reference_type"::text, m."reference_id", m."reference_item_id", m."product_id", m."warehouse_id",
       NULL, m."quantity", 'ORPHAN_MOVEMENT'
  FROM "inventory_movements" m
 WHERE (m."reference_type" = 'SALE'
        AND NOT EXISTS (SELECT 1 FROM "sale_items" i WHERE i."id" = m."reference_item_id"))
    OR (m."reference_type" = 'INCOMING'
        AND NOT EXISTS (SELECT 1 FROM "incoming_items" i WHERE i."id" = m."reference_item_id"));

-- Hujjat totallari = qatorlar yig'indisi (tasdiqlangan kirim va barcha sotuvlar).
CREATE VIEW "reconcile_document_totals" AS
SELECT 'INCOMING'::text AS "document_type", d."id" AS "document_id",
       d."total_quantity" AS "stored_quantity", coalesce(t."qty", 0) AS "items_quantity",
       d."total_amount"   AS "stored_amount",   coalesce(t."amount", 0) AS "items_amount",
       NULL::numeric      AS "stored_cost",     NULL::numeric AS "items_cost"
  FROM "incoming" d
  LEFT JOIN (
    SELECT "incoming_id", sum("quantity") AS "qty", sum("line_total") AS "amount"
      FROM "incoming_items" GROUP BY "incoming_id"
  ) t ON t."incoming_id" = d."id"
 WHERE d."status" = 'CONFIRMED'
   AND (d."total_quantity" <> coalesce(t."qty", 0) OR d."total_amount" <> coalesce(t."amount", 0))
UNION ALL
SELECT 'SALE', s."id",
       s."total_quantity", coalesce(t."qty", 0),
       s."total_amount",   coalesce(t."amount", 0),
       s."total_cost",     coalesce(t."cost", 0)
  FROM "sales" s
  LEFT JOIN (
    SELECT "sale_id", sum("quantity") AS "qty", sum("line_total") AS "amount", sum("line_cost") AS "cost"
      FROM "sale_items" GROUP BY "sale_id"
  ) t ON t."sale_id" = s."id"
 WHERE s."total_quantity" <> coalesce(t."qty", 0)
    OR s."total_amount" <> coalesce(t."amount", 0)
    OR s."total_cost" <> coalesce(t."cost", 0);

-- Mijoz yig'ma ustunlari (cache) = sotuvlardan qayta hisoblangan qiymat.
CREATE VIEW "reconcile_customer_aggregates" AS
SELECT c."id" AS "customer_id",
       c."purchase_count"            AS "stored_purchase_count",
       coalesce(a."cnt", 0)::integer AS "actual_purchase_count",
       c."total_spent"               AS "stored_total_spent",
       coalesce(a."spent", 0)        AS "actual_total_spent",
       c."last_purchase_at"          AS "stored_last_purchase_at",
       a."last_at"                   AS "actual_last_purchase_at"
  FROM "customers" c
  LEFT JOIN (
    SELECT "customer_id", count(*) AS "cnt", sum("total_amount") AS "spent", max("sold_at") AS "last_at"
      FROM "sales" WHERE "status" = 'COMPLETED' GROUP BY "customer_id"
  ) a ON a."customer_id" = c."id"
 WHERE c."purchase_count" <> coalesce(a."cnt", 0)
    OR c."total_spent" <> coalesce(a."spent", 0)
    OR c."last_purchase_at" IS DISTINCT FROM a."last_at";
