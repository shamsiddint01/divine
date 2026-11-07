-- To'lov balansi, admin to'lov bo'limi, qo'lda blok va yengillik, superadmin jurnali.
-- Faqat qo'shimcha ustun va jadval: eski kod bilan ham ishlaydi (kod bu migratsiyadan keyin chiqadi).

-- Panel: kelishilgan narxdan ortiq yoki kam to'lov balansda turadi; har to'liq narx — bir oy.
ALTER TABLE "control_sites"
  ADD COLUMN "balance" DECIMAL(18,2) NOT NULL DEFAULT 0,
  ADD COLUMN "manual_block" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "grace_until" DATE,
  ADD CONSTRAINT "control_sites_balance_valid" CHECK ("balance" >= 0 AND "balance" <> 'NaN');

-- Sayt: admin to'lov bo'limida ko'rinadigan nusxa (panel yuboradi).
ALTER TABLE "site_license"
  ADD COLUMN "agreed_price" DECIMAL(18,2),
  ADD COLUMN "balance" DECIMAL(18,2) NOT NULL DEFAULT 0,
  ADD COLUMN "last_paid_at" DATE,
  ADD COLUMN "manual_block" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "grace_until" DATE,
  ADD COLUMN "payments" JSONB NOT NULL DEFAULT '[]';

-- Superadmin harakatlari: kim qachon to'lov yozdi, muddat o'zgartirdi, saytni ko'rdi.
CREATE TABLE "control_events" (
    "id" BIGINT GENERATED ALWAYS AS IDENTITY,
    "occurred_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "site_id" UUID,
    "action" VARCHAR(64) NOT NULL,
    "details" JSONB NOT NULL DEFAULT '{}',
    CONSTRAINT "control_events_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "control_events_site_id_fkey" FOREIGN KEY ("site_id")
      REFERENCES "control_sites"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE INDEX "control_events_occurred_at_idx" ON "control_events"("occurred_at");

GRANT SELECT, INSERT ON "control_events" TO "divine_app";
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA "public" TO "divine_app";
