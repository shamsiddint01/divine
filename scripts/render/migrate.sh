#!/usr/bin/env bash
# Neon bazasiga yangi migratsiyalarni qo'llaydi (kod chiqishidan OLDIN). Kirish: .env.render.
set -euo pipefail
cd "$(dirname "$0")/../.."

set -a
# shellcheck disable=SC1091
source .env.render
set +a

# Noutbukdan Frankfurt'gacha ulanish 2–4 soniya: Prisma'ning standart 5 soniyasi yetmay qoladi.
URL=$(node -e "const u=new URL(process.argv[1]);u.searchParams.set('connect_timeout','30');console.log(u.href)" "$NEON_OWNER_URL")

DATABASE_URL="$URL" MIGRATION_DATABASE_URL="$URL" CHECKPOINT_DISABLE=1 \
  npx --yes pnpm@11.21.0 --filter @divine/backend exec prisma migrate deploy
echo "Migratsiya tayyor."
