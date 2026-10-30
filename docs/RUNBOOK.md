# Divine.uz — production runbook (Phase 17)

> Kimga: serverni o‘rnatadigan va yuritadigan administrator. Barcha buyruqlar repo ildizidan.
> Konfiguratsiya: `docker-compose.prod.yml` (dev — `docker-compose.yml`, unga tegilmaydi), `.env.prod` (secret YO‘Q), `secrets/` (0700).
> Xavfsizlik qarorlari va qolgan xavflar: [SECURITY §20](SECURITY.md#20-phase-17-production-konfiguratsiyasi-va-qolgan-xavflar).

## 0. Talablar

| Nima | Nega |
|---|---|
| Linux server, Docker Engine + Compose v2 | stack |
| `openssl`, `gpg` (2.2+), `jq`, `curl` | secretlar, backup shifrlash, monitoring |
| 80/443 portlar ochiq, DNS `DOMAIN` → server | TLS va foydalanuvchilar |
| Backup uchun alohida disk yoki server (rsync/rclone) | backup server bilan birga yo‘qolmasin |
| Backup **maxfiy** GPG kaliti — serverda EMAS (administrator kompyuteri / seyf) | server buzilsa ham backup o‘qilmaydi |

## 1. O‘rnatish (birinchi deploy)

```bash
# 1. Secretlar (bir marta; mavjud fayllar ustidan yozilmaydi)
scripts/prod/init-secrets.sh                       # secrets/ — 0700
# 2. TLS sertifikati (masalan, Let's Encrypt — certbot host'da, webroot yoki DNS challenge):
cp /etc/letsencrypt/live/<domen>/fullchain.pem secrets/tls_cert
cp /etc/letsencrypt/live/<domen>/privkey.pem   secrets/tls_key
chmod 644 secrets/tls_cert secrets/tls_key        # himoya — katalog (0700) darajasida
# 3. Backup ochiq kaliti (maxfiy kalit administrator kompyuterida yaratiladi — §3.1)
cp backup_public_key.asc secrets/backup_public_key.asc
# 4. Sozlamalar
cp .env.prod.example .env.prod && $EDITOR .env.prod   # DOMAIN, portlar, BACKUP_DIR, ALERT_WEBHOOK_URL
# 5. Build va ishga tushirish (migratsiya + seed avtomatik, divine_owner bilan)
C="docker compose -f docker-compose.prod.yml --env-file .env.prod"
$C up -d --build
# 6. Birinchi administrator (parol FAQAT shu chiqishda bir marta)
$C run --rm --no-deps api node dist/database/bootstrap-admin.cli.js --login admin
# 7. Tekshiruv
scripts/prod/security-check.sh     # konteynerlar, rollar, tarmoq, TLS, HSTS, secretlar — hammasi PASS bo‘lishi shart
scripts/prod/monitor.sh
```

**Cron** (`crontab -e`, repo yo‘li bilan):

```cron
*/5  * * * *  cd /srv/divine && scripts/prod/monitor.sh      >> /var/log/divine-monitor.log 2>&1
*/10 * * * *  cd /srv/divine && scripts/prod/backup-wal.sh   >> /var/log/divine-backup.log 2>&1
30 1 * * *    cd /srv/divine && scripts/prod/backup.sh       >> /var/log/divine-backup.log 2>&1
0  2 * * 0    cd /srv/divine && scripts/prod/backup-base.sh  >> /var/log/divine-backup.log 2>&1
15 3 * * *    rsync -a --delete /srv/divine/backups/ backup-host:/divine/   # offsite nusxa (shifrlangan fayllar)
```

**Muhim sozlamalar:**
- `DOMAIN` — brauzer manzili (port bilan, agar 443 bo‘lmasa): `CORS_ORIGINS=https://<DOMAIN>`, refresh CSRF tekshiruvi shunga bog‘liq.
- `TRUST_PROXY=1` — Nginx (web) yagona proxy. Oldiga yana load balancer/CDN qo‘yilsa — hop'lar soni (2) va Nginx'da `set_real_ip_from` (aks holda rate limit va audit IP'si noto‘g‘ri).
- Sertifikat yangilangach: `$C exec web nginx -s reload`. `monitor.sh` muddat < 14 kun qolganda ogohlantiradi.
- HSTS (`max-age=31536000; includeSubDomains`) faqat HTTPS javoblarida. `preload` — domen egasining alohida qarori (qaytarib bo‘lmaydi).

## 2. Monitoring va alerting

`scripts/prod/monitor.sh` (cron, 5 daqiqa) — muammo bo‘lsa `ALERT_WEBHOOK_URL`ga bitta yig‘ma xabar (`{"text": ...}` — Slack/Telegram-bot/Mattermost incoming webhook formati) va exit 1.

| Tekshiruv | Chegara (env) | Alert bo‘lsa |
|---|---|---|
| postgres, redis, api, web healthy | — | `$C ps`, `$C logs <servis>`; restart siyosati `unless-stopped` |
| HTTPS orqali `/api/v1/health` | — | web → api → DB/Redis zanjiri; `health.checks` qaysi biri `down` |
| TLS sertifikati | `MONITOR_CERT_MIN_DAYS=14` | §1 — sertifikatni yangilash |
| Mantiqiy / bazaviy / WAL backup yoshi va oxirgi xato | `MONITOR_MAX_LOGICAL_BACKUP_AGE_HOURS=26`, `…BASE…=192`, `…WAL…_MINUTES=30` | `backups/status/last-*-failure.json`, `/var/log/divine-backup.log`; §3 |
| postgres WAL arxivlash (`pg_stat_archiver`) | — | disk to‘lgan bo‘lishi mumkin; arxivlash to‘xtasa WAL yig‘iladi |
| API xatolari (15 daq: `level ≥ 50` yoki 5xx) | `MONITOR_MAX_ERRORS_15M=5` | `$C logs --since 15m api \| jq 'select(.level>=50)'` — `requestId` bo‘yicha |
| Inventar reconciliation (kunlik 03:00, audit) | `MONITOR_MAX_RECONCILIATION_AGE_HOURS=26` | §7 — avtomatik tuzatish YO‘Q |
| Disk (backup katalogi, /var/lib/docker) | `MONITOR_DISK_MAX_PERCENT=85` | eski backup'lar (`BACKUP_RETENTION_DAYS`), log rotatsiyasi (10 MB × 5) |

Backup skriptlari ham o‘zi alert yuboradi (har bir xato — bitta xabar).

## 3. Backup

| Tur | Skript | Davriylik | Nima tiklaydi |
|---|---|---|---|
| Mantiqiy (`pg_dump -Fc`) | `backup.sh` | kuniga | butun baza holati backup paytida (+ yaxlitlik manifesti) |
| Bazaviy (`pg_basebackup`, WAL ichida) | `backup-base.sh` | haftasiga | PITR boshlang‘ich nuqtasi |
| WAL segmentlari | `backup-wal.sh` | 5–15 daqiqada | bazaviy backup'dan istalgan vaqt nuqtasigacha (RPO ≈ `archive_timeout` 5 daq + cron oralig‘i) |

- Hamma fayl **GPG ochiq kalit bilan shifrlangan** (`*.gpg`, AES-256): dump'da parol hash'lari, refresh token hash'lari, mijozlarning ism va telefonlari bor. Shifrlanmagan nusxa faqat 0700 vaqtinchalik katalogda turadi va darhol o‘chiriladi. Har faylning `.sha256` nazorat yig‘indisi yoniga yoziladi.
- Mantiqiy backup'dan oldin `pg_restore --list` bilan tekshiriladi (muhim jadvallar ma’lumoti bor), so‘ng yaxlitlik manifesti (`*.manifest.tsv`: jadval sonlari, o‘zgarmas va moliyaviy jadvallar md5'i, invariantlar) — shifrlanmagan, maxfiy ma’lumotsiz.
- Saqlash muddati `BACKUP_RETENTION_DAYS` (standart 14) — eskilar faqat YANGI backup muvaffaqiyatli bo‘lgandan keyin o‘chiriladi. **Qaror kerak:** moliyaviy ma’lumotlar uchun yuridik saqlash muddati (biznes egasi) — offsite nusxa uchun alohida, uzunroq siyosat.
- Holat: `backups/status/last-<tur>-success.json` / `last-<tur>-failure.json` — `monitor.sh` o‘qiydi.

### 3.1. Backup kalitlari (bir marta, administrator kompyuterida)

```bash
gpg --quick-gen-key 'Divine backup <admin@example.uz>' ed25519 cert never
gpg --quick-add-key <FPR> cv25519 encr never
gpg --armor --export <FPR> > backup_public_key.asc            # serverga: secrets/backup_public_key.asc
gpg --armor --export-secret-keys <FPR> > backup_private.asc   # seyf/parol menejeri — serverda EMAS
```

## 4. Tiklash (restore)

**Har doim avval sinov loyihasida** tiklang va tekshiring, keyin ishlab turgan tizimga (yoki sinov loyihasini asosiyga aylantiring):

```bash
export GPG_PRIVATE_KEY_FILE=~/backup_private.asc     # faqat tiklash paytida, keyin o‘chiring
# A) Mantiqiy backup'dan (baza bo‘sh bo‘lsa — --force kerak emas; ma’lumot bor bo‘lsa — --force)
scripts/prod/restore.sh backups/logical/divine-<UTC>.dump.gpg [--force]
#    → nazorat yig‘indisi → shifr ochiladi → API to‘xtatiladi → DROP/CREATE → pg_restore --create
#    → verify-db.sh --expect <manifest>: sonlar va md5'lar backup paytidagi bilan BAYT-MA-BAYT bir xil
#    → API qayta ishga tushadi
# B) Vaqt nuqtasiga (PITR): bazaviy backup + WAL
scripts/prod/restore-pitr.sh backups/base/divine-base-<UTC>.tar.gpg --target-time '2026-10-30 11:44:45+00' --force
# Faqat tekshirish (istalgan payt):
scripts/prod/verify-db.sh [--expect <manifest.tsv>]
```

`verify-db.sh`: reconciliation view'lari va manfiy qoldiq — 0; immutability trigger'lari yoqilgan (8/8); `divine_app` ledger va auditni o‘zgartira olmaydi; baza egasi `divine_owner`; `TimeZone=UTC`; migratsiyalar soni repodagi bilan bir xil; o‘zgarmas jadvallarda `UPDATE` urinishi jonli sinovda trigger tomonidan rad etiladi (ROLLBACK).

Rollar (`divine_owner`, `divine_app`, `divine_api`) postgres birinchi ishga tushganda `docker/postgres/init-roles.sh` bilan yaratiladi — yangi serverga tiklashda ham shu secretlar bilan.

## 5. Secret rotation

| Secret | Qanday | Ta’siri |
|---|---|---|
| `jwt_access_secret` | yangi qiymat → `$C up -d api` | barcha access tokenlar yaroqsiz; foydalanuvchilar refresh orqali (cookie) davom etadi |
| `password_pepper` → V2 | `openssl rand -base64 48 > secrets/password_pepper_v2`; compose'da `PASSWORD_PEPPER_V2_FILE` va `password_pepper_v2` secret'ini yoqing → `$C up -d api` | yangi hash'lar `v2$`; har bir user keyingi muvaffaqiyatli login'da avtomatik `v2$`ga o‘tadi (parol, sessiya, token o‘zgarmaydi). V1 o‘chirilmaydi. Holat: `SELECT left(password_hash, 3), count(*) FROM users GROUP BY 1` |
| DB parollari | `ALTER ROLE divine_api PASSWORD …` (postgres ichida) + `secrets/db_api_password` va `database_url` → `$C up -d api` | qisqa uzilish |
| Redis paroli | `secrets/redis_password`, `redis_conf`, `redis_url` → `$C up -d redis api` | rate limit hisoblagichlari saqlanadi (AOF) |
| TLS | §1 | — |

**Pepper oshkor bo‘lgan bo‘lsa** (server to‘liq egallangan — SECURITY §5.3): V2 yoqiladi va **barcha** userlarning parollari admin tomonidan tiklanadi (yangi parol → `v2$`, barcha sessiyalar bekor) — eski `v1$` hash'lar endi ishlatilmaydi.

## 6. Muntazam drill (oyiga kamida bir marta)

`scripts/prod/drill.sh` — ALOHIDA loyihada (`divine-drill`, 127.0.0.1:18443, vaqtinchalik secretlar, self-signed TLS, vaqtinchalik GPG kalit) to‘liq sikl: stack → admin → HTTPS API orqali ma’lumot → mantiqiy backup → **volume'lar o‘chiriladi** → tiklash → manifest solishtiruvi → ilova orqali tekshiruv → bazaviy backup → yangi ma’lumot, T nuqta, yana ma’lumot → WAL → PITR (T dan keyingilari yo‘q) → xavfsizlik tekshiruvi → monitor → backup xatosini aniqlash (postgres to‘xtatiladi) → tozalash. Ishlab turgan tizimga tegmaydi. Natija — `backups/drill/drill-<UTC>.txt` va `drill-<UTC>/` (manifestlar: backup, restore'dan keyin, T nuqta, PITR'dan keyin; `security-check.txt`, `monitor.txt`); xatoda — vaqtinchalik katalogdagi `drill-report.txt` (yo‘li chiqishda). Exit 0 faqat hamma qadam PASS bo‘lsa.

## 7. Yangilash, rollback, insident

**Yangilash:** `backup.sh` → `git pull` → `APP_VERSION=<yangi teg>` → `$C up -d --build` (migrate avtomatik, keyin api) → `security-check.sh`, `monitor.sh`.
**Rollback:** migratsiyalar faqat oldinga (DATABASE §8). Yangi versiya migratsiya qo‘llamagan bo‘lsa — oldingi `APP_VERSION` bilan `$C up -d`. Qo‘llagan bo‘lsa — yangilashdan oldingi backup'ni sinov loyihasida tiklab tekshiring, so‘ng §4 (yozuvlar yo‘qolishini biznes egasi bilan kelishing).
**Insident (ruxsatsiz kirish gumoni):** 1) `$C logs`/audit jurnali (`AUTH_*`, IP) saqlanadi; 2) §5 — JWT secret, pepper V2, DB/Redis parollari; 3) barcha sessiyalar: `UPDATE user_sessions SET revoked_at = now(), revoked_reason = 'PASSWORD_RESET' WHERE revoked_at IS NULL` (postgres ichida); 4) userlarning parollarini tiklash; 5) backup'lar shifrlangan — maxfiy kalit serverda bo‘lmagani uchun ular oshkor bo‘lmagan.
**Reconciliation nomuvofiqligi:** avtomatik tuzatilmaydi (D-03). `GET /inventory/reconciliation` (admin) — qaysi ombor/mahsulot; audit va ledger bo‘yicha sababi topiladi; tuzatish — hujjat orqali (kirim), ledger qo‘lda o‘zgartirilmaydi.

## 8. Kengaytirish (REQ-169)

API stateless (JWT, Redis'da rate limit, lockout va job qulflari). Bir nechta nusxa: `$C up -d --scale api=2` va `$C restart web` (Nginx `api` nomini ishga tushishda hal qiladi). Kunlik job'lar (reconciliation, sessiya tozalash) Redis `SET NX` qulfi bilan bitta nusxada ishlaydi. **Phase 17 da bir nechta nusxa bilan sinalmagan** — ishlatishdan oldin sinov loyihasida tekshiring (SECURITY §20.5).
