#!/bin/sh
# Divine.uz — production DB rollari (DATABASE.md §6, Phase 17). postgres image'ining initdb bosqichida
# (faqat bo'sh data katalogida) BIR MARTA ishlaydi:
#   divine_owner — LOGIN, baza va `public` sxema egasi: migratsiyalar (MIGRATION_DATABASE_URL);
#   divine_app   — NOLOGIN guruh: huquqlar migratsiyada aniq beriladi (ledger/audit — faqat SELECT, INSERT);
#   divine_api   — LOGIN, divine_app a'zosi: ilova runtime'i (DATABASE_URL). Superuser EMAS.
# Parollarni psql o'zi Docker secrets fayllaridan o'qiydi (argument, env yoki shell'da emas) va :'...'
# bilan literal sifatida qo'yadi. Statement log'i o'chiriladi: xato bo'lsa ham parol log'ga tushmasin.
set -eu

for file in "$DB_OWNER_PASSWORD_FILE" "$DB_API_PASSWORD_FILE"; do
  [ -s "$file" ] || { echo "init-roles: parol fayli yo‘q yoki bo‘sh: $file" >&2; exit 1; }
done

psql -v ON_ERROR_STOP=1 --no-psqlrc --username "$POSTGRES_USER" --dbname postgres -v db="$POSTGRES_DB" <<SQL
SET log_statement = 'none';
SET log_min_error_statement = 'panic';
\\set owner_password \`cat "$DB_OWNER_PASSWORD_FILE"\`
\\set api_password \`cat "$DB_API_PASSWORD_FILE"\`
CREATE ROLE divine_owner LOGIN PASSWORD :'owner_password';
CREATE ROLE divine_app NOLOGIN;
CREATE ROLE divine_api LOGIN PASSWORD :'api_password' IN ROLE divine_app;
ALTER DATABASE :"db" OWNER TO divine_owner;
-- Bazaga faqat aniq ruxsat berilgan rollar ulanadi (PUBLIC'dan olib tashlanadi).
REVOKE ALL ON DATABASE :"db" FROM PUBLIC;
GRANT CONNECT ON DATABASE :"db" TO divine_owner;
SQL

psql -v ON_ERROR_STOP=1 --no-psqlrc --username "$POSTGRES_USER" --dbname "$POSTGRES_DB" <<'SQL'
-- PG15+: `public` sxema egasi — pg_database_owner (= divine_owner). PUBLIC'ga CREATE yo'q.
REVOKE CREATE ON SCHEMA public FROM PUBLIC;
SQL
echo 'init-roles: divine_owner, divine_app, divine_api yaratildi'
