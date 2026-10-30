#!/usr/bin/env bash
# Divine.uz — backup/restore drill'i: to'liq, takrorlanadigan sinov (Phase 17, docs/RUNBOOK.md §6).
#
#   scripts/prod/drill.sh [--keep]
#
# ALOHIDA loyihada (divine-drill, 127.0.0.1:18081/18443) — ishlab turgan tizimga tegmaydi. Vaqtinchalik
# secretlar, self-signed TLS va vaqtinchalik GPG kalit juftligi (maxfiy kalit "oflayn" — secrets'dan tashqarida).
#   1) stack (production konfiguratsiyasi) → admin → HTTPS API orqali ma'lumot (A: 25 sotuv)
#   2) mantiqiy backup → BARCHA volume'lar o'chiriladi → toza postgres → restore → manifest bayt-ma-bayt
#   3) ilova orqali tekshiruv (login, sotuvlar soni, reconciliation)
#   4) bazaviy backup → D (5 sotuv) → T nuqtasi (+ manifest) → E (3 sotuv) → WAL backup
#   5) PITR T'ga → manifest T bilan bir xil, E yo'q → ilova orqali tekshiruv
#   6) security-check.sh, monitor.sh, backup xatosini aniqlash (postgres to'xtatilgan)
# Natija: backups/drill/drill-<UTC>.txt (xatoda — ish katalogidagi drill-report.txt). Har qanday buzilish —
# exit 1. --keep — stack va katalog qoladi.
set -Eeuo pipefail
umask 077

ROOT=$(cd "$(dirname "$0")/../.." && pwd)
cd "$ROOT"
keep=0
[ "${1:-}" = --keep ] && keep=1
export COMPOSE_PROJECT=divine-drill
work=$(mktemp -d "${TMPDIR:-/tmp}/divine-drill.XXXXXX")
report="$work/drill-report.txt"
export ENV_FILE="$work/env.drill"
export GPG_PRIVATE_KEY_FILE="$work/backup_private.asc"
url=https://127.0.0.1:18443
C() { docker compose -p "$COMPOSE_PROJECT" -f docker-compose.prod.yml --env-file "$ENV_FILE" "$@"; }
q() { C exec -T postgres psql -U postgres -d divine -X -At -c "$1"; }
step() { printf '\n== %s ==\n' "$*" | tee -a "$report" >&2; }
note() { printf '%s\n' "$*" | tee -a "$report" >&2; }
expect() { # expect <tavsif> <haqiqiy> <kutilgan>
  if [ "$2" = "$3" ]; then note "PASS  $1: $2"; else note "FAIL  $1: $2 (kutilgan $3)"; exit 1; fi
}
cleanup() {
  local status=$?
  if [ "$keep" = 0 ]; then
    C down -v --remove-orphans >/dev/null 2>&1 || true
    [ "$status" = 0 ] && rm -rf "$work"
  fi
  [ "$status" = 0 ] && echo "DRILL: MUVAFFAQIYATLI" >&2 || echo "DRILL: XATO (exit $status). Hisobot: $report" >&2
}
trap cleanup EXIT
wait_healthy() { # barcha ishlayotgan (yoki berilgan) servislar aniq "(healthy)" ("unhealthy" emas)
  for _ in $(seq 1 90); do
    local states total good
    states=$(C ps --format '{{.Status}}' "$@")
    total=$(grep -c . <<<"$states" || true)
    good=$(grep -c '(healthy)' <<<"$states" || true)
    [ "$total" -gt 0 ] && [ "$good" = "$total" ] && return 0
    sleep 2
  done
  C ps >&2
  return 1
}
data() { node scripts/prod/drill-data.mjs --url "$url" --login drilladmin --password-file "$work/admin.pw" --insecure --tag "$1" --sales "$2" 2>/dev/null; }
check_app() { node scripts/prod/drill-check.mjs --url "$url" --login drilladmin --password-file "$work/admin.pw" --insecure 2>/dev/null; }

# `docker compose ls` -p'ni e'tiborsiz qoldiradi — aniq nom, konteynerlar va volume'lar bo'yicha tekshiriladi.
if docker compose ls -aq | grep -qx "$COMPOSE_PROJECT" ||
  docker ps -a --format '{{.Names}}' | grep -q "^$COMPOSE_PROJECT-" ||
  docker volume ls -q | grep -q "^${COMPOSE_PROJECT}_"; then
  echo "divine-drill loyihasi allaqachon mavjud — avval: docker compose -p divine-drill -f docker-compose.prod.yml down -v" >&2
  exit 2
fi

step "Tayyorgarlik: secretlar, self-signed TLS, GPG kalitlari ($work)"
scripts/prod/init-secrets.sh --dir "$work/secrets" --self-signed localhost >/dev/null
cat > "$ENV_FILE" <<EOF
DOMAIN=localhost:18443
BIND_ADDRESS=127.0.0.1
HTTP_PORT=18081
HTTPS_PORT=18443
APP_VERSION=drill
LOG_LEVEL=info
SECRETS_DIR=$work/secrets
BACKUP_DIR=$work/backups
BACKUP_RETENTION_DAYS=14
BACKUP_GPG_RECIPIENT_FILE=$work/secrets/backup_public_key.asc
ALERT_WEBHOOK_URL=
EOF
mkdir -m 700 "$work/gnupg"
export GNUPGHOME="$work/gnupg"
gpg --batch --quiet --passphrase '' --quick-gen-key 'Divine drill <drill@localhost>' ed25519 cert never 2>/dev/null
fpr=$(gpg --list-keys --with-colons | awk -F: '/^fpr/ { print $10; exit }')
gpg --batch --quiet --passphrase '' --quick-add-key "$fpr" cv25519 encr never
gpg --armor --export > "$work/secrets/backup_public_key.asc"
gpg --batch --armor --export-secret-keys > "$GPG_PRIVATE_KEY_FILE"
unset GNUPGHOME
note "PASS  secretlar va kalitlar tayyor (maxfiy backup kaliti secrets/ dan tashqarida)"

step "1) Production stack va boshlang'ich ma'lumot"
started=$(date +%s)
C up -d --build >"$work/up.log" 2>&1
wait_healthy
note "PASS  stack healthy ($(($(date +%s) - started)) s, build bilan)"
C run --rm --no-deps api node dist/database/bootstrap-admin.cli.js --login drilladmin 2>/dev/null |
  sed -n 's/^  Parol: \([0-9]\{6\}\)$/\1/p' > "$work/admin.pw"
expect "admin paroli (6 raqam)" "$(grep -cE '^[0-9]{6}$' "$work/admin.pw")" 1
data A 25 >/dev/null
expect "A: sotuvlar (DB)" "$(q 'SELECT count(*) FROM sales')" 25

step "2) Mantiqiy backup → volume'lar o'chiriladi → restore"
scripts/prod/backup.sh 2>>"$report"
dump=$(ls "$work"/backups/logical/*.dump.gpg)
expect "backup shifrlangan (ochiq matn yo'q)" "$(LC_ALL=C grep -c 'PGDMP\|Drill mijoz' "$dump" || true)" 0
C down -v >/dev/null 2>&1
expect "volume'lar o'chirildi" "$(docker volume ls -q | grep -c '^divine-drill_' || true)" 0
C up -d postgres redis >/dev/null 2>&1
wait_healthy postgres redis
expect "yangi bazada jadvallar" "$(q "SELECT count(*) FROM pg_tables WHERE schemaname = 'public'")" 0
scripts/prod/restore.sh "$dump" --no-start 2>>"$report"
note "PASS  restore + manifest (sonlar, md5, invariantlar, himoya) backup paytidagi bilan bir xil"
C up -d >/dev/null 2>&1
wait_healthy
app=$(check_app)
note "ilova: $app"
expect "ilova: sotuvlar" "$(jq .sales <<<"$app")" 25
expect "ilova: reconciliation nomuvofiqliklari" "$(jq .reconciliationIssues <<<"$app")" 0

step "3) PITR: bazaviy backup → D → T → E → WAL → T'ga tiklash"
scripts/prod/backup-base.sh 2>>"$report"
data D 5 >/dev/null
sleep 1
target=$(q "SELECT to_char(clock_timestamp() AT TIME ZONE 'UTC', 'YYYY-MM-DD HH24:MI:SS.US') || '+00'")
scripts/prod/verify-db.sh --out "$work/manifest-T.tsv" 2>>"$report"
sales_t=$(q 'SELECT count(*) FROM sales')
note "T = $target (sotuvlar: $sales_t)"
sleep 1
data E 3 >/dev/null
expect "E dan keyin sotuvlar" "$(q 'SELECT count(*) FROM sales')" $((sales_t + 3))
q 'SELECT pg_switch_wal()' >/dev/null
sleep 3
scripts/prod/backup-wal.sh 2>>"$report"
base=$(ls "$work"/backups/base/*.tar.gpg)
scripts/prod/restore-pitr.sh "$base" --target-time "$target" --force --no-start 2>>"$report"
scripts/prod/verify-db.sh --expect "$work/manifest-T.tsv" 2>>"$report"
expect "PITR: sotuvlar T paytidagidek" "$(q 'SELECT count(*) FROM sales')" "$sales_t"
expect "PITR: T dan keyingi (E) ombor yo'q" "$(q "SELECT count(*) FROM warehouses WHERE name = 'Drill ombor E'")" 0
expect "PITR: T gacha (D) ombor bor" "$(q "SELECT count(*) FROM warehouses WHERE name = 'Drill ombor D'")" 1
C up -d >/dev/null 2>&1
wait_healthy
app=$(check_app)
note "ilova: $app"
expect "ilova (PITR'dan keyin): sotuvlar" "$(jq .sales <<<"$app")" "$sales_t"

step "4) Xavfsizlik va monitoring"
scripts/prod/backup.sh 2>/dev/null
scripts/prod/backup-wal.sh 2>/dev/null
if scripts/prod/security-check.sh --insecure-tls > "$work/security-check.txt" 2>&1; then
  note "PASS  security-check: $(grep -c '^PASS' "$work/security-check.txt") ta tekshiruv"
else
  cat "$work/security-check.txt" >> "$report"
  note "FAIL  security-check"
  exit 1
fi
if scripts/prod/monitor.sh --insecure-tls > "$work/monitor.txt" 2>&1; then
  note "PASS  monitor: $(grep -c '^OK' "$work/monitor.txt") OK, $(grep -c '^WARN' "$work/monitor.txt") WARN"
else
  cat "$work/monitor.txt" >> "$report"
  note "FAIL  monitor"
  exit 1
fi

step "5) Backup xatosini aniqlash (postgres to'xtatilgan)"
C stop postgres >/dev/null 2>&1
if scripts/prod/backup.sh >/dev/null 2>&1; then note "FAIL  postgres'siz backup 'muvaffaqiyatli' bo'ldi"; exit 1; fi
expect "xato holati yozildi" "$(test -f "$work/backups/status/last-logical-failure.json" && echo bor)" bor
if scripts/prod/monitor.sh --insecure-tls >/dev/null 2>&1; then note "FAIL  monitor xatoni ko'rmadi"; exit 1; fi
note "PASS  backup xatosi va monitor alert'i aniqlandi"
C start postgres >/dev/null 2>&1
wait_healthy postgres
scripts/prod/backup.sh 2>/dev/null
expect "keyingi muvaffaqiyatli backup xato holatini tozaladi" "$(test -f "$work/backups/status/last-logical-failure.json" && echo bor || echo yo\'q)" "yo'q"

step "Natija"
note "Drill tugadi: $(date -u +%FT%TZ), jami $(($(date +%s) - started)) s"
# Hisobot saqlanadi (ish katalogi muvaffaqiyatda o'chiriladi): backups/ — gitignore'da.
mkdir -p "$ROOT/backups/drill"
cp "$report" "$ROOT/backups/drill/drill-$(date -u +%Y%m%dT%H%M%SZ).txt"
