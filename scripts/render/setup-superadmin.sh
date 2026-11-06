#!/usr/bin/env bash
# Superadmin hisobi va birinchi saytni yaratadi: scripts/render/setup-superadmin.sh <login>.
# Migratsiyalar ham shu yerda. Parol ekranda ko'rinmaydi. Kirish: .env.render, .env.render.secrets.
set -euo pipefail
cd "$(dirname "$0")/../.."

set -a
# shellcheck disable=SC1091
source .env.render
# shellcheck disable=SC1091
source .env.render.secrets
set +a

read -rsp "Superadmin paroli (kamida 10 belgi): " NEW_PASSWORD
echo
read -rp "Saytning egasi (ism): " OWNER_NAME
export NEW_PASSWORD OWNER_NAME
export SITE_URL=https://divine-uz-web.onrender.com API_URL=https://divine-uz-api.onrender.com

DATABASE_URL="$NEON_OWNER_URL" MIGRATION_DATABASE_URL="$NEON_OWNER_URL" CHECKPOINT_DISABLE=1 \
  npx --yes pnpm@11.21.0 --filter @divine/backend exec prisma migrate deploy
NODE_ENV=production DATABASE_URL="$NEON_OWNER_URL" npx --yes pnpm@11.21.0 --filter @divine/backend \
  exec tsx src/database/setup-superadmin.cli.ts "$1"
