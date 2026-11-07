#!/usr/bin/env bash
# Live saytning biznes ma'lumotlarini tozalaydi. Avval to'liq nusxa oladi: nusxasiz tozalanmaydi.
# Nusxa backups/ ichida (.gitignore). Qaytarib bo'lmaydi: faqat shu nusxadan tiklanadi.
set -euo pipefail
cd "$(dirname "$0")/../.."

set -a
# shellcheck disable=SC1091
source .env.render
set +a

mkdir -p backups
DUMP="backups/before-clear-$(date +%Y%m%d-%H%M%S).dump"
echo "1/2 Nusxa olinmoqda: $DUMP"
docker run --rm --network host --dns 1.1.1.1 -e U="$NEON_OWNER_URL" postgres:18-alpine \
  sh -c 'pg_dump "$U" -Fc' > "$DUMP"
if [ "$(stat -c %s "$DUMP")" -lt 10000 ]; then
  echo "Nusxa olinmadi, hech narsa tozalanmadi" >&2
  exit 1
fi

read -rp "Mahsulot, ombor, sotuv, mijoz, nasiya va xarajatlar o'chiriladi. Tasdiqlash uchun HA deb yozing: " ANSWER
if [ "$ANSWER" != "HA" ]; then
  echo "Bekor qilindi, hech narsa o'chirilmadi"
  exit 0
fi

echo "2/2 Tozalanmoqda"
CONFIRM_CLEAR=HA DATABASE_URL="$NEON_OWNER_URL" npx --yes pnpm@11.21.0 --filter @divine/backend \
  exec tsx src/database/clear-business-data.cli.ts
