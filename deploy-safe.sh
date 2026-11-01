#!/usr/bin/env bash
set -Eeuo pipefail

SERVER="root@167.86.79.82"
SSH_PORT="22004"
APP="/var/www/divine"
DOMAIN="talaba4.auto-message.uz"

echo "========================================"
echo "       DIVINE.UZ SAFE DEPLOY"
echo "========================================"

echo
echo "[1/7] LOCAL PROJECT CHECK"

for file in \
  docker-compose.prod.yml \
  .env.prod.example \
  scripts/prod/init-secrets.sh \
  backend/prisma/schema.prisma \
  backend/dist/main.js \
  frontend/dist/index.html \
  shared/dist/index.js
do
  if [[ ! -e "$file" ]]; then
    echo "XATO: $file topilmadi"
    exit 1
  fi
done

echo "Local build va production fayllari mavjud."

echo
echo "[2/7] SERVER CONNECTION AND READ-ONLY CHECKS"

ssh -p "$SSH_PORT" "$SERVER" \
  "APP='$APP' DOMAIN='$DOMAIN' bash -s" <<'REMOTE'
set -Eeuo pipefail

echo "OS:"
. /etc/os-release
echo "$PRETTY_NAME"

echo
echo "RAM:"
free -h

echo
echo "Disk:"
df -h /

echo
echo "Services:"
systemctl is-active nginx || true
systemctl is-active redis-server || true

echo
echo "Existing PostgreSQL:"
psql --version 2>/dev/null || true

echo
echo "Docker:"
docker --version 2>/dev/null || echo "Docker o'rnatilmagan"

echo
echo "Existing app files:"
test -f "$APP/backend/dist/main.js" \
  && echo "Backend build: OK" \
  || echo "Backend build: MISSING"

echo
echo "Nginx config:"
nginx -t

REMOTE

echo
echo "[3/7] BUILD CHECK"

pnpm install --frozen-lockfile
pnpm --filter @divine/shared build
pnpm --filter @divine/backend db:generate
pnpm --filter @divine/backend build
pnpm --filter @divine/frontend build

echo
echo "[4/7] DEPLOY BUILD FILES"

ssh -p "$SSH_PORT" "$SERVER" \
  "mkdir -p '$APP/releases' '$APP/backend' '$APP/frontend' '$APP/shared'"

rsync -az --delete \
  -e "ssh -p $SSH_PORT" \
  backend/dist/ "$SERVER:$APP/backend/dist/"

rsync -az --delete \
  -e "ssh -p $SSH_PORT" \
  frontend/dist/ "$SERVER:$APP/frontend/"

rsync -az --delete \
  -e "ssh -p $SSH_PORT" \
  shared/dist/ "$SERVER:$APP/shared/dist/"

echo
echo "[5/7] SYNC PROJECT MANIFESTS"

rsync -az -e "ssh -p $SSH_PORT" \
  package.json pnpm-lock.yaml pnpm-workspace.yaml \
  "$SERVER:$APP/"

rsync -az -e "ssh -p $SSH_PORT" \
  backend/package.json "$SERVER:$APP/backend/"

rsync -az -e "ssh -p $SSH_PORT" \
  frontend/package.json "$SERVER:$APP/frontend/"

rsync -az -e "ssh -p $SSH_PORT" \
  shared/package.json "$SERVER:$APP/shared/"

echo
echo "[6/7] SERVER FINAL SAFETY CHECK"

ssh -p "$SSH_PORT" "$SERVER" \
  "APP='$APP' bash -s" <<'REMOTE'
set -Eeuo pipefail

echo "Backend:"
test -f "$APP/backend/dist/main.js"

echo "Frontend:"
test -f "$APP/frontend/dist/index.html"

echo "Shared:"
test -f "$APP/shared/dist/index.js"

echo
echo "Nginx:"
nginx -t

echo
echo "Redis:"
redis-cli ping

echo
echo "PostgreSQL version:"
psql -h 10.77.0.2 -p 5432 -U talaba04 -d talaba04 \
  -Atqc 'SHOW server_version' 2>/dev/null || true

echo
echo "Systemd:"
systemctl is-active divine-backend 2>/dev/null || \
  echo "Backend service hali yaratilmagan."

REMOTE

echo
echo "[7/7] DEPLOY SUMMARY"

echo "Build serverga joylandi."
echo "Database o'zgartirilmadi."
echo "Nginx konfiguratsiyasi o'zgartirilmadi."
echo "Redis konfiguratsiyasi o'zgartirilmadi."
echo "Backend service ishga tushirilmadi."
echo "HTTPS sozlanmadi."

echo
echo "SAFE DEPLOY CHECK TUGADI."
