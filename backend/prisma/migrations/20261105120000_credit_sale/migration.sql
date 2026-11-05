-- Kassadan nasiya (D-26): mijoz puli yetmasa, qolgan summa sotuvga bog'langan nasiyaga yoziladi.
-- Bitta sotuvda bittadan ortiq nasiya bo'lmaydi; qo'lda qo'shilgan nasiyada `sale_id` bo'sh.
ALTER TABLE "credits" ADD COLUMN "sale_id" UUID;

CREATE UNIQUE INDEX "credits_sale_id_key" ON "credits"("sale_id");

ALTER TABLE "credits" ADD CONSTRAINT "credits_sale_id_fkey"
  FOREIGN KEY ("sale_id") REFERENCES "sales"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
