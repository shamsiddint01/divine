-- Bepul sinab ko'rish: bot demo saytda hisob ochadi (control_trials — asosiy bazada, demo_accounts — demo bazada).
-- Faqat yangi jadvallar: eski kod bilan ham ishlaydi (kod bu migratsiyadan keyin chiqadi).

CREATE TABLE "control_trials" (
    "id" UUID NOT NULL DEFAULT uuidv7(),
    "lead_id" UUID NOT NULL,
    "chat_id" BIGINT NOT NULL,
    "phone" VARCHAR(32) NOT NULL,
    "site_id" UUID NOT NULL,
    "login" VARCHAR(32) NOT NULL,
    "expires_at" TIMESTAMPTZ(3) NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "control_trials_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "control_trials_lead_id_key" ON "control_trials"("lead_id");
CREATE INDEX "control_trials_chat_id_idx" ON "control_trials"("chat_id");
CREATE INDEX "control_trials_phone_idx" ON "control_trials"("phone");

CREATE TABLE "demo_accounts" (
    "user_id" UUID NOT NULL,
    "expires_at" TIMESTAMPTZ(3) NOT NULL,
    "used_seconds" INTEGER NOT NULL DEFAULT 0,
    "last_seen_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "demo_accounts_pkey" PRIMARY KEY ("user_id"),
    CONSTRAINT "demo_accounts_used_seconds_valid" CHECK ("used_seconds" >= 0),
    CONSTRAINT "demo_accounts_user_id_fkey" FOREIGN KEY ("user_id")
      REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

GRANT SELECT, INSERT ON "control_trials" TO "divine_app";
GRANT SELECT, INSERT, UPDATE ON "demo_accounts" TO "divine_app";
