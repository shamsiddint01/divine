-- Optom va dona narxi (biznes egasi qarori D-25, 2026-11-05). Mahsulotda ikkala narx ixtiyoriy, kamida bittasi
-- bo'lishi shart. Sotuv hujjatida narx turi; mavjud sotuvlar RETAIL (dona) bo'lib qoladi.
CREATE TYPE "sale_price_type" AS ENUM ('RETAIL', 'WHOLESALE');

ALTER TABLE "products" ADD COLUMN "wholesale_price" DECIMAL(18,2);
ALTER TABLE "products" ALTER COLUMN "sale_price" DROP NOT NULL;
ALTER TABLE "products"
  ADD CONSTRAINT "products_wholesale_price_valid"
    CHECK ("wholesale_price" IS NULL OR ("wholesale_price" > 0 AND "wholesale_price" <> 'NaN')),
  ADD CONSTRAINT "products_price_required"
    CHECK ("sale_price" IS NOT NULL OR "wholesale_price" IS NOT NULL);

ALTER TABLE "sales" ADD COLUMN "price_type" "sale_price_type" NOT NULL DEFAULT 'RETAIL';
