#!/usr/bin/env bash
# Foydalanuvchiga o'zi tanlagan 6 xonali parolni qo'yadi: scripts/render/set-password.sh <login>.
# Parol ekranda ko'rinmaydi. Kirish: .env.render, .env.render.secrets.
set -euo pipefail
cd "$(dirname "$0")/../.."

set -a
# shellcheck disable=SC1091
source .env.render
# shellcheck disable=SC1091
source .env.render.secrets
set +a

read -rsp "Yangi parol (6 raqam): " NEW_PASSWORD
echo
export NEW_PASSWORD
NODE_ENV=production DATABASE_URL="$NEON_OWNER_URL" npx --yes pnpm@11.21.0 --filter @divine/backend \
  exec tsx src/database/set-password.cli.ts "$1"
