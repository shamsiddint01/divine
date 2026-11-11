#!/usr/bin/env bash
# Foydalanuvchiga o'zi tanlagan 6 xonali parolni qo'yadi: scripts/render/set-password.sh <login>.
# Demo saytda: scripts/render/set-password.sh --demo <login> (baza `divine_demo`, demo kalitlari).
# Parol ekranda ko'rinmaydi. Kirish: .env.render, .env.render.secrets (demo: .env.render.demo.secrets).
set -euo pipefail
cd "$(dirname "$0")/../.."

set -a
# shellcheck disable=SC1091
source .env.render
# shellcheck disable=SC1091
source .env.render.secrets
DB_URL="$NEON_OWNER_URL"
if [ "${1:-}" = "--demo" ]; then
  shift
  # Demo saytning o'z PASSWORD_PEPPER'i bor: asosiy saytniki bilan qo'yilgan parol demo'da ishlamaydi.
  # shellcheck disable=SC1091
  source .env.render.demo.secrets
  DB_URL=$(node -e "const u=new URL(process.argv[1]);u.pathname='/divine_demo';console.log(u.href)" "$NEON_OWNER_URL")
fi
set +a
: "${1:?Login kiriting: scripts/render/set-password.sh [--demo] <login>}"

read -rsp "Yangi parol (6 raqam): " NEW_PASSWORD
echo
export NEW_PASSWORD
NODE_ENV=production DATABASE_URL="$DB_URL" npx --yes pnpm@11.21.0 --filter @divine/backend \
  exec tsx src/database/set-password.cli.ts "$1"
