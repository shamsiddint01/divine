#!/usr/bin/env bash
# Divine.uz — tiklangan (yoki joriy) bazaning yaxlitligini tekshirish (Phase 17, docs/RUNBOOK.md §4).
#
#   scripts/prod/verify-db.sh [--expect <manifest.tsv>] [--out <manifest.tsv>]
#
#  1) manifest (sql/manifest.sql): har bir jadval soni, o'zgarmas va moliyaviy jadvallar md5'i, invariantlar,
#     himoya qatlamlari; --expect berilsa — bayt-ma-bayt solishtiriladi (backup paytidagi manifest bilan);
#  2) invariantlar: reconciliation view'lari va manfiy qoldiq — 0; divine_app ledger/auditni o'zgartira olmaydi;
#     trigger'lar joyida; baza egasi divine_owner; TimeZone=UTC;
#  3) jonli sinov: o'zgarmas jadvallarda UPDATE urinishi trigger tomonidan rad etiladi (tranzaksiya
#     ROLLBACK — hech narsa o'zgarmaydi).
# Muvaffaqiyat — exit 0; har qanday farq yoki buzilish — exit 1.
source "$(dirname "$0")/lib.sh"

expect=''
save=''
while [ $# -gt 0 ]; do
  case "$1" in
    --expect) expect=$2; shift 2 ;;
    --out) save=$2; shift 2 ;;
    *) echo "Noma’lum parametr: $1" >&2; exit 2 ;;
  esac
done

work=$(mktemp -d)
trap 'rm -rf "$work"' EXIT
pg psql -U postgres -d divine -X -q -v ON_ERROR_STOP=1 -f - < "$ROOT/scripts/prod/sql/manifest.sql" > "$work/manifest.tsv"
[ -n "$save" ] && cp "$work/manifest.tsv" "$save"

failures=0
fail() { log "BUZILISH: $*"; failures=$((failures + 1)); }
value() { awk -F'\t' -v k="$1" '$1 == k { print $2 }' "$work/manifest.tsv"; }

if [ -n "$expect" ]; then
  if diff -u "$expect" "$work/manifest.tsv" > "$work/diff"; then
    log "manifest backup paytidagi bilan bir xil ($(wc -l < "$work/manifest.tsv") qator)"
  else
    fail "manifest farq qiladi:"; cat "$work/diff" >&2
  fi
fi

for key in $(awk -F'\t' '$1 ~ /^invariant\./ { print $1 }' "$work/manifest.tsv"); do
  [ "$(value "$key")" = 0 ] || fail "$key = $(value "$key")"
done
[ "$(value guard.immutable_triggers)" = 8 ] || fail "immutability trigger'lari: $(value guard.immutable_triggers)/8"
[ "$(value guard.app_can_update_ledger_or_audit)" = f ] || fail "divine_app ledger/auditni o‘zgartira oladi"
[ "$(value guard.app_can_insert_audit)" = t ] || fail "divine_app audit yoza olmaydi"
[ "$(value guard.db_owner)" = divine_owner ] || fail "baza egasi: $(value guard.db_owner)"
[ "$(value guard.timezone)" = UTC ] || fail "TimeZone: $(value guard.timezone)"
[ "$(value schema.migrations)" = "$(find "$ROOT/backend/prisma/migrations" -mindepth 1 -maxdepth 1 -type d | wc -l)" ] ||
  fail "migratsiyalar: DB'da $(value schema.migrations), repoda $(find "$ROOT/backend/prisma/migrations" -mindepth 1 -maxdepth 1 -type d | wc -l)"

# Har jadvalda oddiy ustun o'ziga tenglanadi (qiymat o'zgarmaydi) — BEFORE UPDATE trigger baribir ishlashi kerak.
for spec in audit_logs:action inventory_movements:quantity sales:total_amount sale_items:quantity; do
  table=${spec%%:*}
  column=${spec#*:}
  if [ "$(value "count.$table")" = 0 ]; then
    log "immutability.$table: jadval bo‘sh — jonli sinov o‘tkazib yuborildi"
    continue
  fi
  if pg psql -U postgres -d divine -X -q -v ON_ERROR_STOP=1 -v VERBOSITY=verbose \
       -c "BEGIN; UPDATE $table SET $column = $column WHERE ctid IN (SELECT ctid FROM $table LIMIT 1); ROLLBACK;" > "$work/out" 2>&1; then
    fail "immutability.$table: UPDATE rad etilmadi"
  elif grep -q 'DV001' "$work/out"; then
    log "immutability.$table: UPDATE rad etildi (trigger)"
  else
    fail "immutability.$table: kutilmagan xato: $(head -1 "$work/out")"
  fi
done

if [ "$failures" -gt 0 ]; then
  log "yaxlitlik tekshiruvi: $failures ta buzilish"
  exit 1
fi
log "yaxlitlik tekshiruvi: hammasi joyida"
