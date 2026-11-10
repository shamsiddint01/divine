-- Superadmin qo'shimchalari (egasining qarori, 2026-11-10): botdagi sinov arizalari, superadmin kirishlar
-- tarixi, saytda texnik ishlar rejimi va hammani tizimdan chiqarish.
-- Faqat qo'shimcha ustun va jadval: eski kod bilan ham ishlaydi (kod bu migratsiyadan keyin chiqadi).

-- Bepul sinab ko'rish arizasi: Telegram botda ism va telefon qoldiriladi.
CREATE TABLE "control_leads" (
    "id" UUID NOT NULL DEFAULT uuidv7(),
    "number" BIGINT GENERATED ALWAYS AS IDENTITY,
    "chat_id" BIGINT NOT NULL,
    "username" VARCHAR(64),
    "name" VARCHAR(120) NOT NULL,
    "phone" VARCHAR(32) NOT NULL,
    "status" VARCHAR(16) NOT NULL DEFAULT 'NEW',
    "note" VARCHAR(1000),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "control_leads_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "control_leads_status_valid" CHECK ("status" IN ('NEW', 'CALLED', 'CLIENT', 'REJECTED'))
);
CREATE UNIQUE INDEX "control_leads_number_key" ON "control_leads"("number");
CREATE INDEX "control_leads_status_created_at_idx" ON "control_leads"("status", "created_at");
CREATE INDEX "control_leads_chat_id_idx" ON "control_leads"("chat_id");

-- Superadmin'ga kim, qachon, qaysi qurilmadan kirdi (yoki kirolmadi). Kiritilgan login saqlanmaydi.
CREATE TABLE "control_logins" (
    "id" BIGINT GENERATED ALWAYS AS IDENTITY,
    "occurred_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "admin_id" UUID,
    "outcome" VARCHAR(16) NOT NULL,
    "ip" VARCHAR(64),
    "user_agent" VARCHAR(300),
    "new_device" BOOLEAN NOT NULL DEFAULT false,
    CONSTRAINT "control_logins_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "control_logins_outcome_valid"
      CHECK ("outcome" IN ('SUCCESS', 'CODE_SENT', 'BAD_PASSWORD', 'BAD_CODE')),
    CONSTRAINT "control_logins_admin_id_fkey" FOREIGN KEY ("admin_id")
      REFERENCES "control_admins"("id") ON DELETE SET NULL ON UPDATE CASCADE
);
CREATE INDEX "control_logins_occurred_at_idx" ON "control_logins"("occurred_at");

-- Sayt: texnik ishlar rejimi va "hammani chiqarish" vaqti (shundan oldingi tokenlar yaroqsiz).
ALTER TABLE "site_license"
  ADD COLUMN "maintenance" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "maintenance_message" VARCHAR(300),
  ADD COLUMN "sessions_revoked_at" TIMESTAMPTZ(3);

ALTER TABLE "user_sessions" DROP CONSTRAINT "user_sessions_revoked_reason_valid";
ALTER TABLE "user_sessions" ADD CONSTRAINT "user_sessions_revoked_reason_valid" CHECK (
  "revoked_reason" IS NULL
  OR "revoked_reason" IN ('LOGOUT', 'ROTATED', 'REUSE_DETECTED', 'PASSWORD_RESET', 'USER_BLOCKED', 'FORCED_LOGOUT')
);

GRANT SELECT, INSERT, UPDATE ON "control_leads" TO "divine_app";
GRANT SELECT, INSERT ON "control_logins" TO "divine_app";
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA "public" TO "divine_app";
