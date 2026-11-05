-- Nasiya (biznes egasi qarori D-24, 2026-11-05): kim, qachon, qancha qarz oldi, to'lov jadvali va haqiqiy
-- to'lovlar. Qoldiq va holat saqlanmaydi — jadval va to'lovlardan hisoblanadi. Faqat ADMIN (`credits.manage`).
CREATE TABLE "credits" (
    "id" UUID NOT NULL DEFAULT uuidv7(),
    "number" BIGINT GENERATED ALWAYS AS IDENTITY,
    "debtor_name" VARCHAR(150) NOT NULL,
    "debtor_phone" VARCHAR(13) NOT NULL,
    "amount" DECIMAL(18,2) NOT NULL,
    "taken_at" TIMESTAMPTZ(3) NOT NULL,
    "note" VARCHAR(1000),
    "created_by" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "credits_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "credits_debtor_name_not_blank" CHECK (btrim("debtor_name") <> ''),
    CONSTRAINT "credits_amount_min" CHECK ("amount" >= 1000 AND "amount" <> 'NaN')
);

CREATE TABLE "credit_installments" (
    "id" UUID NOT NULL DEFAULT uuidv7(),
    "credit_id" UUID NOT NULL,
    "seq" SMALLINT NOT NULL,
    "due_date" DATE NOT NULL,
    "amount" DECIMAL(18,2) NOT NULL,

    CONSTRAINT "credit_installments_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "credit_installments_seq_positive" CHECK ("seq" > 0),
    CONSTRAINT "credit_installments_amount_positive" CHECK ("amount" > 0 AND "amount" <> 'NaN')
);

CREATE TABLE "credit_payments" (
    "id" UUID NOT NULL DEFAULT uuidv7(),
    "credit_id" UUID NOT NULL,
    "payment_date" DATE NOT NULL,
    "amount" DECIMAL(18,2) NOT NULL,
    "note" VARCHAR(1000),
    "created_by" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "credit_payments_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "credit_payments_amount_positive" CHECK ("amount" > 0 AND "amount" <> 'NaN')
);

CREATE UNIQUE INDEX "credits_number_key" ON "credits"("number");
CREATE INDEX "credits_taken_at_idx" ON "credits"("taken_at");
CREATE INDEX "credits_created_by_idx" ON "credits"("created_by");
CREATE UNIQUE INDEX "credit_installments_credit_id_seq_key" ON "credit_installments"("credit_id", "seq");
CREATE INDEX "credit_payments_credit_id_idx" ON "credit_payments"("credit_id");
CREATE INDEX "credit_payments_created_by_idx" ON "credit_payments"("created_by");

ALTER TABLE "credits" ADD CONSTRAINT "credits_created_by_fkey"
  FOREIGN KEY ("created_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "credit_installments" ADD CONSTRAINT "credit_installments_credit_id_fkey"
  FOREIGN KEY ("credit_id") REFERENCES "credits"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "credit_payments" ADD CONSTRAINT "credit_payments_credit_id_fkey"
  FOREIGN KEY ("credit_id") REFERENCES "credits"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "credit_payments" ADD CONSTRAINT "credit_payments_created_by_fkey"
  FOREIGN KEY ("created_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

GRANT SELECT, INSERT, UPDATE, DELETE ON "credits", "credit_installments", "credit_payments" TO "divine_app";
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA "public" TO "divine_app";

-- Mavjud bazalar uchun yangi permission (toza bazada seed ham qo'shadi, takrorlansa zarari yo'q).
INSERT INTO "permissions" ("code", "description")
VALUES ('credits.manage', 'Nasiya: ko‘rish, qo‘shish va to‘lov yozish')
ON CONFLICT ("code") DO NOTHING;

INSERT INTO "role_permissions" ("role_id", "permission_id")
SELECT r."id", p."id"
  FROM "roles" r CROSS JOIN "permissions" p
 WHERE r."code" = 'ADMIN' AND p."code" = 'credits.manage'
ON CONFLICT DO NOTHING;
