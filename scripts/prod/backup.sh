#!/usr/bin/env bash
# Divine.uz — mantiqiy backup (pg_dump, Phase 17, docs/RUNBOOK.md §3). Cron: kuniga bir marta.
#
#   scripts/prod/backup.sh
#
# Natija: $BACKUP_DIR/logical/divine-<UTC>.dump.gpg (+ .sha256, .manifest.tsv), status/last-logical-success.json.
# Dump'da parol hash'lari, refresh token hash'lari va mijozlarning shaxsiy ma'lumotlari bor — shuning
# uchun faqat GPG ochiq kalit bilan shifrlangan holda saqlanadi (maxfiy kalit serverda emas). Ochiq
# matnli nusxa faqat 0700 vaqtinchalik katalogda, oxirida o'chiriladi. Har qanday xato → alert + exit 1.
source "$(dirname "$0")/lib.sh"

stamp=$(date -u +%Y%m%dT%H%M%SZ)
out="$BACKUP_DIR/logical"
mkdir -p "$out"
work=$(mktemp -d)
trap 'rm -rf "$work"' EXIT
trap 'on_error logical "backup muvaffaqiyatsiz"' ERR

log "pg_dump boshlandi"
pg pg_dump -U postgres -d divine --format=custom --compress=6 > "$work/divine.dump"
[ -s "$work/divine.dump" ] || { alert logical "dump bo‘sh"; exit 1; }

# Dump o'qiladigan va to'liq: arxiv mundarijasida muhim jadvallarning ma'lumotlari bor.
pg pg_restore --list < "$work/divine.dump" > "$work/toc"
for table in audit_logs inventory_movements sales sale_items warehouse_stock users _prisma_migrations; do
  grep -q "TABLE DATA public $table " "$work/toc" || { alert logical "dump'da $table ma'lumoti yo‘q"; exit 1; }
done

# Yaxlitlik manifesti (sonlar, md5, invariantlar) — restore'dan keyin solishtirish uchun.
pg psql -U postgres -d divine -X -q -v ON_ERROR_STOP=1 -f - < "$ROOT/scripts/prod/sql/manifest.sql" > "$work/manifest.tsv"

target="$out/divine-$stamp.dump.gpg"
gpg_encrypt "$work/divine.dump" "$target"
sha256_of "$target" > "$target.sha256"
cp "$work/manifest.tsv" "$out/divine-$stamp.manifest.tsv"
size=$(stat -c %s "$target")

# Saqlash muddati — faqat yangi backup muvaffaqiyatli bo'lgandan KEYIN.
find "$out" -maxdepth 1 -type f -name 'divine-*' -mtime +"$BACKUP_RETENTION_DAYS" -delete

ok logical "$(jq -n --arg at "$(date -u +%FT%TZ)" --arg file "$target" --arg sha "$(cat "$target.sha256")" \
  --argjson size "$size" '{at: $at, file: $file, sha256: $sha, bytes: $size}')"
log "tayyor: $target ($size bayt)"
