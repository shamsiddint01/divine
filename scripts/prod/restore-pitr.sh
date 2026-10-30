#!/usr/bin/env bash
# Divine.uz — vaqt nuqtasiga tiklash (PITR: bazaviy backup + WAL, Phase 17, docs/RUNBOOK.md §4).
#
#   GPG_PRIVATE_KEY_FILE=<maxfiy kalit> scripts/prod/restore-pitr.sh <divine-base-*.tar.gpg> \
#       --target-time '2026-10-30 11:50:00+00' --force [--no-start]
#
# DIQQAT: shu loyihaning postgres volume'i TOZALANADI (--force majburiy). Avval alohida sinov loyihasida
# (COMPOSE_PROJECT=divine-restore) tiklab, natijani tekshirish tavsiya etiladi (RUNBOOK §4).
#  1) bazaviy backup va $BACKUP_DIR/wal/*.gpg shifri ochiladi (nazorat yig'indisi tekshiriladi);
#  2) volume'ga yoziladi, `recovery.signal` + restore_command + recovery_target_time;
#  3) postgres WAL'ni maqsad vaqtigacha qayta o'ynaydi va promote qiladi;
#  4) tiklash sozlamalari olib tashlanadi, verify-db.sh — invariantlar va himoya qatlamlari.
source "$(dirname "$0")/lib.sh"

base=${1:?foydalanish: restore-pitr.sh <divine-base-*.tar.gpg> --target-time <vaqt> --force}
shift
target=''
force=0
start=1
while [ $# -gt 0 ]; do
  case "$1" in
    --target-time) target=$2; shift 2 ;;
    --force) force=1; shift ;;
    --no-start) start=0; shift ;;
    *) echo "Noma’lum parametr: $1" >&2; exit 2 ;;
  esac
done
[ -n "$target" ] || { echo '--target-time majburiy' >&2; exit 2; }
[ "$force" = 1 ] || { echo "postgres volume'i tozalanadi — davom etish uchun --force (RUNBOOK §4)" >&2; exit 1; }
[ "$(sha256_of "$base")" = "$(cat "$base.sha256")" ] || { echo 'Nazorat yig‘indisi mos emas' >&2; exit 1; }

volume="${PROJECT}_postgres_data"
image=postgres:18-alpine
in_volume() { docker run --rm -i -u 70:70 --network none -v "$volume:/var/lib/postgresql" "$image" sh -c "$1"; }

work=$(mktemp -d)
trap 'rm -rf "$work"' EXIT
log "shifr ochilmoqda: bazaviy backup va WAL segmentlari"
gpg_decrypt "$base" "$work/base.tar"
mkdir "$work/wal"
segments=0
for file in "$BACKUP_DIR"/wal/*.gpg; do
  [ -e "$file" ] || continue
  gpg_decrypt "$file" "$work/wal/$(basename "$file" .gpg)"
  segments=$((segments + 1))
done
log "WAL segmentlari: $segments"

log "API va web to‘xtatilmoqda, postgres o‘chirilmoqda"
compose stop web api >/dev/null 2>&1 || true
compose rm -sf postgres >/dev/null
in_volume 'rm -rf /var/lib/postgresql/18 /var/lib/postgresql/wal-archive /var/lib/postgresql/wal-restore'
in_volume 'mkdir -p "$PGDATA" && chmod 700 "$PGDATA" && tar -x -C "$PGDATA"' < "$work/base.tar"
tar -C "$work/wal" -c . | in_volume 'mkdir -p /var/lib/postgresql/wal-restore && tar -x -C /var/lib/postgresql/wal-restore'
printf "restore_command = 'cp /var/lib/postgresql/wal-restore/%%f %%p'\nrecovery_target_time = '%s'\nrecovery_target_action = 'promote'\n" "$target" |
  in_volume 'cat >> "$PGDATA/postgresql.auto.conf" && touch "$PGDATA/recovery.signal"'

log "postgres ishga tushirilmoqda (WAL qayta o‘ynaladi: maqsad $target)"
compose up -d postgres >/dev/null
for _ in $(seq 1 120); do
  state=$(pg psql -U postgres -d divine -X -At -c 'SELECT pg_is_in_recovery()' 2>/dev/null || true)
  [ "$state" = f ] && break
  sleep 1
done
[ "$state" = f ] || { alert pitr "tiklash tugamadi (pg_is_in_recovery=$state)"; exit 1; }

pg psql -U postgres -d postgres -X -q -v ON_ERROR_STOP=1 \
  -c 'ALTER SYSTEM RESET restore_command' -c 'ALTER SYSTEM RESET recovery_target_time' \
  -c 'ALTER SYSTEM RESET recovery_target_action' -c 'SELECT pg_reload_conf()' >/dev/null
pg rm -rf /var/lib/postgresql/wal-restore
log "promote qilindi; tiklash sozlamalari olib tashlandi"

"$ROOT/scripts/prod/verify-db.sh"
if [ "$start" = 1 ]; then
  compose up -d api web >/dev/null
  log "API qayta ishga tushirildi"
fi
log "PITR tugadi: $target"
