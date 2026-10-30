#!/usr/bin/env bash
# Divine.uz — mantiqiy backup'dan tiklash (Phase 17, docs/RUNBOOK.md §4).
#
#   GPG_PRIVATE_KEY_FILE=<maxfiy kalit> scripts/prod/restore.sh <divine-*.dump.gpg> [--force] [--no-start]
#
#  - nazorat yig'indisi (.sha256) va manifest (.manifest.tsv) backup yonida bo'lishi kerak;
#  - bazada ma'lumot bo'lsa — faqat --force bilan (avval API to'xtatiladi; baza DROP ... WITH FORCE);
#  - `pg_restore --create`: egasi (divine_owner), huquqlar, baza sozlamalari (TimeZone) bilan; trigger'lar
#    ma'lumot yuklangandan keyin yaratiladi (post-data) — o'zgarmas jadvallar to'g'ri tiklanadi;
#  - keyin verify-db.sh --expect <manifest>: sonlar va md5'lar backup paytidagi bilan bir xil bo'lishi shart.
# Rollar (divine_owner, divine_app, divine_api) — postgres initdb'da yaratilgan bo'lishi kerak (init-roles.sh).
source "$(dirname "$0")/lib.sh"

file=${1:?foydalanish: restore.sh <divine-*.dump.gpg> [--force] [--no-start]}
shift
force=0
start=1
for arg in "$@"; do
  case "$arg" in
    --force) force=1 ;;
    --no-start) start=0 ;;
    *) echo "Noma’lum parametr: $arg" >&2; exit 2 ;;
  esac
done

[ -f "$file.sha256" ] || { echo "Nazorat yig‘indisi yo‘q: $file.sha256" >&2; exit 1; }
[ "$(sha256_of "$file")" = "$(cat "$file.sha256")" ] || { echo "Nazorat yig‘indisi mos emas — fayl buzilgan" >&2; exit 1; }
manifest="${file%.dump.gpg}.manifest.tsv"

tables=$(pg psql -U postgres -d postgres -X -At -c \
  "SELECT count(*) FROM pg_database WHERE datname = 'divine'")
if [ "$tables" = 1 ]; then
  existing=$(pg psql -U postgres -d divine -X -At -c "SELECT count(*) FROM pg_tables WHERE schemaname = 'public'")
  if [ "$existing" != 0 ] && [ "$force" != 1 ]; then
    echo "divine bazasida $existing ta jadval bor. Ustidan tiklash uchun --force (RUNBOOK §4)." >&2
    exit 1
  fi
fi

work=$(mktemp -d)
trap 'rm -rf "$work"' EXIT
log "shifr ochilmoqda"
gpg_decrypt "$file" "$work/divine.dump"

log "API to‘xtatilmoqda (tiklash paytida yozuv bo‘lmasin)"
compose stop api >/dev/null 2>&1 || true
pg psql -U postgres -d postgres -X -q -v ON_ERROR_STOP=1 -c 'DROP DATABASE IF EXISTS divine WITH (FORCE)'
log "pg_restore --create"
pg pg_restore -U postgres -d postgres --create --exit-on-error < "$work/divine.dump"

if [ -f "$manifest" ]; then
  "$ROOT/scripts/prod/verify-db.sh" --expect "$manifest"
else
  log "DIQQAT: manifest yo‘q ($manifest) — faqat invariantlar tekshiriladi"
  "$ROOT/scripts/prod/verify-db.sh"
fi

if [ "$start" = 1 ]; then
  compose up -d api web >/dev/null
  log "API qayta ishga tushirildi"
fi
log "tiklash tugadi: $file"
