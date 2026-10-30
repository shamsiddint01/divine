#!/usr/bin/env bash
# Divine.uz — WAL arxivini backup katalogiga olish (PITR, Phase 17, docs/RUNBOOK.md §3).
# Cron: har 5–15 daqiqada (postgres archive_timeout=300).
#
#   scripts/prod/backup-wal.sh
#
# postgres archive_command segmentlarni data volume ichidagi staging katalogiga atomik ko'chiradi.
# Bu skript har birini shifrlaydi ($BACKUP_DIR/wal/<segment>.gpg), nazorat qiladi va faqat SHUNDAN KEYIN
# staging'dan o'chiradi. Arxivlashda xato (pg_stat_archiver.failed_count o'sgan) — alert.
source "$(dirname "$0")/lib.sh"

out="$BACKUP_DIR/wal"
staging=/var/lib/postgresql/wal-archive
mkdir -p "$out"
work=$(mktemp -d)
trap 'rm -rf "$work"' EXIT
trap 'on_error wal "WAL backup muvaffaqiyatsiz"' ERR

copied=0
# Alohida tayinlash: ro'yxat olinmasa (postgres ishlamasa) — xato yutilmaydi, ERR trap ishlaydi.
segments=$(pg sh -c "ls -1 $staging 2>/dev/null | grep -v '\\.tmp\$' || true")
for segment in $segments; do
  pg cat "$staging/$segment" > "$work/$segment"
  [ -s "$work/$segment" ] || { alert wal "bo‘sh segment: $segment"; exit 1; }
  gpg_encrypt "$work/$segment" "$out/$segment.gpg"
  rm -f "$work/$segment"
  pg rm -f "$staging/$segment"
  copied=$((copied + 1))
done

# Arxivlash holati: oxirgi xato oxirgi muvaffaqiyatdan keyin bo'lsa — alert.
status=$(pg psql -U postgres -d divine -X -At -c \
  "SELECT failed_count, coalesce(last_failed_time > coalesce(last_archived_time, 'epoch'), false) FROM pg_stat_archiver")
if [ "${status#*|}" = "t" ]; then
  alert wal "postgres WAL arxivlashda xato (pg_stat_archiver: $status)"
  exit 1
fi

# Eng eski bazaviy backup'dan oldingi WAL'lar tiklash uchun kerak emas.
oldest_base=$(find "$BACKUP_DIR/base" -maxdepth 1 -name 'divine-base-*.tar.gpg' -printf '%T@ %p\n' 2>/dev/null | sort -n | head -1 | cut -d' ' -f2-)
if [ -n "$oldest_base" ]; then
  find "$out" -maxdepth 1 -type f -name '*.gpg' ! -newer "$oldest_base" -delete
fi

ok wal "$(jq -n --arg at "$(date -u +%FT%TZ)" --argjson copied "$copied" '{at: $at, copied: $copied}')"
log "WAL: $copied segment olindi"
