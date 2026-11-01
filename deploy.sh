#!/usr/bin/env bash
set -Eeuo pipefail

# ==========================================
# DIVINE.UZ PRODUCTION DEPLOYMENT
# Run on laptop inside ~/Desktop/divine.uz
# ==========================================

SERVER="root@167.86.79.82"
SSH_PORT="22004"
DOMAIN="talaba4.auto-message.uz"
REMOTE_DIR="/var/www/divine"
API_PORT="3000"

SSH=(ssh -p "$SSH_PORT" -o ServerAliveInterval=30 "$SERVER")
SCP=(scp -P "$SSH_PORT")

fail() {
  echo
  echo "[ERROR] $1"
  exit 1
}

echo "=========================================="
echo "       DIVINE.UZ DEPLOYMENT"
echo "=========================================="

# 1. Project checks
echo "[1/10] Project checks"

[ -f package.json ] || fail "Root package.json topilmadi"
[ -f pnpm-lock.yaml ] || fail "pnpm-lock.yaml topilmadi"
[ -f backend/package.json ] || fail "Backend topilmadi"
[ -f frontend/package.json ] || fail "Frontend topilmadi"
[ -f shared/package.json ] || fail "Shared topilmadi"

git diff --quiet || fail "Git tracked fayllarda saqlanmagan o'zgarishlar bor"
git diff --cached --quiet || fail "Git staged o'zgarishlar bor"

# 2. Local environment check
echo "[2/10] Environment checks"

if [ ! -f .env ]; then
  fail "Root .env topilmadi. Production build uchun kerakli VITE qiymatlarini tekshiring."
fi

if grep -qE '^(VITE_API_MODE|VITE_API_BASE_URL)=' .env; then
  echo "Frontend environment keys topildi."
else
  fail "Root .env ichida frontend API sozlamalari topilmadi."
fi

# 3. Dependencies
echo "[3/10] Installing dependencies"

pnpm install --frozen-lockfile

# 4. Shared build
echo "[4/10] Building shared package"

pnpm --filter @divine/shared build

# 5. Prisma client generation
echo "[5/10] Generating Prisma client"

pnpm --filter @divine/backend db:generate

# 6. Frontend + backend builds
echo "[6/10] Building production packages"

pnpm --filter @divine/backend build
pnpm --filter @divine/frontend build

[ -f backend/dist/main.js ] || fail "Backend build natijasi topilmadi"
[ -d frontend/dist ] || fail "Frontend build natijasi topilmadi"

# 7. Server checks
echo "[7/10] Checking remote server"

"${SSH[@]}" 'set -e
node --version
pnpm --version
nginx -t
redis-cli ping
'

# 8. Prepare remote folders
echo "[8/10] Preparing remote directories"

"${SSH[@]}" "mkdir -p '$REMOTE_DIR/backend' '$REMOTE_DIR/frontend' '$REMOTE_DIR/shared' '$REMOTE_DIR/releases'"

# 9. Transfer build artifacts
echo "[9/10] Transferring application files"

rsync -az --delete \
  -e "ssh -p $SSH_PORT" \
  backend/dist/ "$SERVER:$REMOTE_DIR/backend/dist/"

rsync -az --delete \
  -e "ssh -p $SSH_PORT" \
  frontend/dist/ "$SERVER:$REMOTE_DIR/frontend/dist/"

rsync -az --delete \
  -e "ssh -p $SSH_PORT" \
  shared/dist/ "$SERVER:$REMOTE_DIR/shared/dist/"

# Transfer package manifests and lockfile
"${SCP[@]}" package.json pnpm-lock.yaml pnpm-workspace.yaml "$SERVER:$REMOTE_DIR/"
"${SCP[@]}" backend/package.json "$SERVER:$REMOTE_DIR/backend/"
"${SCP[@]}" frontend/package.json "$SERVER:$REMOTE_DIR/frontend/"
"${SCP[@]}" shared/package.json "$SERVER:$REMOTE_DIR/shared/"

echo
echo "=========================================="
echo "BUILD VA FAYLLARNI KO'CHIRISH TUGADI"
echo "=========================================="

# 10. Final status
"${SSH[@]}" "
echo '--- Server resources ---'
free -h
df -h /
echo
echo '--- Application files ---'
find '$REMOTE_DIR' -maxdepth 2 -type d | sort
echo
echo '--- Nginx ---'
nginx -t
"

echo
echo "Deployment fayllari serverga ko'chirildi."
echo "Backend hali ishga tushirilmadi: production dependency"
echo "va PostgreSQL 18 konfiguratsiyasi alohida tayyorlanishi kerak."
echo
echo "Domain: http://$DOMAIN"
echo "External HTTP port: 28004"
echo "External HTTPS port: 44304"
