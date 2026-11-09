#!/usr/bin/env bash
# Shu saytning superadmin kaliti (`x-control-token`): panelga "Sayt kaliti" sifatida yoziladi.
# Kalit JWT_ACCESS_SECRET'dan hosil qilinadi (control-token.guard.ts). Kirish: .env.render.secrets.
set -euo pipefail
cd "$(dirname "$0")/../.."

set -a
# shellcheck disable=SC1091
source .env.render.secrets
set +a

echo "Sayt: https://divine-uz-web.onrender.com"
echo "API:  https://divine-uz-api.onrender.com"
node -e "console.log('Kalit: ' + require('crypto').createHmac('sha256', process.env.JWT_ACCESS_SECRET).update('divine.uz/site-control').digest('hex'))"
