#!/usr/bin/env bash
# Neon bazasini bir marta tayyorlaydi (docs/RUNBOOK-RENDER.md): migratsiya, divine_api roli, seed, birinchi ADMIN.
# Kirish: .env.render (NEON_OWNER_URL, REDIS_URL, ADMIN_LOGIN). Chiqish: .env.render.secrets (Render panelidagi qiymatlar).
# Ikkala fayl ham .gitignore'da (.env.*). Qayta ishga tushirish xavfsiz: secretlar saqlanadi, migratsiya va seed idempotent.
set -euo pipefail
cd "$(dirname "$0")/../.."

set -a
# shellcheck disable=SC1091
source .env.render
set +a
: "${NEON_OWNER_URL:?.env.render ichida NEON_OWNER_URL yo\'q}"
: "${REDIS_URL:?.env.render ichida REDIS_URL yo\'q}"
ADMIN_LOGIN="${ADMIN_LOGIN:-admin}"

# Neon'ning -pooler manzili `options` startup parametrini qabul qilmaydi (pg-connection.ts: timezone=UTC).
case "$NEON_OWNER_URL" in
  *-pooler.*) echo "NEON_OWNER_URL pooled: Neon panelida 'Connection pooling'ni o'chirib, to'g'ridan-to'g'ri manzilni oling" >&2; exit 1 ;;
esac

SECRETS=.env.render.secrets
if [ ! -f "$SECRETS" ]; then
  umask 077
  APP_PASSWORD=$(openssl rand -hex 32)
  DATABASE_URL=$(APP_PASSWORD="$APP_PASSWORD" node -e "const u=new URL(process.env.NEON_OWNER_URL);u.username='divine_api';u.password=process.env.APP_PASSWORD;console.log(u.href)")
  {
    echo "APP_PASSWORD=$APP_PASSWORD"
    echo "DATABASE_URL=$DATABASE_URL"
    echo "REDIS_URL=$REDIS_URL"
    echo "JWT_ACCESS_SECRET=$(openssl rand -hex 32)"
    echo "PASSWORD_PEPPER=$(openssl rand -hex 32)"
  } > "$SECRETS"
fi
set -a
# shellcheck disable=SC1090
source "$SECRETS"
set +a

psql_owner() { docker run --rm -i --network host postgres:18-alpine psql "$NEON_OWNER_URL" -v ON_ERROR_STOP=1 -q "$@"; }

echo "1/4 Migratsiyalar"
DATABASE_URL="$NEON_OWNER_URL" MIGRATION_DATABASE_URL="$NEON_OWNER_URL" CHECKPOINT_DISABLE=1 \
  npx --yes pnpm@11.21.0 --filter @divine/backend exec prisma migrate deploy

echo "2/4 divine_api roli"
psql_owner <<SQL
DO \$\$ BEGIN
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'divine_api') THEN
    CREATE ROLE divine_api LOGIN PASSWORD '$APP_PASSWORD' IN ROLE divine_app;
  END IF;
END \$\$;
SQL

echo "3/4 Ma'lumotnoma seed'i"
NODE_ENV=production DATABASE_URL="$NEON_OWNER_URL" npx --yes pnpm@11.21.0 --filter @divine/backend db:seed

echo "4/4 Birinchi ADMIN (parol faqat shu yerda bir marta chiqadi)"
status=0
NODE_ENV=production DATABASE_URL="$NEON_OWNER_URL" \
  npx --yes pnpm@11.21.0 --filter @divine/backend db:bootstrap-admin --login "$ADMIN_LOGIN" || status=$?
if [ "$status" -ne 0 ] && [ "$status" -ne 3 ]; then exit "$status"; fi

echo "Tayyor. Render panelidagi qiymatlar: $SECRETS"
