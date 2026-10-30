# shellcheck shell=bash
# Divine.uz — production skriptlari uchun umumiy funksiyalar (Phase 17, docs/RUNBOOK.md).
# Muhit: ENV_FILE (standart: <repo>/.env.prod) va COMPOSE_PROJECT (standart: divine-prod).
# .env.prod'da secret yo'q — faqat yo'llar, domen, muddatlar.
# -E (errtrace): ERR trap funksiyalar ichidagi xatolarda ham ishlaydi — aks holda `pg ...` yiqilsa alert
# yuborilmasdan jim chiqib ketardi (Phase 17 drill'ida topilgan).
set -Eeuo pipefail
umask 077

ROOT=$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)
cd "$ROOT"
ENV_FILE=${ENV_FILE:-$ROOT/.env.prod}
PROJECT=${COMPOSE_PROJECT:-divine-prod}
[ -f "$ENV_FILE" ] || { echo "Sozlamalar fayli yo‘q: $ENV_FILE (.env.prod.example'dan nusxa oling)" >&2; exit 2; }
set -a
# shellcheck disable=SC1090
. "$ENV_FILE"
set +a
BACKUP_DIR=${BACKUP_DIR:-./backups}
BACKUP_RETENTION_DAYS=${BACKUP_RETENTION_DAYS:-14}
SECRETS_DIR=${SECRETS_DIR:-./secrets}

compose() { docker compose -p "$PROJECT" -f "$ROOT/docker-compose.prod.yml" --env-file "$ENV_FILE" "$@"; }
# postgres konteyneri ichida (peer auth, `postgres` OS useri) — tarmoq paroli kerak emas.
pg() { compose exec -T postgres "$@"; }

log() { printf '%s %s\n' "$(date -u +%FT%TZ)" "$*" >&2; }

# Xato: status faylga yoziladi, webhook (berilgan bo'lsa) — xabarda faqat holat, hech qachon secret.
alert() {
  local kind=$1 message=$2
  log "XATO [$kind]: $message"
  mkdir -p "$BACKUP_DIR/status"
  printf '{"at":"%s","kind":"%s","message":%s}\n' "$(date -u +%FT%TZ)" "$kind" \
    "$(printf '%s' "$message" | jq -Rs .)" > "$BACKUP_DIR/status/last-$kind-failure.json"
  if [ -n "${ALERT_WEBHOOK_URL:-}" ]; then
    jq -n --arg kind "$kind" --arg message "$message" --arg host "$(hostname)" \
      '{text: ("Divine.uz [" + $host + "] " + $kind + ": " + $message)}' |
      curl -fsS -m 10 -H 'Content-Type: application/json' -d @- "$ALERT_WEBHOOK_URL" >/dev/null ||
      log "Alert webhook'ga yuborib bo‘lmadi"
  fi
}

# ERR trap uchun: bitta xato — bitta alert. `$(...)` ichida (subshell) faqat chiqiladi — alert'ni asosiy
# jarayon yuboradi (o'zgaruvchiga tayinlash yiqilgani uchun u ham trap'ga tushadi).
# Xabarda yiqilgan buyruq nomi (parollar hech qachon buyruq qatorida emas — secret chiqmaydi).
on_error() { # trap 'on_error <kind> "<tavsif>"' ERR
  local status=$?
  [ "$BASH_SUBSHELL" -eq 0 ] || exit 1
  alert "$1" "$2: \`${BASH_COMMAND%% *}\` (exit $status)"
  exit 1
}

ok() { # ok <kind> <json>
  mkdir -p "$BACKUP_DIR/status"
  printf '%s\n' "$2" > "$BACKUP_DIR/status/last-$1-success.json.tmp"
  mv "$BACKUP_DIR/status/last-$1-success.json.tmp" "$BACKUP_DIR/status/last-$1-success.json"
  rm -f "$BACKUP_DIR/status/last-$1-failure.json"
}

# Shifrlash: faqat OCHIQ kalit (serverda maxfiy kalit yo'q). Vaqtinchalik GNUPGHOME — host keyring'iga bog'liq emas.
gpg_encrypt() { # gpg_encrypt <kirish> <chiqish>
  local recipient=${BACKUP_GPG_RECIPIENT_FILE:-$SECRETS_DIR/backup_public_key.asc}
  [ -s "$recipient" ] || { echo "GPG ochiq kaliti yo‘q: $recipient" >&2; return 1; }
  local home
  home=$(mktemp -d)
  GNUPGHOME=$home gpg --batch --quiet --yes --trust-model always --recipient-file "$recipient" \
    --cipher-algo AES256 --compress-algo none --output "$2.part" --encrypt "$1"
  rm -rf "$home"
  mv "$2.part" "$2"
}

# Ochish: maxfiy kalit operator kompyuterida yoki xavfsiz joyda (GPG_PRIVATE_KEY_FILE yoki GNUPGHOME).
gpg_decrypt() { # gpg_decrypt <kirish> <chiqish>
  if [ -n "${GPG_PRIVATE_KEY_FILE:-}" ]; then
    local home
    home=$(mktemp -d)
    GNUPGHOME=$home gpg --batch --quiet --import "$GPG_PRIVATE_KEY_FILE"
    GNUPGHOME=$home gpg --batch --quiet --yes --output "$2" --decrypt "$1"
    rm -rf "$home"
  else
    gpg --batch --quiet --yes --output "$2" --decrypt "$1"
  fi
}

sha256_of() { sha256sum "$1" | cut -d' ' -f1; }
