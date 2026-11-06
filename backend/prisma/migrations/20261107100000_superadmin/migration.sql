-- Superadmin: saytning to'lov muddati (blok shu yerdan hisoblanadi), ko'rish kodlari va
-- egasining paneli uchun saytlar va to'lovlar. Panel o'chiq saytda `control_*` bo'sh qoladi.
CREATE TABLE "site_license" (
    "id" SMALLINT NOT NULL DEFAULT 1,
    "owner_name" VARCHAR(200) NOT NULL,
    "paid_until" DATE NOT NULL,
    "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "site_license_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "site_license_single_row" CHECK ("id" = 1)
);

CREATE TABLE "site_access_requests" (
    "id" UUID NOT NULL DEFAULT uuidv7(),
    "code" CHAR(6) NOT NULL,
    "attempts" SMALLINT NOT NULL DEFAULT 0,
    "expires_at" TIMESTAMPTZ(3) NOT NULL,
    "used_at" TIMESTAMPTZ(3),
    "denied_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "site_access_requests_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "control_admins" (
    "id" UUID NOT NULL DEFAULT uuidv7(),
    "login" VARCHAR(32) NOT NULL,
    "password_hash" VARCHAR(255) NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "control_admins_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "control_admins_login_key" ON "control_admins"("login");

CREATE TABLE "control_sites" (
    "id" UUID NOT NULL DEFAULT uuidv7(),
    "name" VARCHAR(200) NOT NULL,
    "site_url" VARCHAR(300) NOT NULL,
    "api_url" VARCHAR(300) NOT NULL,
    "api_token" VARCHAR(200) NOT NULL,
    "owner_name" VARCHAR(200) NOT NULL,
    "owner_phone" VARCHAR(32),
    "agreed_price" DECIMAL(18,2) NOT NULL,
    "paid_until" DATE NOT NULL,
    "notes" VARCHAR(1000),
    "license_synced_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "control_sites_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "control_sites_price_valid" CHECK ("agreed_price" >= 0 AND "agreed_price" <> 'NaN')
);

CREATE TABLE "control_payments" (
    "id" UUID NOT NULL DEFAULT uuidv7(),
    "site_id" UUID NOT NULL,
    "amount" DECIMAL(18,2) NOT NULL,
    "paid_at" DATE NOT NULL,
    "paid_until" DATE NOT NULL,
    "note" VARCHAR(500),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "control_payments_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "control_payments_amount_valid" CHECK ("amount" > 0 AND "amount" <> 'NaN'),
    CONSTRAINT "control_payments_site_id_fkey" FOREIGN KEY ("site_id")
      REFERENCES "control_sites"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE INDEX "control_payments_site_id_paid_at_idx" ON "control_payments"("site_id", "paid_at");

GRANT SELECT, INSERT, UPDATE, DELETE ON
  "site_license", "site_access_requests", "control_admins", "control_sites", "control_payments"
  TO "divine_app";
