#!/usr/bin/env bash
# Umumiy demo saytni bir marta tayyorlaydi (bepul sinab ko'rish, docs/RUNBOOK-RENDER.md "Demo sayt"):
# Neon'dagi o'sha loyihada alohida `divine_demo` bazasi, migratsiya, seed, egasining ADMIN hisobi va
# superadmin paneliga "Demo" sayti. Kirish: .env.render, .env.render.secrets. Chiqish: .env.render.demo.secrets.
# Qayta ishga tushirish xavfsiz: baza, secretlar va panel yozuvi saqlanadi.
set -euo pipefail
cd "$(dirname "$0")/../.."

set -a
# shellcheck disable=SC1091
source .env.render
# shellcheck disable=SC1091
source .env.render.secrets
set +a
: "${NEON_OWNER_URL:?.env.render ichida NEON_OWNER_URL yo\'q}"
: "${APP_PASSWORD:?.env.render.secrets ichida APP_PASSWORD yo\'q (avval setup-db.sh)}"
ADMIN_LOGIN="${ADMIN_LOGIN:-admin}"
DEMO_DB=divine_demo
DEMO_SITE_URL=https://divine-uz-demo-web.onrender.com
DEMO_API_URL=https://divine-uz-demo-api.onrender.com

url_with_db() { node -e "const u=new URL(process.argv[1]);u.pathname='/'+process.argv[2];if(process.argv[3]){u.username=process.argv[3];u.password=process.argv[4]}console.log(u.href)" "$@"; }
DEMO_OWNER_URL=$(url_with_db "$NEON_OWNER_URL" "$DEMO_DB")
psql_url() { local url=$1; shift; docker run --rm -i --network host postgres:18-alpine psql "$url" -v ON_ERROR_STOP=1 -qtA "$@"; }

SECRETS=.env.render.demo.secrets
if [ ! -f "$SECRETS" ]; then
  umask 077
  {
    echo "DATABASE_URL=$(url_with_db "$NEON_OWNER_URL" "$DEMO_DB" divine_api "$APP_PASSWORD")"
    # Alohida Upstash bazasi bo'lsa — .env.render'da DEMO_REDIS_URL; bo'lmasa asosiy sayt Redis'i.
    echo "REDIS_URL=${DEMO_REDIS_URL:-$REDIS_URL}"
    echo "JWT_ACCESS_SECRET=$(openssl rand -hex 32)"
    echo "PASSWORD_PEPPER=$(openssl rand -hex 32)"
  } > "$SECRETS"
fi
set -a
# shellcheck disable=SC1090
source "$SECRETS"
set +a

echo "1/5 $DEMO_DB bazasi"
if [ -z "$(psql_url "$NEON_OWNER_URL" -c "SELECT 1 FROM pg_database WHERE datname = '$DEMO_DB'")" ]; then
  psql_url "$NEON_OWNER_URL" -c "CREATE DATABASE $DEMO_DB"
fi

echo "2/5 Migratsiyalar (demo va asosiy baza)"
for url in "$DEMO_OWNER_URL" "$NEON_OWNER_URL"; do
  DATABASE_URL="$url" MIGRATION_DATABASE_URL="$url" CHECKPOINT_DISABLE=1 \
    npx --yes pnpm@11.21.0 --filter @divine/backend exec prisma migrate deploy
done

echo "3/5 Ma'lumotnoma seed'i"
NODE_ENV=production DATABASE_URL="$DEMO_OWNER_URL" npx --yes pnpm@11.21.0 --filter @divine/backend db:seed

echo "4/5 Sizning ADMIN hisobingiz demo saytda (parol faqat shu yerda bir marta chiqadi)"
status=0
NODE_ENV=production DATABASE_URL="$DEMO_OWNER_URL" \
  npx --yes pnpm@11.21.0 --filter @divine/backend db:bootstrap-admin --login "$ADMIN_LOGIN" || status=$?
if [ "$status" -ne 0 ] && [ "$status" -ne 3 ]; then exit "$status"; fi

echo "5/5 Superadmin paneliga Demo sayti"
API_TOKEN=$(node -e "console.log(require('crypto').createHmac('sha256', process.argv[1]).update('divine.uz/site-control').digest('hex'))" "$JWT_ACCESS_SECRET")
SITE_ID=$(psql_url "$NEON_OWNER_URL" <<SQL
UPDATE control_sites SET api_token = '$API_TOKEN' WHERE api_url = '$DEMO_API_URL';
INSERT INTO control_sites (name, site_url, api_url, api_token, owner_name, agreed_price, paid_until)
SELECT 'Demo (bepul sinov)', '$DEMO_SITE_URL', '$DEMO_API_URL', '$API_TOKEN', 'Divine', 0, DATE '2099-12-31'
WHERE NOT EXISTS (SELECT 1 FROM control_sites WHERE api_url = '$DEMO_API_URL');
SELECT id FROM control_sites WHERE api_url = '$DEMO_API_URL';
SQL
)

echo
echo "Tayyor. Render'da:"
echo "  divine-uz-demo-api → Environment: $SECRETS dagi 4 ta qiymat"
echo "  divine-uz-api (asosiy) → Environment: DEMO_SITE_ID=$SITE_ID"
