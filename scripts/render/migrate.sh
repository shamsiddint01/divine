#!/usr/bin/env bash
# Neon bazasiga yangi migratsiyalarni qo'llaydi (kod chiqishidan OLDIN). Kirish: .env.render.
set -euo pipefail
cd "$(dirname "$0")/../.."

set -a
# shellcheck disable=SC1091
source .env.render
set +a

DATABASE_URL="$NEON_OWNER_URL" MIGRATION_DATABASE_URL="$NEON_OWNER_URL" CHECKPOINT_DISABLE=1 \
  npx --yes pnpm@11.21.0 --filter @divine/backend exec prisma migrate deploy
echo "Migratsiya tayyor."
