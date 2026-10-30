#!/usr/bin/env bash
# Divine.uz — production secretlarini yaratish (Phase 17, docs/RUNBOOK.md §1).
#
#   scripts/prod/init-secrets.sh [--dir secrets] [--self-signed <domen>]
#
# Kriptografik tasodifiy qiymatlar (openssl rand) bir-biriga mos holda yoziladi: DB parollari va ularni
# ishlatadigan ulanish URL'lari, Redis konfiguratsiyasi va URL'i, JWT secret, parol pepper'i.
# Mavjud fayl HECH QACHON ustidan yozilmaydi (rotation — RUNBOOK §5). Katalog 0700 — host'dagi boshqa
# foydalanuvchilar o'qiy olmaydi; fayllar 0644, chunki konteynerlar har xil UID bilan o'qiydi
# (postgres 70, api 1000, nginx 101) — himoya katalog darajasida.
# TLS: haqiqiy sertifikatni secrets/tls_cert va secrets/tls_key ga qo'ying; `--self-signed` — faqat sinov.
set -euo pipefail
umask 077

dir=secrets
self_signed=''
while [ $# -gt 0 ]; do
  case "$1" in
    --dir) dir=$2; shift 2 ;;
    --self-signed) self_signed=$2; shift 2 ;;
    *) echo "Noma’lum parametr: $1" >&2; exit 2 ;;
  esac
done

mkdir -p "$dir"
chmod 700 "$dir"

created=()
write() { # write <nom> <qiymat>
  local path="$dir/$1"
  if [ -e "$path" ]; then return; fi
  printf '%s' "$2" > "$path"
  chmod 644 "$path"
  created+=("$1")
}
# Mavjud bo'lsa — o'sha qiymat (URL'lar parol bilan mos qolsin).
value() { if [ -e "$dir/$1" ]; then cat "$dir/$1"; else openssl rand -hex 32; fi; }

postgres_password=$(value postgres_password)
owner_password=$(value db_owner_password)
api_password=$(value db_api_password)
redis_password=$(value redis_password)

write postgres_password "$postgres_password"
write db_owner_password "$owner_password"
write db_api_password "$api_password"
write redis_password "$redis_password"
write migration_database_url "postgresql://divine_owner:${owner_password}@postgres:5432/divine?schema=public"
write database_url "postgresql://divine_api:${api_password}@postgres:5432/divine?schema=public"
write redis_url "redis://:${redis_password}@redis:6379"
write redis_conf "$(printf '%s\n' \
  "requirepass ${redis_password}" \
  'bind 0.0.0.0' \
  'protected-mode yes' \
  'appendonly yes' \
  'save 60 1000' \
  'dir /data' \
  'rename-command FLUSHALL ""' \
  'rename-command FLUSHDB ""' \
  'rename-command CONFIG ""')"
write jwt_access_secret "$(openssl rand -base64 48 | tr -d '\n')"
write password_pepper "$(openssl rand -base64 48 | tr -d '\n')"

if [ -n "$self_signed" ] && [ ! -e "$dir/tls_cert" ]; then
  openssl req -x509 -newkey rsa:3072 -nodes -days 30 -subj "/CN=${self_signed}" \
    -addext "subjectAltName=DNS:${self_signed},DNS:localhost,IP:127.0.0.1" \
    -keyout "$dir/tls_key" -out "$dir/tls_cert" 2>/dev/null
  chmod 644 "$dir/tls_cert" "$dir/tls_key"
  created+=("tls_cert (self-signed, 30 kun — faqat sinov)" tls_key)
fi

if [ ${#created[@]} -eq 0 ]; then
  echo "Hamma secretlar allaqachon mavjud: $dir (hech narsa o‘zgarmadi)"
else
  printf 'Yaratildi (%s):\n' "$dir"
  printf '  %s\n' "${created[@]}"
fi
for required in tls_cert tls_key; do
  [ -e "$dir/$required" ] || echo "DIQQAT: $dir/$required yo‘q — TLS sertifikatini qo‘ying (RUNBOOK §1)." >&2
done
