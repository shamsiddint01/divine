#!/usr/bin/env bash
# Divine.uz — monitoring va alerting (Phase 17, docs/RUNBOOK.md §2). Cron: har 5 daqiqada.
#
#   scripts/prod/monitor.sh [--insecure-tls]
#
# Tekshiruvlar: xizmatlar healthy; HTTPS orqali /api/v1/health; TLS sertifikati muddati; backup'lar
# yangiligi va xatolari (mantiqiy, bazaviy, WAL); postgres WAL arxivlash xatolari; API xato darajasi
# (oxirgi 15 daqiqa: error/fatal log va 5xx javoblar); oxirgi inventar reconciliation natijasi va yoshi;
# disk bandligi. Muammo bo'lsa — bitta yig'ma alert (ALERT_WEBHOOK_URL) va exit 1. --insecure-tls — faqat
# self-signed sinov sertifikati uchun.
source "$(dirname "$0")/lib.sh"

insecure=''
[ "${1:-}" = --insecure-tls ] && insecure=-k
MAX_ERRORS=${MONITOR_MAX_ERRORS_15M:-5}
MAX_LOGICAL_AGE_H=${MONITOR_MAX_LOGICAL_BACKUP_AGE_HOURS:-26}
MAX_BASE_AGE_H=${MONITOR_MAX_BASE_BACKUP_AGE_HOURS:-192}
MAX_WAL_AGE_M=${MONITOR_MAX_WAL_BACKUP_AGE_MINUTES:-30}
MAX_RECON_AGE_H=${MONITOR_MAX_RECONCILIATION_AGE_HOURS:-26}
CERT_MIN_DAYS=${MONITOR_CERT_MIN_DAYS:-14}
DISK_MAX_PCT=${MONITOR_DISK_MAX_PERCENT:-85}

problems=()
report() { printf '%-5s %s\n' "$1" "$2"; [ "$1" = FAIL ] && problems+=("$2"); return 0; }
age_seconds() { echo $(($(date -u +%s) - $(date -u -d "$1" +%s))); }

# 1) Xizmatlar.
for service in postgres redis api web; do
  id=$(compose ps -q "$service" 2>/dev/null || true)
  if [ -z "$id" ]; then report FAIL "$service ishlamayapti"; continue; fi
  health=$(docker inspect -f '{{if .State.Health}}{{.State.Health.Status}}{{else}}{{.State.Status}}{{end}}' "$id")
  [ "$health" = healthy ] && report OK "$service: healthy" || report FAIL "$service: $health"
done

# 2) Tashqaridan ko'rinish: HTTPS orqali health (web → api → DB/Redis).
body=$(curl -sS $insecure --max-time 10 -H "Host: ${DOMAIN%%:*}" "https://127.0.0.1:${HTTPS_PORT:-443}/api/v1/health" 2>&1 || true)
if [ "$(jq -r '.status // empty' <<<"$body" 2>/dev/null)" = ok ]; then
  report OK "https health: ok"
else
  report FAIL "https health: ${body:0:120}"
fi

# 3) TLS sertifikati.
if openssl x509 -checkend $((CERT_MIN_DAYS * 86400)) -noout -in "$SECRETS_DIR/tls_cert" >/dev/null 2>&1; then
  report OK "TLS sertifikati: $CERT_MIN_DAYS kundan ko‘proq amal qiladi ($(openssl x509 -enddate -noout -in "$SECRETS_DIR/tls_cert" | cut -d= -f2))"
else
  report FAIL "TLS sertifikati $CERT_MIN_DAYS kun ichida tugaydi yoki o‘qilmadi — yangilang (RUNBOOK §1)"
fi

# 4) Backup'lar: oxirgi muvaffaqiyat yoshi va ochiq xatolar.
for spec in "logical:$((MAX_LOGICAL_AGE_H * 3600))" "base:$((MAX_BASE_AGE_H * 3600))" "wal:$((MAX_WAL_AGE_M * 60))"; do
  kind=${spec%%:*}
  limit=${spec#*:}
  status="$BACKUP_DIR/status/last-$kind-success.json"
  if [ -f "$BACKUP_DIR/status/last-$kind-failure.json" ]; then
    report FAIL "$kind backup: oxirgi urinish xato — $(jq -r .message "$BACKUP_DIR/status/last-$kind-failure.json")"
  elif [ ! -f "$status" ]; then
    report FAIL "$kind backup: hali birorta muvaffaqiyatli backup yo‘q"
  else
    age=$(age_seconds "$(jq -r .at "$status")")
    [ "$age" -le "$limit" ] && report OK "$kind backup: $((age / 60)) daqiqa oldin" ||
      report FAIL "$kind backup eskirgan: $((age / 3600)) soat oldin (chegara $((limit / 3600)) soat)"
  fi
done

# 5) WAL arxivlash (postgres).
archiver=$(pg psql -U postgres -d divine -X -At -F' ' -c \
  "SELECT failed_count, coalesce(last_failed_time > coalesce(last_archived_time, 'epoch'), false) FROM pg_stat_archiver" 2>/dev/null || echo 'yo‘q')
case "$archiver" in
  *' f') report OK "WAL arxivlash: xatosiz (jami muvaffaqiyatsiz urinishlar: ${archiver%% *})" ;;
  *) report FAIL "WAL arxivlash: oxirgi urinish xato yoki holat o‘qilmadi ($archiver)" ;;
esac

# 6) API xato darajasi (oxirgi 15 daqiqa): pino `level` ≥ 50 yoki 5xx javob.
errors=$(compose logs --no-color --no-log-prefix --since 15m api 2>/dev/null |
  jq -Rr 'fromjson? | select((.level // 0) >= 50 or ((.res.statusCode // 0) >= 500)) | .msg' 2>/dev/null | wc -l)
[ "$errors" -le "$MAX_ERRORS" ] && report OK "API xatolari (15 daq): $errors" ||
  report FAIL "API xatolari (15 daq): $errors (chegara $MAX_ERRORS)"

# 7) Inventar reconciliation (kunlik job 03:00 — audit'dagi oxirgi natija).
recon=$(pg psql -U postgres -d divine -X -At -F'|' -c \
  "SELECT occurred_at, coalesce((metadata->>'mismatchCount')::int, 0) + coalesce((metadata->>'documentIssueCount')::int, 0)
          + coalesce((metadata->>'customerIssueCount')::int, 0)
     FROM audit_logs WHERE action = 'INVENTORY_RECONCILIATION_RUN' ORDER BY id DESC LIMIT 1" 2>/dev/null || true)
if [ -z "$recon" ]; then
  report WARN "reconciliation: hali ishga tushmagan (yangi o‘rnatish — job har kuni 03:00 Toshkent)"
else
  issues=${recon#*|}
  age=$(age_seconds "${recon%%|*}")
  if [ "$issues" != 0 ]; then
    report FAIL "reconciliation: $issues ta nomuvofiqlik (Sozlamalar → Audit; RUNBOOK §7)"
  elif [ "$age" -gt $((MAX_RECON_AGE_H * 3600)) ]; then
    report FAIL "reconciliation: oxirgisi $((age / 3600)) soat oldin (job ishlamayapti?)"
  else
    report OK "reconciliation: nomuvofiqlik yo‘q ($((age / 3600)) soat oldin)"
  fi
fi

# 8) Disk.
mkdir -p "$BACKUP_DIR"
for path in "$BACKUP_DIR" /var/lib/docker; do
  [ -e "$path" ] || continue
  used=$(df -P "$path" 2>/dev/null | awk 'NR == 2 { gsub("%", "", $5); print $5 }')
  [ -n "$used" ] || continue
  [ "$used" -lt "$DISK_MAX_PCT" ] && report OK "disk ($path): ${used}%" || report FAIL "disk ($path): ${used}% (chegara $DISK_MAX_PCT%)"
done

if [ ${#problems[@]} -gt 0 ]; then
  alert monitor "$(printf '%s; ' "${problems[@]}")"
  rm -f "$BACKUP_DIR/status/last-monitor-failure.json" # monitor holati backup holatlariga aralashmasin
  exit 1
fi
echo "Hammasi joyida"
