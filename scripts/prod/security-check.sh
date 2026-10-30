#!/usr/bin/env bash
# Divine.uz — ishlayotgan production stack'ning xavfsizlik tekshiruvi (Phase 17, SECURITY §20).
#
#   scripts/prod/security-check.sh [--insecure-tls]
#
# --insecure-tls — faqat self-signed sertifikatli sinov (drill) uchun: sertifikat zanjiri tekshirilmaydi.
# Har bir tekshiruv PASS/FAIL qatori; bitta FAIL ham bo'lsa — exit 1. Secret qiymatlari chiqarilmaydi.
source "$(dirname "$0")/lib.sh"

insecure=''
[ "${1:-}" = --insecure-tls ] && insecure=-k
failures=0
pass() { printf 'PASS  %s\n' "$*"; }
fail() { printf 'FAIL  %s\n' "$*"; failures=$((failures + 1)); }
check() { local label=$1; shift; if "$@" >/dev/null 2>&1; then pass "$label"; else fail "$label"; fi; }

https="https://127.0.0.1:${HTTPS_PORT:-443}"
http="http://127.0.0.1:${HTTP_PORT:-80}"
curl_tls() { curl -sS $insecure --max-time 10 -H "Host: ${DOMAIN%%:*}" "$@"; }

# 1) Konteynerlar: read-only root FS, capability'lar yo'q, no-new-privileges, root emas, restart siyosati.
for service in postgres redis migrate api web; do
  id=$(compose ps -aq "$service")
  [ -n "$id" ] || { fail "$service: konteyner yo‘q"; continue; }
  read -r ro caps nnp user restart < <(docker inspect -f \
    '{{.HostConfig.ReadonlyRootfs}} {{json .HostConfig.CapDrop}} {{json .HostConfig.SecurityOpt}} {{.Config.User}} {{.HostConfig.RestartPolicy.Name}}' "$id")
  [ "$ro" = true ] && pass "$service: read-only root FS" || fail "$service: root FS yoziladigan"
  [ "$caps" = '["ALL"]' ] && pass "$service: barcha capability'lar olib tashlangan" || fail "$service: cap_drop=$caps"
  [[ "$nnp" == *no-new-privileges:true* ]] && pass "$service: no-new-privileges" || fail "$service: no-new-privileges yo‘q"
  running=$(docker inspect -f '{{.State.Running}}' "$id")
  if [ "$running" = true ]; then uid=$(docker exec "$id" id -u); else uid=${user%%:*}; fi
  [ "$uid" != 0 ] && [ -n "$uid" ] && pass "$service: root emas (uid $uid)" || fail "$service: root sifatida ishlaydi"
  if [ "$service" = migrate ]; then
    [ "$restart" = no ] && pass "migrate: bir martalik (restart yo‘q)" || fail "migrate: restart=$restart"
  else
    [ "$restart" = unless-stopped ] && pass "$service: restart=unless-stopped" || fail "$service: restart=$restart"
  fi
done
for service in postgres redis api web; do
  health=$(docker inspect -f '{{if .State.Health}}{{.State.Health.Status}}{{else}}yo‘q{{end}}' "$(compose ps -q "$service")")
  [ "$health" = healthy ] && pass "$service: healthcheck — healthy" || fail "$service: healthcheck — $health"
done

# 2) Tarmoq: faqat web port ochadi; ichki tarmoqdan internetga chiqish yo'q.
for service in postgres redis api; do
  ports=$(docker inspect -f '{{json .NetworkSettings.Ports}}' "$(compose ps -q "$service")")
  [[ "$ports" != *HostPort* ]] && pass "$service: host'ga port ochilmagan" || fail "$service: port ochiq $ports"
done
if compose exec -T api node -e "fetch('https://registry.npmjs.org',{signal:AbortSignal.timeout(5000)}).then(()=>process.exit(0),()=>process.exit(1))" >/dev/null 2>&1; then
  fail "api: internetga chiqa oladi (backend tarmog'i internal emas)"
else
  pass "api: internetga chiqish yo‘q (internal tarmoq)"
fi

# 3) DB: ilova superuser emas, divine_api (divine_app a'zosi) bilan ulangan. Avval API orqali DB so'rovi
# (health → SELECT 1) — pool bo'sh ulanishlarni yopgan bo'lsa ham shu payt ulanish ochiq bo'lsin.
curl_tls -fs -o /dev/null "$https/api/v1/health" || true
roles=$(pg psql -U postgres -d divine -X -At -c \
  "SELECT DISTINCT a.usename || ':' || r.rolsuper FROM pg_stat_activity a JOIN pg_roles r ON r.rolname = a.usename
    WHERE a.datname = 'divine' AND a.backend_type = 'client backend' AND a.usename <> 'postgres'")
[ "$roles" = 'divine_api:false' ] && pass "api DB ulanishi: divine_api (superuser emas)" || fail "api DB ulanishlari: ${roles:-yo‘q}"
member=$(pg psql -U postgres -d divine -X -At -c "SELECT pg_has_role('divine_api', 'divine_app', 'MEMBER')")
[ "$member" = t ] && pass "divine_api ∈ divine_app" || fail "divine_api divine_app a’zosi emas"
super=$(pg psql -U postgres -d divine -X -At -c "SELECT string_agg(rolname, ',') FROM pg_roles WHERE rolname LIKE 'divine%' AND (rolsuper OR rolcreaterole OR rolcreatedb)")
[ -z "$super" ] && pass "divine_* rollarida SUPERUSER/CREATEROLE/CREATEDB yo‘q" || fail "ortiqcha huquqli rollar: $super"

# 4) Redis: parolsiz kirib bo'lmaydi.
noauth=$(compose exec -T redis redis-cli ping 2>&1 || true)
[[ "$noauth" == *NOAUTH* ]] && pass "redis: autentifikatsiyasiz rad etiladi" || fail "redis: parolsiz javob berdi ($noauth)"

# 5) TLS va HSTS.
check "https: sayt ochiladi" curl_tls -f -o /dev/null "$https/"
check "https: API health" curl_tls -f -o /dev/null "$https/api/v1/health"
headers=$(curl_tls -D - -o /dev/null "$https/")
grep -qi '^strict-transport-security: max-age=31536000; includeSubDomains' <<<"$headers" && pass "https: HSTS" || fail "https: HSTS yo‘q"
grep -qi "^content-security-policy: default-src 'self'" <<<"$headers" && pass "https: CSP" || fail "https: CSP yo‘q"
plain=$(curl -sS --max-time 10 -D - -o /dev/null "$http/sales")
grep -q '^HTTP/1.1 301' <<<"$plain" && grep -qi '^location: https://' <<<"$plain" && pass "http → https (301)" || fail "http yo‘naltirilmaydi"
grep -qi '^strict-transport-security' <<<"$plain" && fail "http javobida HSTS bor" || pass "http javobida HSTS yo‘q (faqat TLS orqali)"
api_plain=$(curl -sS --max-time 10 -o /dev/null -w '%{http_code}' "$http/api/v1/health")
[ "$api_plain" = 301 ] && pass "API oddiy HTTP orqali ochilmaydi (301)" || fail "API http orqali: $api_plain"
# Klient eski protokolga ruxsat beradi (SECLEVEL=0) — rad etish server tomonidan ekanini isbotlash uchun.
for version in tls1 tls1_1; do
  # Chiqish avval o'zgaruvchiga: `| grep -q` pipefail ostida SIGPIPE bilan yolg'on natija berishi mumkin.
  handshake=$(openssl s_client -connect "127.0.0.1:${HTTPS_PORT:-443}" "-$version" -cipher 'DEFAULT@SECLEVEL=0' </dev/null 2>/dev/null || true)
  if grep -q 'Cipher is [A-Z]' <<<"$handshake"; then
    fail "TLS: $version qabul qilindi"
  else
    pass "TLS: $version rad etiladi"
  fi
done
for version in tls1_2 tls1_3; do
  handshake=$(openssl s_client -connect "127.0.0.1:${HTTPS_PORT:-443}" "-$version" </dev/null 2>/dev/null || true)
  grep -q 'Cipher is [A-Z]' <<<"$handshake" && pass "TLS: $version ishlaydi" || fail "TLS: $version ishlamaydi"
done

# 6) Secretlar: `docker inspect` env'ida va konteyner log'larida yo'q.
mapfile -t values < <(for f in "$SECRETS_DIR"/*; do
  case "$(basename "$f")" in tls_cert | *.asc) continue ;; esac
  [ "$(basename "$f")" = redis_conf ] && sed -n 's/^requirepass //p' "$f" || cat "$f"
  echo
done | grep -v '^$')
inspect=$(for s in postgres redis migrate api web; do docker inspect -f '{{json .Config.Env}} {{json .Config.Cmd}}' "$(compose ps -aq "$s")"; done)
logs=$(compose logs --no-color 2>&1)
leaks_inspect=0
leaks_logs=0
for value in "${values[@]}"; do
  [ "${#value}" -ge 16 ] || continue
  grep -qF -- "$value" <<<"$inspect" && leaks_inspect=$((leaks_inspect + 1))
  grep -qF -- "$value" <<<"$logs" && leaks_logs=$((leaks_logs + 1))
done
[ "${#values[@]}" -ge 8 ] || fail "secretlar ro‘yxati to‘liq emas (${#values[@]})"
[ "$leaks_inspect" = 0 ] && pass "secretlar docker inspect (env, cmd)'da yo‘q (${#values[@]} ta tekshirildi)" || fail "docker inspect'da $leaks_inspect ta secret"
[ "$leaks_logs" = 0 ] && pass "secretlar konteyner log'larida yo‘q ($(wc -l <<<"$logs") qator)" || fail "log'larda $leaks_logs ta secret"
perm=$(stat -c %a "$SECRETS_DIR")
[ "$perm" = 700 ] && pass "secrets katalogi 0700" || fail "secrets katalogi $perm"

echo "----"
if [ "$failures" -gt 0 ]; then echo "NATIJA: $failures ta FAIL"; exit 1; fi
echo "NATIJA: hammasi PASS"
