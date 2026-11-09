-- Murojaat bo'limi: foydalanuvchi xabari va avtomatik xato xabarlari, javoblar, savol-javob bahosi.
-- Faqat yangi jadvallar: eski kod bilan ham ishlaydi (kod bu migratsiyadan keyin chiqadi).

CREATE TABLE "support_tickets" (
    "id" UUID NOT NULL DEFAULT uuidv7(),
    "number" BIGINT GENERATED ALWAYS AS IDENTITY,
    "kind" VARCHAR(16) NOT NULL DEFAULT 'MANUAL',
    "status" VARCHAR(16) NOT NULL DEFAULT 'NEW',
    "user_id" UUID,
    "user_login" VARCHAR(64),
    "message" VARCHAR(2000) NOT NULL,
    "page" VARCHAR(300),
    "error_code" VARCHAR(64),
    "request_id" VARCHAR(64),
    "user_agent" VARCHAR(300),
    "fingerprint" CHAR(64),
    "occurrences" INTEGER NOT NULL DEFAULT 1,
    "telegram_message_id" BIGINT,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "support_tickets_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "support_tickets_kind_valid" CHECK ("kind" IN ('MANUAL', 'AUTO')),
    CONSTRAINT "support_tickets_status_valid" CHECK ("status" IN ('NEW', 'SEEN', 'RESOLVED')),
    CONSTRAINT "support_tickets_user_id_fkey" FOREIGN KEY ("user_id")
      REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "support_tickets_number_key" ON "support_tickets"("number");
CREATE INDEX "support_tickets_status_created_at_idx" ON "support_tickets"("status", "created_at");
CREATE INDEX "support_tickets_user_id_created_at_idx" ON "support_tickets"("user_id", "created_at");
CREATE INDEX "support_tickets_fingerprint_idx" ON "support_tickets"("fingerprint");
CREATE INDEX "support_tickets_telegram_message_id_idx" ON "support_tickets"("telegram_message_id");

CREATE TABLE "support_replies" (
    "id" UUID NOT NULL DEFAULT uuidv7(),
    "ticket_id" UUID NOT NULL,
    "author" VARCHAR(16) NOT NULL,
    "body" VARCHAR(2000) NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "support_replies_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "support_replies_author_valid" CHECK ("author" IN ('USER', 'SUPPORT')),
    CONSTRAINT "support_replies_ticket_id_fkey" FOREIGN KEY ("ticket_id")
      REFERENCES "support_tickets"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE INDEX "support_replies_ticket_id_created_at_idx" ON "support_replies"("ticket_id", "created_at");

-- Savol-javob bahosi ("Yordam berdimi?"): qaysi javobni yaxshilash kerakligini ko'rsatadi.
CREATE TABLE "support_feedback" (
    "id" BIGINT GENERATED ALWAYS AS IDENTITY,
    "topic" VARCHAR(64) NOT NULL,
    "helpful" BOOLEAN NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "support_feedback_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "support_feedback_topic_idx" ON "support_feedback"("topic");

GRANT SELECT, INSERT, UPDATE ON "support_tickets" TO "divine_app";
GRANT SELECT, INSERT ON "support_replies", "support_feedback" TO "divine_app";
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA "public" TO "divine_app";
