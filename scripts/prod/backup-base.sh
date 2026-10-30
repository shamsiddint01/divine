#!/usr/bin/env bash
# Divine.uz — fizik bazaviy backup (pg_basebackup, PITR uchun, Phase 17, docs/RUNBOOK.md §3).
# Cron: haftada bir marta. WAL segmentlari — scripts/prod/backup-wal.sh (har 5–15 daqiqada).
#
#   scripts/prod/backup-base.sh
#
# Natija: $BACKUP_DIR/base/divine-base-<UTC>.tar.gpg (+ .sha256), status/last-base-success.json.
source "$(dirname "$0")/lib.sh"

stamp=$(date -u +%Y%m%dT%H%M%SZ)
out="$BACKUP_DIR/base"
mkdir -p "$out"
work=$(mktemp -d)
trap 'rm -rf "$work"' EXIT
trap 'on_error base "bazaviy backup muvaffaqiyatsiz"' ERR

log "pg_basebackup boshlandi"
# -X fetch: tiklash uchun kerakli WAL arxivning o'zida (o'zi yetarli nusxa); checkpoint — darhol.
pg pg_basebackup -U postgres -D - --format=tar --wal-method=fetch --checkpoint=fast > "$work/base.tar"
# Mundarija avval faylga: `tar | grep -q` pipefail ostida SIGPIPE (141) bilan yolg'on xato beradi.
tar -tf "$work/base.tar" > "$work/toc"
grep -qx 'backup_label' "$work/toc" || { alert base "tar'da backup_label yo‘q"; exit 1; }
grep -q '^pg_wal/0' "$work/toc" || { alert base "tar'da WAL (pg_wal) yo‘q"; exit 1; }

target="$out/divine-base-$stamp.tar.gpg"
gpg_encrypt "$work/base.tar" "$target"
sha256_of "$target" > "$target.sha256"
size=$(stat -c %s "$target")

# Eski bazaviy backup'lar; ulardan oldingi WAL'lar keraksiz (backup-wal.sh eng eski bazaviydan oldingisini o'chiradi).
find "$out" -maxdepth 1 -type f -name 'divine-base-*' -mtime +"$BACKUP_RETENTION_DAYS" -delete

ok base "$(jq -n --arg at "$(date -u +%FT%TZ)" --arg file "$target" --argjson size "$size" \
  '{at: $at, file: $file, bytes: $size}')"
log "tayyor: $target ($size bayt)"
