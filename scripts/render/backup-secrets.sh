#!/usr/bin/env bash
# GitHub'ga kiritiladigan 3 ta bekap kalitini chiqaradi (docs/RUNBOOK-RENDER.md, "Bekap").
# BACKUP_PASSPHRASE bir marta yaratiladi va .env.render.secrets'da saqlanadi: usiz nusxani ochib bo'lmaydi.
set -euo pipefail
cd "$(dirname "$0")/../.."

set -a
# shellcheck disable=SC1091
source .env.render
# shellcheck disable=SC1091
source .env.render.secrets
set +a

if [ -z "${BACKUP_PASSPHRASE:-}" ]; then
  BACKUP_PASSPHRASE=$(openssl rand -hex 24)
  echo "BACKUP_PASSPHRASE=$BACKUP_PASSPHRASE" >> .env.render.secrets
fi
TOKEN=$(node -e "console.log(require('crypto').createHmac('sha256', process.env.JWT_ACCESS_SECRET).update('divine.uz/site-control').digest('hex'))")

echo
echo "GitHub → Settings → Secrets and variables → Actions → New repository secret"
echo
echo "1) Name: BACKUP_DATABASE_URL"
echo "   Secret: $NEON_OWNER_URL"
echo
echo "2) Name: BACKUP_PASSPHRASE"
echo "   Secret: $BACKUP_PASSPHRASE"
echo
echo "3) Name: SITE_CONTROL_TOKEN"
echo "   Secret: $TOKEN"
echo
echo "BACKUP_PASSPHRASE'ni yo'qotmang: nusxani faqat u bilan ochish mumkin (.env.render.secrets'da ham bor)."
