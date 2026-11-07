#!/usr/bin/env bash
# GitHub'dan yuklangan nusxani ochadi: scripts/render/decrypt-backup.sh divine.dump.gpg → divine.dump.
# Tiklash (yangi bazaga): pg_restore --no-owner --no-privileges -d "<yangi baza manzili>" divine.dump
set -euo pipefail
cd "$(dirname "$0")/../.."
FILE="${1:?Fayl kerak: divine.dump.gpg}"

set -a
# shellcheck disable=SC1091
source .env.render.secrets
set +a

printf '%s' "${BACKUP_PASSPHRASE:?BACKUP_PASSPHRASE yo\'q}" | gpg --batch --yes --pinentry-mode loopback \
  --passphrase-fd 0 -o "${FILE%.gpg}" -d "$FILE"
echo "Ochildi: ${FILE%.gpg}"
