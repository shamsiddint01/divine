-- D-24: optom narxi. Mahsulotda ixtiyoriy `wholesale_price`; sotuv hujjatida narx turi.
-- Mavjud mahsulotlar NULL (optom narxi yo'q), mavjud sotuvlar RETAIL bo'lib qoladi.
CREATE TYPE "sale_price_type" AS ENUM ('RETAIL', 'WHOLESALE');

ALTER TABLE "products" ADD COLUMN "wholesale_price" DECIMAL(18,2);
ALTER TABLE "products"
  ADD CONSTRAINT "products_wholesale_price_valid"
  CHECK ("wholesale_price" IS NULL OR ("wholesale_price" > 0 AND "wholesale_price" <> 'NaN'));

ALTER TABLE "sales" ADD COLUMN "price_type" "sale_price_type" NOT NULL DEFAULT 'RETAIL';
