# Divine.uz — Xavfsizlik arxitekturasi

> **Holat:** Phase 16 (Security review) — §18 checklist'i bajarildi, natijalar va qolgan xavflar §19 da; SEC-01 **yopildi** (§15.1). Phase 4 — authentication, sessiyalar, lockout, RBAC guard'lari va auth rate limit'lari; modullarning ownership/maydon himoyasi — o‘z phase'larida (5–13), §17 jadvallari.
> TZ: §3, §15, §17. REQ: REQ-025, REQ-026, REQ-027, REQ-144, REQ-160…REQ-166.

---

## 1. Authentication

| Element | Qaror |
|---|---|
| Identifikatsiya | `login` (case-insensitive) + 6 xonali parol (TZ talabi) |
| Sessiya modeli | Qisqa muddatli **access JWT** (15 daq) + uzoq muddatli **opaque refresh token** (7 kun, rotatsiyali) |
| Access token saqlanishi | Frontendda **faqat xotirada** (JS o‘zgaruvchi). `localStorage`/`sessionStorage`da EMAS: XSS bo‘lsa ham saqlangan tokenni o‘g‘irlab bo‘lmaydi |
| Refresh token saqlanishi | `dv_refresh` cookie: `HttpOnly; Secure; SameSite=Strict; Path=/api/v1/auth` |
| Server tomonda | `user_sessions.token_hash = SHA-256(refresh)`. Token o‘zi DB'da saqlanmaydi |
| AuthN ≠ AuthZ | `JwtAuthGuard` faqat "kim?" degan savolga javob beradi. `PermissionsGuard` va service "ruxsat bormi?" degan savolga ([RBAC.md](RBAC.md)) |
| Deny by default | Guard global; har bir endpoint `@Public` / `@Authenticated` / `@RequirePermissions` / `@RequireAnyPermission` bilan belgilanishi shart — aks holda **ilova ishga tushmaydi** (`RouteSecurityAuditor`). Public: `POST /auth/login`, `POST /auth/refresh`, `POST /auth/logout` (cookie + CSRF, §9), `GET /health` |
| Har so‘rovda | User PK bo‘yicha olinadi: `status = ACTIVE` va `token.iat >= password_changed_at`. Bloklash va parol tiklash **darhol** kuchga kiradi |
| Login javoblari | Login topilmasa ham, parol noto‘g‘ri bo‘lsa ham — bir xil `401 INVALID_CREDENTIALS` va bir xil javob vaqti (login yo‘q bo‘lsa, soxta hash'ga qarshi `argon2.verify` bajariladi) — user enumeration'ning oldi olinadi |

## 2. JWT

| Parametr | Qiymat |
|---|---|
| Algoritm | `HS256` — verifikatsiyada **qat’iy qotirilgan** (`none` va boshqa algoritmlar rad etiladi) |
| Secret | `JWT_ACCESS_SECRET` (≥ 32 belgi; tavsiya: `openssl rand -base64 48`). Prod'da `change-me…` qiymatlar va pepper bilan bir xil qiymat rad etiladi (Phase 1'da implement qilingan va testlangan) |
| Claim'lar | `sub` (user id), `role`, `iat`, `exp`, `iss = "divine.uz"`, `aud = "divine.uz/api"` |
| Muddat | `JWT_ACCESS_TTL_SECONDS` = 900 (15 daq) |
| Clock skew | ±30 s |
| Payload'da | Faqat identifikator va rol. Permissionlar har so‘rovda DB'dan olinadi; parol, hash va boshqa maxfiy ma’lumot yo‘q |

## 3. Refresh token

- **Generatsiya:** `crypto.randomBytes(32)` → base64url (256 bit entropiya).
- **Rotation:** har bir refresh'da eski sessiya `ROTATED` bilan yopiladi va shu `family_id` bilan yangisi ochiladi.
- **Reuse detection:** `ROTATED` holatidagi token qayta kelsa, bu token o‘g‘irlanganini bildiradi. Shuning uchun **butun family** revoke qilinadi (`REUSE_DETECTED`) va audit `AUTH_REFRESH_REUSE_DETECTED` yoziladi. Foydalanuvchi qaytadan login qilishi kerak.
- **Bekor qilish:** logout (joriy sessiya), parol tiklash (`PASSWORD_RESET`) va bloklash (`USER_BLOCKED`) — barcha sessiyalar (Phase 5 ✔).
- **Qoldiq (ma’lum):** `iat` soniya aniqligida, shuning uchun parol tiklangan **aynan o‘sha soniyada** berilgan access token tekshiruvdan o‘tadi (≤ 1 s oyna, refresh sessiyalari esa baribir bekor). Ms aniqlik tiklashdan keyingi birinchi login'ni ham rad etardi — qabul qilingan narx.
- **Muddat:** `REFRESH_TOKEN_TTL_DAYS` = 7. Muddati o‘tgan sessiyalarni 30 kundan keyin tozalash — **hali implement qilinmagan** (rejali vazifa, Phase 17; ular faqat joy egallaydi, qayta ishlatib bo‘lmaydi).
- **Ikki tab bir vaqtda refresh qilsa:** biri `ROTATED` tokenni qayta yuborgan bo‘lib chiqadi → family revoke, ikkala tab ham qayta login qiladi. Bu qat’iy reuse detection'ning ongli narxi (grace period yo‘q). Frontend bitta tab ichida refresh'ni single-flight qiladi.
- **CSRF himoyasi:** [§9](#9-csrf).

## 4. Lockout

Ikki qatlam:

| Qatlam | Mexanizm | Saqlash |
|---|---|---|
| IP bo‘yicha throttle | `POST /auth/login` — 10 urinish / daqiqa / IP → `429 RATE_LIMITED` (`Retry-After`) | Redis |
| Login bo‘yicha **progressive lockout** | `AUTH_MAX_FAILED_ATTEMPTS` (5) ketma-ket xato → lock. Lock muddati har safar **ikki baravar** oshadi: 15 daq → 30 daq → 1 soat → 2 → 4 → 8 → 16 → **24 soat (maksimum)**. Muvaffaqiyatli login hisoblagichlarni nolga tushiradi | `users.failed_login_attempts`, `lockout_count`, `locked_until` |
| Mavjud bo‘lmagan login | Xuddi shu hisoblagich Redis'da (`divine:auth:unknown:fp:<HMAC(lower(login))>`, atomik Lua — kalit nomida xom login yo‘q, SEC-01) yuritiladi. Natijada javoblar bir xil bo‘ladi va enumeration qilib bo‘lmaydi. Redis ishlamasa — lock yo‘q deb hisoblanadi (`warn` log); mavjud userlar lockout'i PostgreSQL'da, unga ta’sir qilmaydi | Redis |

- Lock vaqtida to‘g‘ri parol ham qabul qilinmaydi → `423 ACCOUNT_LOCKED` + `Retry-After`. Lock paytidagi urinishlar hisoblagichni oshirmaydi (atomik `UPDATE … WHERE locked_until IS NULL OR locked_until <= now`).
- Har bir lock audit'ga yoziladi (`AUTH_ACCOUNT_LOCKED`). Takroriy lock'lar admin dashboard'da ogohlantirish sifatida ko‘rinadi (Phase 12).
- ADMIN parolni tiklasa (`reset-password`), lock ham tozalanadi (**Phase 5 ✔**, test bilan). Admin bloklash/blokdan chiqarish esa lock'ga **tegmaydi** — ikkalasi alohida (holat ≠ lockout).
- **Ma’lum trade-off:** hujumchi atayin boshqa user'ni lock qilishi mumkin (lockout DoS). Bu brute-force himoyasining narxi. Lock muddati cheklangan, admin esa uni darhol olib tashlay oladi.

## 5. 6 xonali parol talabining xavfi

TZ §3 va §18 parolni **aynan 6 ta raqam** bo‘lishini talab qiladi. Bu talab non-negotiable, shuning uchun **o‘zgartirilmaydi**. Lekin uning xavfi ochiq qayd etiladi va kompensatsion choralar bilan kamaytiriladi.

### 5.1. Xavf miqdori

Parol fazosi: **10⁶ = 1 000 000** variant (≈ 19,9 bit entropiya). Taqqoslash uchun, 8 belgili harf va raqamli parolda ≈ 2,2 × 10¹⁴ variant bor.

| Hujum ssenariysi | Choralarsiz | Choralar bilan |
|---|---|---|
| **Online**, bitta akkauntga, lock yo‘q (IP throttle'ni botnet aylanib o‘tadi) | Butun fazo bir necha soatda tugaydi | — |
| **Online**, oddiy lock: 15 daqiqada 5 urinish | 480 urinish/kun → yiliga 175 200 → **yiliga ≈ 17,5% ehtimol** bilan topiladi | Bu yetarli emas, shuning uchun progressive lockout |
| **Online**, progressive lockout (24 soatgacha) | — | Barqaror rejimda ≈ 5 urinish/kun → yiliga ≈ 1 825 → **yiliga ≈ 0,18%** + admin ogohlantirishlari |
| **Offline** (DB dump o‘g‘irlangan), faqat argon2id | 10⁶ × ~50 ms ≈ 14 soat bitta yadroda; 64 yadroda ≈ 13 daqiqa | — |
| **Offline**, argon2id + **pepper** (pepper DB'da emas) | — | Pepper (256 bit) noma’lum bo‘lsa, brute force **amalda imkonsiz** |
| **Offline**, DB va pepper ikkalasi ham o‘g‘irlangan (serverni to‘liq egallash) | — | Soatlar ichida tiklanishi mumkin. **Qoldiq xavf** (§5.3) |

### 5.2. Kompensatsion choralar

1. **CSPRNG generatsiya** — `crypto.randomInt` (bir tekis taqsimot). User o‘zi parol tanlamaydi, shuning uchun "123456" kabi zaif parollar yo‘q (A-19).
2. **argon2id** — `memoryCost = 64 MiB`, `timeCost = 3`, `parallelism = 1` (`@node-rs/argon2`). **O‘lchov (Phase 4, dev noutbuk):** bitta verify ~170–210 ms — rejadagi 50–100 ms'dan sekinroq. Parametrlar **kamaytirilmadi**: 6 xonali parolda har bir taxmin narxi asosiy himoya; prod serverda qayta o‘lchanadi (Phase 17). Ilova ishga tushganda hasher bir marta "isitiladi".
3. **Pepper** — `HMAC-SHA256(PASSWORD_PEPPER, parol)` argon2'dan oldin qo‘llanadi. Pepper faqat env'da (DB'da, kodda va image'da emas). Hash formati `v1$<argon2-encoded>`, bu pepper rotation'ga imkon beradi (§13).
4. **Progressive lockout + IP throttle** (§4).
5. **Login audit** — har bir muvaffaqiyatli va xato urinish IP bilan yoziladi. Shubhali faollik admin'ga ko‘rinadi.
6. **Parol faqat bir marta ko‘rsatiladi** — `Cache-Control: no-store`, log va audit'ga yozilmaydi.
7. **Sessiyalarni boshqarish** — parol tiklash va bloklash barcha sessiyalarni darhol bekor qiladi.

### 5.3. Qoldiq xavf va tavsiyalar (TZ doirasidan tashqarida — implement QILINMAYDI)

- Server to‘liq egallansa (DB + env), parollarni tiklash mumkin. Insident bo‘lganda: pepper almashtiriladi va **barcha** user parollari admin tomonidan qayta generatsiya qilinadi (runbook — Phase 17).
- Kelajakda qaralishi mumkin bo‘lgan choralar (TZ o‘zgarsa): ikkinchi faktor (TOTP), IP allowlist (do‘kon tarmog‘i), uzunroq parol. **Hozir implement qilinmaydi**, chunki TZ'ni o‘zgartirib bo‘lmaydi.

## 6. Password hashing

```
generate:  password = randomInt(0, 1_000_000).toString().padStart(6, '0')
store:     hash = 'v1$' + argon2id(HMAC_SHA256(PEPPER_v1, password), { m: 64MiB, t: 3, p: 1 })
verify:    parse version → HMAC(PEPPER_vN, input) → argon2.verify (constant-time)
```

- Plaintext parol faqat xotirada, generatsiya va javob berish oralig‘ida mavjud bo‘ladi.
- Hash API javoblarida hech qachon qaytarilmaydi (DTO mapper'da yo‘q).

## 7. Rate limiting

`@nestjs/throttler` + Redis storage (bir nechta API instance'da ham to‘g‘ri hisoblaydi). Reverse proxy ortida `TRUST_PROXY=1` — haqiqiy IP `X-Forwarded-For` dan olinadi.

| Guruh | Limit | Kalit |
|---|---|---|
| `POST /auth/login` | 10 / daq | IP |
| `POST /auth/refresh` | 30 / daq | IP |
| Yozish amallari | 120 / daq | user |
| O‘qish amallari | 600 / daq | user |
| Global (autentifikatsiyasiz) | 60 / daq | IP |

Javob: `429 RATE_LIMITED` + `Retry-After`. Qo‘shimcha cheklovlar: body ≤ 1 MB (Nginx va Express), massivlar (`items` ≤ 500/200), `pageSize` ≤ 100, hisobot davri ≤ 366 kun.

**Implementatsiya (Phase 3):**
- `common/throttling/redis-throttler.storage.ts` — fixed window + blok, **bitta Lua skript** (atomik; 50 ta parallel so‘rovdan aynan `limit` tasi o‘tadi — real Redis testi). Kalitlar `divine:throttle:<throttler>:<hash>`.
- `AppThrottlerGuard` — kalit: `user:<id>` (autentifikatsiyadan keyin) yoki `ip:<req.ip>`. `req.ip` Express `trust proxy` = `TRUST_PROXY` bilan aniqlanadi: proksisiz (`0`) `X-Forwarded-For` e’tiborga **olinmaydi**, ya’ni soxta header bilan limitni chetlab o‘tib bo‘lmaydi.
- **Faol (Phase 4):** barcha guruhlar. User kaliti `AccessTokenMiddleware`da token imzosidan (DB'siz) olinadi — guard'lardan oldin, shuning uchun throttler user bo‘yicha hisoblaydi. Login/refresh — `@RateLimitGroup('login' | 'refresh')`, IP bo‘yicha, umumiy limitlarga qo‘shimcha.
- `GET /health` cheklanmaydi (`@SkipAllThrottles` — `@SkipThrottle()` faqat `default` throttler'ni o‘tkazib yuboradi, shuning uchun alohida dekorator) — orkestrator probe'lari 429 olmasin; endpoint maxfiy ma’lumot qaytarmaydi.
- **Redis ishlamasa — fail-open** (so‘rov o‘tadi, `warn` log). Qaror: kassa ishining uzluksizligi rate limit'dan muhimroq; Redis holati `/health` (503) va monitoring orqali darhol ko‘rinadi. Login lockout (Phase 4) esa alohida, PostgreSQL'dagi hisoblagichlarga tayanadi.
- Body chegarasi: `configureApp` — JSON va urlencoded `1mb` → `413 PAYLOAD_TOO_LARGE`.

## 8. RBAC

To‘liq: [RBAC.md](RBAC.md). Asosiy tamoyillar:
- Permission'lar backendda (guard + service ownership + response mapper) tekshiriladi. Frontend tekshiruvi — faqat UX.
- USER faqat biriktirilgan omborlar va o‘z sotuvlarini ko‘radi. Begona resursga `404` qaytadi (mavjudligi oshkor qilinmaydi).
- Maydon darajasidagi himoya: USER javobida `costPrice`, `totalCost`, foyda **umuman** bo‘lmaydi.
- "Himoyasiz endpoint qolmasin": `RouteSecurityAuditor` ilova ishga tushishida tekshiradi + test (**Phase 4 ✔**).
- Permission keshi rol bo‘yicha 60 s: rol permissionlari o‘zgarsa (seed) — 60 s ichida kuchga kiradi. User statusi va `password_changed_at` esa har so‘rovda DB'dan — bloklash **darhol**.

## 9. CSRF

| Endpoint turi | Xavf | Himoya |
|---|---|---|
| Bearer token bilan himoyalangan barcha endpointlar | Yo‘q: brauzer `Authorization` header'ini avtomatik yubormaydi | — |
| `POST /auth/refresh`, `POST /auth/logout` (cookie) | Bor | 1) `SameSite=Strict` cookie; 2) `Origin` header `CORS_ORIGINS` ro‘yxatida bo‘lishi shart; 3) `X-Requested-With: XMLHttpRequest` majburiy — bu cross-origin so‘rovda CORS preflight'ni majburlaydi, preflight esa rad etiladi |
| Cookie `Path` | — | `/api/v1/auth`: cookie boshqa endpointlarga umuman yuborilmaydi |

Prod'da SPA va API bir origin'da (Nginx), shuning uchun cross-origin so‘rovlar umuman kutilmaydi.

## 10. XSS

| Chora | Holat |
|---|---|
| React avtomatik escaping (barcha matn ma’lumot sifatida render qilinadi) | Phase 1 |
| `dangerouslySetInnerHTML` ESLint bilan taqiqlangan | **Phase 1 (tekshirilgan)** |
| Web CSP: `default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; font-src 'self'; connect-src 'self'; object-src 'none'; base-uri 'self'; form-action 'self'; frame-ancestors 'none'` — inline **skript** yo‘q; inline **stil** UI kutubxonalari (Radix pozitsiyalash, grafiklar) uchun ruxsat etilgan (skript bajarmaydi) | **Phase 1 (Nginx)**, Phase 16 da ishlayotgan image'da tekshirildi |
| API CSP: `default-src 'none'; frame-ancestors 'none'` (API faqat JSON qaytaradi) | **Phase 1 (helmet)** |
| Access token xotirada (localStorage emas); refresh token faqat HttpOnly cookie'da; `VITE_*` da secret yo‘q | **Phase 4 (test: `api-client.auth.test.ts`)** |
| Kirishda validatsiya (Zod: tip, uzunlik, format); boshqaruv belgilari (`\u0000–\u001F`, izohlarda yangi qatordan tashqari) rad etiladi | Phase 3 |
| Chiqishda kontekstga mos encoding (React); HTML sanitizatsiya kerak emas, chunki HTML qabul qilinmaydi | — |
| CSV export: formula injection (`=`, `+`, `-`, `@` bilan boshlanadigan katakchalar `'` bilan ekranlanadi) | Phase 12 |

## 11. SQL injection

- Prisma — barcha so‘rovlar parametrlangan.
- Raw SQL faqat tagged template orqali (`` $queryRaw`… ${value}` ``, avtomatik parametrlash). `$queryRawUnsafe`/`$executeRawUnsafe` **taqiqlangan** — ESLint `no-restricted-properties` (**Phase 3, lint probe bilan tekshirilgan**).
- Dinamik `ORDER BY` faqat whitelist orqali: `createSortSchema` (Phase 1) → `toPrismaOrderBy` (har bir ruxsat etilgan maydon uchun dasturchi yozgan mapping) yoki raw SQL'da `toSqlOrderBy` (faqat `Prisma.sql` fragmentlar, yo‘nalish `ASC`/`DESC` literal). Ruxsat etilmagan maydon → `400` (**Phase 3, e2e: `password:asc`, `name;DROP TABLE users` rad etiladi**).
- Identifikatorlar UUID sifatida validatsiya qilinadi (`uuidSchema`).
- DB foydalanuvchisi minimal huquqlarga ega ([DATABASE §6](DATABASE.md#6-db-rollari-va-huquqlar)).

## 12. Secure headers va CORS

**API (helmet — Phase 1'da implement qilingan, e2e testlangan):**

| Header | Qiymat |
|---|---|
| `Content-Security-Policy` | `default-src 'none'; frame-ancestors 'none'` (Swagger UI uchun faqat `/api/docs`da yumshatilgan, prod'da Swagger o‘chiq) |
| `X-Content-Type-Options` | `nosniff` |
| `X-Frame-Options` | `SAMEORIGIN` (+ CSP `frame-ancestors 'none'`) |
| `Referrer-Policy` | `no-referrer` |
| `Cross-Origin-Resource-Policy` | `same-site` |
| `Strict-Transport-Security` | faqat `NODE_ENV=production` (+ TLS terminatorda) |
| `X-Powered-By` | o‘chirilgan |
| `Cache-Control` | `no-store` — **barcha** API javoblari (Phase 16): shaxsiy ma’lumot, kelgan narxi va hisobotlar umumiy kassa kompyuterining brauzer keshiga yozilmaydi |

**Web (Nginx — Phase 1):** CSP (§10), `X-Frame-Options: DENY`, `nosniff`, `Referrer-Policy: strict-origin-when-cross-origin`, `Permissions-Policy` (kamera, mikrofon, geolokatsiya, to‘lov o‘chiq), `Cross-Origin-Opener-Policy: same-origin`, `server_tokens off`.

**CORS (Phase 1):** faqat `CORS_ORIGINS` dagi aniq originlar (`*` sxema darajasida taqiqlangan), `credentials: true`, method va header'lar whitelist'da, `X-Request-Id` expose qilingan. E2e testlangan: begona origin rad etiladi.

## 13. Secret management

| Qoida | Amalga oshirish |
|---|---|
| Secretlar faqat env orqali | `JWT_ACCESS_SECRET`, `PASSWORD_PEPPER`, `DATABASE_URL`, `POSTGRES_PASSWORD` |
| Repoda secret yo‘q | `.env` gitignore'da; `.env.example` faqat namunaviy qiymatlar bilan |
| Image'da secret yo‘q | `.dockerignore` `.env*` ni chiqaradi; env runtime'da beriladi (`env_file`) |
| Startup validatsiyasi | Zod: uzunlik ≥ 32; prod'da `change-me…` rad etiladi; JWT secret ≠ pepper (**Phase 1, testlangan**) |
| Xato xabarlarida secret yo‘q | Config xatosida faqat **kalit nomi** chiqadi, qiymat emas (**Phase 1, testlangan**) |
| Brauzerga faqat `VITE_*` | Vite faqat `VITE_` prefiksli qiymatlarni bundle'ga qo‘shadi; ular secret emas |
| Hosila kalit (SEC-01) | Noma’lum login barmoq izi kaliti `PASSWORD_PEPPER` dan HKDF-SHA256 bilan (`info = divine.uz/unknown-login-fingerprint/v1`) alohida hosil qilinadi — pepper'ning o‘zi HMAC kaliti sifatida ishlatilmaydi, yangi env sir yo‘q, kalit faqat xotirada. Pepper almashtirilsa, izlar ham almashadi (eski va yangi yozuvlar bog‘lanmaydi — qabul qilingan) |
| Rotation | JWT secret almashtirilsa, barcha access tokenlar yaroqsiz bo‘ladi (refresh orqali qayta olinadi). Pepper almashtirilsa: `PASSWORD_PEPPER_V2` qo‘shiladi, yangi hash'lar `v2$`, eskilari muvaffaqiyatli login'da qayta hash qilinadi (Phase 17 runbook) |
| Prod saqlash | Deploy platformasining secret store'i (Phase 17) |

## 14. Logging va redaction

- **pino**, structured JSON (dev'da pretty). Har bir yozuvda `requestId` bor (`X-Request-Id`).
- **Request ID (Phase 3):** eng birinchi middleware beradi (body-parser xatolarida ham). Kiruvchi `X-Request-Id` faqat `^[A-Za-z0-9-]{8,64}$` bo‘lsa qabul qilinadi — log injection va header splitting'ga yo‘l yo‘q; aks holda yangi UUID. Header, xato javobidagi `requestId` va log yozuvlari bir xil ID.
- **So‘rov logi (Phase 3):** `req.id`, `req.method`, `req.url` (**query string'siz** — qidiruvdagi telefon raqami kabi PII log'ga tushmaydi), `route` (shablon, masalan `/api/v1/products/:id`), `res.statusCode`, `responseTime` (ms). Daraja: 2xx/3xx `info`, 4xx `warn`, 5xx `error`.
- **So‘rov body'si log qilinmaydi.** Header'lar serializer'da umuman yo‘q.
- **Redact (Phase 1, Phase 3'da kengaytirilgan, testlangan):** `req.headers.authorization`, `req.headers.cookie`, `res.headers["set-cookie"]`, hamda istalgan chuqurlikdagi (3 darajagacha) `password`, `generatedPassword`, `passwordHash`, `password_hash`, `pepper`, `token`, `accessToken`, `refreshToken`, `refresh_token`, `tokenHash`, `token_hash`, `jwt`, `secret`, `authorization`, `cookie`, `cookies` → `[YASHIRILGAN]`.
- **Xato log'lari (Phase 3):** `serializeErrorForLog` — Prisma/DB xatolaridan faqat identifikatorlar (SQLSTATE, constraint, Prisma kodi, model). Prisma xabarlari so‘rov argumentlarini (masalan, `passwordHash` qiymati), DB `detail` esa qator qiymatlarini o‘z ichiga oladi — ular **yozilmaydi** (e2e va unit testlar bilan tekshirilgan).
- `console.*` backendda ESLint bilan taqiqlangan, faqat logger ishlatiladi.
- Health-check so‘rovlari log'ni to‘ldirmasligi uchun avtomatik log qilinmaydi.
- Kutilmagan xatolar: stack trace faqat server logida, client'ga `INTERNAL_ERROR` va `requestId` qaytadi.
- PII minimal: mijoz telefon raqamlari log qilinmaydi (body log qilinmaydi).

## 15. Audit immutability

| Qatlam | Chora |
|---|---|
| API | Audit yozish, o‘zgartirish va o‘chirish endpointlari **yo‘q**. Faqat `GET` (`audit.read`) |
| Application | Audit faqat service'lar ichida, **biznes amali bilan bitta tranzaksiyada** yoziladi (amal rollback bo‘lsa, audit ham rollback bo‘ladi) |
| Database | `trg_audit_logs_immutable` — `UPDATE`, `DELETE`, `TRUNCATE` rad etiladi |
| DB huquqlari | `divine_app` roli `audit_logs`da faqat `SELECT, INSERT` huquqiga ega |
| Mazmun | actor, vaqt (`now()` — DB soati), action, entity type/id, metadata (`before`/`after` diff), IP, user-agent, requestId. **Parol, hash va token yozilmaydi**; mavjud bo‘lmagan login xom holda emas — barmoq izi yoki maska (§15.1, Phase 16) |
| Saqlash | Muddatsiz |

Xuddi shu himoya `inventory_movements`, `sales`, `sale_items` jadvallariga ham qo‘llanadi.

### 15.1. SEC-01: login maydoniga yozilgan parol auditda qolishi mumkin edi — YOPILDI (Phase 16)

**Holat: YOPILDI (2026-10-30, Phase 16).** Phase 14 tekshiruvida topilgan (2026-10-29).

- **Muammo (tuzatishdan oldin):** `POST /auth/login` da login topilmasa, `AUTH_LOGIN_FAILED` (`INVALID_CREDENTIALS` va lock paytidagi `ACCOUNT_LOCKED`) va `AUTH_ACCOUNT_LOCKED` audit yozuvlari `metadata.login`ga **kiritilgan qiymatni o‘zgarishsiz** yozardi. `LOGIN_PATTERN` (`^[A-Za-z0-9]+$`, 3–32) 6 raqamli parolni ham qabul qiladi — parolni login maydoniga yozgan foydalanuvchining paroli **o‘zgarmas** audit jadvaliga tushardi va "Audit jurnali"da (API javobida) ko‘rinardi. Xuddi shu qiymat Redis lockout kaliti nomida (`divine:auth:unknown:<lower(login)>`, TTL 7 kun) turardi. So‘rov body'si log qilinmaydi — log'ga tushmagan (Phase 16 log grep testi bilan tasdiqlandi).
- **Variantlar bahosi:**
  1. *HMAC barmoq izi* — takroriy urinishlarni bog‘laydi, qiymat ochilmaydi. **Lekin** 6 raqamli qiymat uchun yetarli emas: kalit (server sirlari) qachondir oshkor bo‘lsa, 10⁶ variantni bir zumda tekshirib parolni tiklash mumkin, o‘zgarmas audit esa izni abadiy saqlaydi.
  2. *Parol shaklidagi qiymatni maskalash* — oddiy; boshqa loginlar uchun yolg‘iz qo‘llanganda xom qiymat qoladi.
  3. *Raqamli loginni taqiqlash* — BR-03 (biznes qoidasi) o‘zgaradi; tanlanmadi.
- **Tanlangan yechim — 1 va 2 birikmasi** (`backend/src/common/security/login-fingerprint.ts`):
  - kiritilgan qiymat aynan 6 raqam (BR-04 parol shakli) bo‘lsa — faqat `{ loginMasked: true, loginLength: 6 }`, **barmoq izi ham yo‘q**;
  - boshqa noma’lum login — `{ loginFingerprint: <HMAC-SHA256 128 bit, hex>, loginLength }` (katta-kichik harf farqsiz): urinishlar bog‘lanadi, qiymat ochilmaydi;
  - kalit — `PASSWORD_PEPPER` dan HKDF bilan alohida hosil qilingan (§13); DB, log, xato javobi va API'da yo‘q;
  - Redis kaliti — `divine:auth:unknown:fp:<to‘liq HMAC>`; ilova ishga tushganda xom loginli **eski** kalitlar `SCAN` + `UNLINK` bilan o‘chiriladi (ular faqat mavjud bo‘lmagan loginlarning hisoblagichlari — hech bir akkaunt himoyasi kamaymaydi; log'ga faqat son yoziladi);
  - mavjud login uchun yozuvlar o‘zgarmadi (`login` — haqiqiy login, `userId`).
- **Eski audit yozuvlari:** DB'da **o‘zgartirilmaydi** (immutable, D-06 — trigger va huquqlar; migratsiya yo‘q). API (`GET /audit-logs`, `/:id`) ularni o‘qishda xuddi shu qoida bilan ko‘rsatadi (`knownUser: false` + `login` → maska yoki iz) — xom qiymat javobga chiqmaydi. **Qoldiq:** xom qiymat eski qatorlarda DB darajasida (DBA, backup) qoladi — o‘chirish audit yaxlitligini buzadi, qilinmaydi. Bunday qatorlar SEC-01 tuzatishigacha ishlagan har bir bazada (dev, test, agar bo‘lsa — prod) qoladi.
- **Mock (demo):** brauzerda kalit yo‘q — faqat `loginLength` va parol shaklida `loginMasked` (D-22 shakli bilan mos, izsiz).
- **Testlar (eski kodda yiqilishi tekshirildi):** `auth.db-spec.ts` → "SEC-01: …" (4): login maydoniga 6 raqam — audit (xato, lock, lock paytidagi), Redis va API'da xom qiymat yo‘q; boshqa noma’lum login — iz, bog‘lanish, lockout; eski yozuvlar DB'da o‘zgarmaydi, API maska/iz bilan ko‘rsatadi; eski Redis kalitlari o‘chiriladi. Unit `login-fingerprint.spec.ts` (5), frontend `mock-api.test.ts`. Qo‘shimcha: `security-leaks.db-spec.ts` (log, audit, Redis — to‘liq oqim).

## 16. Tahdid modeli (qisqacha)

| Tahdid | Asosiy chora |
|---|---|
| Parolni taxmin qilish (online) | Progressive lockout, IP throttle, CSPRNG parollar, audit |
| DB oqishi | argon2id + pepper, refresh token hash'lari, DB'da secret yo‘q |
| Token o‘g‘irlash (XSS) | CSP, access token xotirada, qisqa TTL, refresh rotation + reuse detection |
| CSRF | Bearer header, SameSite=Strict, Origin + custom header |
| Ruxsatsiz kirish (broken access control) | Global deny-by-default guard, permission va ownership, matritsa asosidagi testlar |
| Overselling va race condition | Atomic shartli UPDATE, CHECK, concurrency testlari |
| Ma’lumotni soxtalashtirish | DB constraint'lar, immutable ledger va audit, server-side totallar va narxlar |
| Mass assignment | Zod `strictObject`, narx, total va userId client'dan qabul qilinmaydi |
| SQL injection | Parametrlangan so‘rovlar, sort whitelist |
| DoS | Rate limit, body limit, pagination chegaralari, so‘rov timeout'lari |
| Supply-chain | Lockfile, pnpm `allowBuilds`, `minimumReleaseAge`, Dependabot, minimal non-root image'lar |
| Ma’lumot oqishi (xato va log) | Yagona error filter, redaction, prod'da Swagger o‘chiq |

## 17. OWASP Top 10 xaritasi va holat

| OWASP | Chora | Holat |
|---|---|---|
| A01 Broken Access Control | RBAC, ownership, deny-by-default | **✔ Phase 4** (guard'lar, auditor, ownership helper'lari) · modul darajasi — Phase 5+ |
| A02 Cryptographic Failures | argon2id + pepper, TLS, HSTS, secretlar env'da | **✔ Phase 4** (argon2id + pepper, SHA-256 refresh hash) · TLS/HSTS — Phase 17 |
| A03 Injection | Prisma, tagged raw SQL, Zod, sort whitelist | **✔ Phase 3** (Zod pipe, sort mapping, `$queryRawUnsafe` taqiqi) |
| A04 Insecure Design | Ledger, tranzaksiyalar, server-side totallar, idempotency | DB invariantlari ✔ Phase 2 · TransactionRunner ✔ Phase 3 |
| A05 Security Misconfiguration | helmet, CSP, CORS whitelist, prod'da Swagger o‘chiq, non-root container, `no-store` | **✔ Phase 1** · Phase 16: production web image mock API bilan yig‘ilardi — tuzatildi (§19) |
| A06 Vulnerable Components | Dependabot, `pnpm audit`, supply-chain sozlamalari | **✔ Phase 1** · **✔ Phase 16:** `pnpm audit --prod` — 0 (3 high yangilandi, §19) |
| A07 Identification & Auth Failures | Lockout, rotation, reuse detection, darhol bloklash | **✔ Phase 4** |
| A08 Software & Data Integrity | Frozen lockfile, CI, immutable ledger va audit | CI ✔ · Phase 2 |
| A09 Logging & Monitoring Failures | pino, requestId, audit, redaction | **✔ Phase 1/3** (audit — Phase 5+) |
| A10 SSRF | Server tashqi URL'larga so‘rov yubormaydi | N/A |

### Phase 1'da implement qilingan va tekshirilgan xavfsizlik choralari

| Chora | Tekshiruv |
|---|---|
| helmet (API CSP `default-src 'none'`, nosniff, X-Powered-By o‘chiq) | e2e test + real smoke test |
| CORS whitelist (begona origin rad etiladi) | e2e test |
| `X-Request-Id` (xavfsiz bo‘lmagan qiymat rad etiladi) | e2e test |
| Log redaction (parol, token, cookie, authorization) | unit test |
| Env validatsiyasi (secret uzunligi, prod placeholder, secret ≠ pepper, xatoda qiymat chiqmasligi) | unit test |
| Prod'da Swagger o‘chiq | unit test + Docker smoke test (404) |
| Nginx secure header'lari, SPA fallback, immutable kesh | Docker smoke test |
| Non-root container (`uid=1000(node)`), healthcheck | Docker smoke test |
| `dangerouslySetInnerHTML` va qo‘lda yozilgan UI matni ESLint bilan taqiqlangan | lint probe |
| Supply-chain: `allowBuilds`, `minimumReleaseAge`, `.pnpmfile.cjs` (prod image'dan CLI va dev paketlar chiqarilgan), Dependabot | install + image tekshiruvi |

### Phase 3'da implement qilingan va tekshirilgan xavfsizlik choralari

| Chora | Tekshiruv |
|---|---|
| Yagona xato javobi: stack, SQL, constraint nomi, framework xabari chiqmaydi | e2e (`foundation.e2e-spec.ts`) |
| Noma’lum xato → `500 INTERNAL_ERROR`; tafsilot faqat server log'ida `requestId` bilan | e2e (log ushlab olinadi) |
| DB xatosi log'ida qiymatlar (hash, qator) yo‘q | e2e + unit + real PG (`error-mapping.db-spec.ts`) |
| Authorization, Cookie, body'dagi parol log'ga tushmaydi; URL query log'ga tushmaydi | e2e |
| `X-Request-Id` validatsiyasi; parser xatolarida ham ID | e2e + real API smoke |
| Zod validatsiyasi (body/query/params), noma’lum body maydonlari rad etiladi | e2e |
| Sort whitelist (injection urinishlari) | e2e |
| Body ≤ 1 MB → 413 | e2e |
| Rate limit 429 + `Retry-After`; Redis'da atomik; Redis ishlamasa fail-open | e2e + real Redis (`redis-throttler.db-spec.ts`) |
| `$queryRawUnsafe` / `$executeRawUnsafe` taqiqi | ESLint + lint probe |

### Phase 4'da implement qilingan va tekshirilgan xavfsizlik choralari

| Chora | Tekshiruv |
|---|---|
| argon2id + pepper (`v1$`), noto‘g‘ri pepper bilan verify o‘tmaydi, hash formati | unit (`password-hasher.spec.ts`) |
| Login: bir xil `401` (login yo‘q / parol noto‘g‘ri), dummy verify | real PG + Redis (`auth.db-spec.ts`) |
| Progressive lockout 5 xato → 15 → 30 daq…, `Retry-After`, lock paytidagi urinishlar hisoblanmaydi, noma’lum login ham lock oladi | real PG + Redis |
| BLOCKED user: to‘g‘ri parol → `403`, keyingi so‘rov → `401` | real PG + Redis |
| Refresh rotation, reuse → family revoke + audit | real PG + Redis |
| CSRF (refresh/logout): `Origin` va `X-Requested-With` | real PG + Redis |
| Parol o‘zgargandan keyin eski access token → `401 SESSION_EXPIRED` | real PG + Redis |
| RBAC: 401/403, `@RequireAnyPermission`, ownership helper'lari, himoyasiz endpoint — ilova ishga tushmaydi | unit (`rbac.spec.ts`) + real PG |
| Auth rate limit: login 10/daq/IP (429 + `Retry-After`); user bo‘yicha read/write limitlari | real PG + Redis. Refresh 30/daq — xuddi shu mexanizm, alohida testi **yo‘q** |
| Audit'da parol/hash/token yo‘q (metadata sanitizatsiyasi) | real PG + Redis |
| Bootstrap CLI: HTTP endpoint yo‘q, parol bir marta, ikkinchi admin yaratilmaydi, parallel ishga tushirishda bitta g‘olib (advisory lock) | real PG (`bootstrap-admin.db-spec.ts`) |
| Frontend: token xotirada, 401 → bitta refresh → qayta urinish; refresh muvaffaqiyatsiz → login | unit (`api-client.auth.test.ts`) + brauzer QA |

### Phase 5'da implement qilingan va tekshirilgan xavfsizlik choralari

| Chora | Tekshiruv |
|---|---|
| Parolni faqat server yaratadi (CSPRNG); client `password`/`passwordHash`/`status`/`permissions` yubora olmaydi (`400`) | real PG (`users.db-spec.ts`) |
| DB'da faqat `v1$` argon2id hash; parol javobda bir marta, `Cache-Control: no-store`; ro‘yxat/detalda parol, hash, sessiya, lockout hisoblagichi yo‘q | real PG |
| Bloklash darhol: access token → `401`, refresh → `401`, sessiyalar `USER_BLOCKED` | real PG + Redis |
| Parol tiklash: eski parol va eski tokenlar ishlamaydi, yangi parol ishlaydi, sessiyalar `PASSWORD_RESET`, lockout tozalanadi | real PG + Redis |
| Self-protection va oxirgi faol ADMIN (parallel holat ham) | real PG + unit (`users.service.spec.ts`) |
| Ombor ownership: biriktirilmagan omborga ID bilan `403`; biriktirish olib tashlansa — o‘sha token bilan keyingi so‘rov darhol `403` | real PG + Redis (probe endpoint) |
| Audit (`USER_*`) — actor, target, o‘zgarishlar; parol, hash, token yo‘q | real PG |
| Qidiruvda LIKE belgilari ekranlangan (`%`, `_` — oddiy belgi) | real PG |

### Phase 6'da implement qilingan va tekshirilgan xavfsizlik choralari

| Chora | Tekshiruv |
|---|---|
| Kelgan narxi (`costPrice`) faqat `products.read_cost` bilan: barcha mahsulot javoblari bitta serializer (`toProductDto`) orqali, ruxsatsiz userga kalit umuman yo‘q | real PG (`products.db-spec.ts`): ro‘yxat, detal, lookup, ombor filtri, xato javoblari |
| Kelgan narxi bo‘yicha saralash ruxsatsiz → `400` (tartib orqali oshkor bo‘lmasin); `/summary` → `403` | real PG |
| Sotuvchi faqat ACTIVE mahsulotlarni va faqat biriktirilgan omborlar bo‘yicha miqdorlarni ko‘radi; begona ombor ID → `403` | real PG + Redis |
| Frontend ham yashiradi (ustun, tafsilot, tugmalar) — lekin bu faqat UX; mock API ham backend kabi kalitni bermaydi | `ProductsPage.test.tsx` + brauzer E2E (real backend) |
| Shtrix-kod unique (arxivdagilar ham), parallel so‘rovlarda ham — DB unique → `409 BARCODE_TAKEN` | real PG (5 ta parallel) |
| Qidiruvda LIKE belgilari ekranlangan; saralash whitelist | real PG |

### Phase 7'da implement qilingan va tekshirilgan xavfsizlik choralari

| Chora | Tekshiruv |
|---|---|
| Ombor ownership (OWN-01): sotuvchi ro‘yxatda faqat biriktirilgan ACTIVE omborni, ko‘rsatkichlarsiz ko‘radi; query filtrlari (`status`, `search`) doirani kengaytirmaydi | real PG + Redis (`warehouses.db-spec.ts`) + real backend E2E |
| Detal, qoldiq, harakatlar, inventar va reconciliation — faqat ADMIN permission’lari; to‘g‘ridan-to‘g‘ri API so‘rovi bilan ham `403` | real PG + Redis, real backend E2E (curl o‘rniga `fetch`) |
| Frontend yuborgan `warehouseId`ga ishonilmaydi: `assertWarehouseAccess` har so‘rovda `user_warehouses`dan yig‘ilgan kontekst bo‘yicha | real PG |
| Nofaol omborga yangi kirim/sotuv → `422 WAREHOUSE_INACTIVE`; tekshiruv tranzaksiya ichida, ombor `FOR SHARE` — parallel nofaol qilish (`FOR UPDATE`) poygasi yo‘q | real PG (holat o‘zgarishi operatsiya tugashini kutishi testlangan) |
| Kelgan narxiga bog‘liq maydonlar (`stockValue`, `costPrice`, `unitCost`) faqat `products.read_cost`; `sort=stockValue` ruxsatsiz → `400` | real PG (service darajasida, ruxsatsiz kontekst) + unit (`toMovementDto`) |
| Ledger o‘zgarmaydi: nofaol qilish qoldiq, harakat, hujjat va biriktiruvlarga tegmaydi; o‘chirish endpointi yo‘q | real PG |
| Reconciliation faqat o‘qiydi (avtomatik tuzatish yo‘q); har ishga tushirish audit’ga; kunlik job Redis qulfi bilan bitta instansiyada | real PG + unit |
| Audit metadata’da faqat nom, o‘zgarishlar va sonlar — sir yoki token yo‘q | real PG |

### Phase 8'da implement qilingan va tekshirilgan xavfsizlik choralari

| Chora | Tekshiruv |
|---|---|
| Kirim endpointlari faqat `incoming.*` ruxsatlari bilan; sotuvchi to‘g‘ridan-to‘g‘ri API so‘rovi bilan ham (o‘z ombori ID'si bilan ham) `403`, xato javobida narx yo‘q | real PG + Redis (`incoming.db-spec.ts`) + real backend E2E |
| Frontend yuborgan `warehouseId`ga ishonilmaydi: yaratish/tahrirlash/tasdiqlashda `assertOperationalWarehouse` (ruxsat + ACTIVE, tranzaksiya ichida); begona ombor hujjati — `404` | real PG (service darajasida, cheklangan kontekst) |
| Kelgan narxi (`costPrice`, `lineTotal`, `totalAmount`) faqat `products.read_cost` — barcha javoblar bitta serializer (`toIncomingDto`); summa bo‘yicha saralash ruxsatsiz → `400` | real PG + unit (`test/unit/incoming`) |
| Totallarni faqat server hisoblaydi: client `totalAmount`/`totalQuantity`/`lineTotal` — noma’lum maydon → `400`; `line_total` DB GENERATED | real PG + shared unit |
| Qoldiq faqat `InventoryService` orqali; tasdiqlash atomik (ledger yozish o‘rtasidagi nosozlikda to‘liq rollback), takroriy/parallel tasdiqlash qoldiqni bir marta oshiradi | real PG (sun’iy nosozlik, 5 ta parallel so‘rov) |
| Tasdiqlangan/bekor qilingan hujjat o‘zgarmaydi — service `409` + DB trigger (`incoming_guard`, `incoming_items_guard`) | real PG |
| Ichki xato (500) javobida sabab matni yo‘q (faqat server log'ida) | real PG (atomiklik testi) |
| Audit metadata’da raqam, ombor, sonlar va totallar — token yoki sir yo‘q | real PG |

### Phase 9'da implement qilingan va tekshirilgan xavfsizlik choralari

| Chora | Tekshiruv |
|---|---|
| OWN-07: sotuvchi mijoz qidiruvida faqat `id, name, phone`; detal, xarid tarixi, tahrirlash — `403`; yig‘ma bo‘yicha saralash (tartib orqali oshkor bo‘lishi) — `400` | real PG + Redis (`customers.db-spec.ts`) + real backend E2E |
| Izoh (ichki ma’lumot) faqat `customers.manage` bilan yoziladi va o‘qiladi | real PG |
| Shaxsiy ma’lumot audit'ga yozilmaydi: `CUSTOMER_CREATED` — `{ hasPhone, hasNotes }`, `CUSTOMER_UPDATED` — faqat o‘zgargan maydon nomlari | real PG (metadata'da ism/telefon/izoh yo‘qligi tekshiriladi) |
| Xarid tarixida tannarx va foyda faqat `products.read_cost` (`toSaleDto`) | real PG + unit (`test/unit/customers`) |
| Qidiruvda LIKE belgilari ekranlangan; telefon qidiruvi faqat raqamlar bilan | real PG |
| Body `strictObject` — client yig‘ma ustunlarni (`totalSpent`, `purchaseCount`) yubora olmaydi | real PG + shared unit |

### Phase 10'da implement qilingan va tekshirilgan xavfsizlik choralari

| Chora | Tekshiruv |
|---|---|
| Narx va tannarx faqat serverda (kartochkadan snapshot, D-16); client `unitPrice`/`totalAmount` — `400` | real PG (`sales.db-spec.ts`) + real backend E2E |
| Ombor ownership (OWN-02) va faollik tranzaksiya ichida, ombor `FOR SHARE`; begona ombor ID — `403` | real PG |
| Sotuvchi faqat o‘z sotuvlarini ko‘radi (OWN-04/05): ro‘yxat majburan o‘ziniki, begona detal — `404` | real PG + mock pariteti |
| Tannarx/foyda faqat `products.read_cost` — bitta serializer (`toSaleDto`), summary ham | real PG + unit |
| Idempotentlik: `Idempotency-Key` (UUID) UNIQUE + kanonik payload SHA-256; boshqa payload yoki boshqa user — `409`; parallel bir xil so‘rov — bitta sotuv | real PG (5 ta parallel, ekvivalent payload) |
| Overselling yo‘q: 20 ta parallel sotuv, qoldiq 10 → aniq 10 tasi (AC-13); qoldiq yetmasa — to‘liq rollback | real PG |
| Atomiklik: ledger yozish o‘rtasidagi nosozlikda sotuv, qoldiq, yangi mijoz va audit saqlanmaydi; 500 javobida sabab matni yo‘q | real PG (sun’iy nosozlik) |
| Audit'da tannarx va shaxsiy ma’lumot yo‘q (`SALE_CREATED` — raqam, ombor, mijoz ID, sonlar, summa) | real PG |

### Phase 11'da implement qilingan va tekshirilgan xavfsizlik choralari

| Chora | Tekshiruv |
|---|---|
| Ruxsat backend'da: ro‘yxat/detal — `expenses.read`; qo‘shish — `expenses.create`/`manage`; tahrirlash, o‘chirish, kategoriya boshqaruvi — `expenses.manage`; sotuvchi kategoriyalari — faqat faol `{ id, name }` (serializer `toExpenseCategoryDto`) | real PG (`expenses.db-spec.ts`) + unit + mock pariteti + real backend E2E |
| Body `strictObject`: `status` (D-11) va noma’lum maydonlar — `400`; summa > 0 (BR-32, DB `CHECK` ham); kategoriya majburiy (DB NOT NULL ham) | real PG + shared |
| Kelajak sana serverning `Clock`i bo‘yicha rad etiladi (client vaqtiga ishonilmaydi), Toshkent yarim tuni chegarasi | unit (`ManualClock`) + real PG |
| Nofaol kategoriyaga yozish poygasi: kategoriya xarajat tranzaksiyasida `FOR SHARE` | real PG |
| Soft delete: moliyaviy qator va summa bazada qoladi (`deleted_at`, `deleted_by`); parallel ikki DELETE → bitta `204`, bitta `404`, bitta audit | real PG |
| Audit'da izoh matni yo‘q (`hasNote`, maydon nomlari); sana, summa, kategoriya ID — `from/to` bilan | real PG |
| Xarajatlar ombor ledger'i, qoldig‘i va sotuvlarga ta’sir qilmaydi | real PG |

### Phase 13'da implement qilingan va tekshirilgan xavfsizlik choralari

| Chora | Tekshiruv |
|---|---|
| Audit faqat o‘qiladi: `GET /audit-logs`, `GET /audit-logs/:id` — `audit.read`; yozish/o‘zgartirish/o‘chirish endpointlari yo‘q (`404`); DB trigger (`DV001`) va `divine_app` huquqlari (§15) | real PG (`audit.db-spec.ts`) |
| Har bir mutatsiya endpointi audit yozadi (AC-21) — ro‘yxat Nest metadata’sidan avtomatik, yangi endpoint qarorsiz qolmaydi; audit — o‘sha so‘rov (`request_id`), to‘g‘ri actor va obyekt | real PG + Redis (`audit-coverage.db-spec.ts`) |
| Audit amal bilan bitta tranzaksiyada: muvaffaqiyatsiz mutatsiya (`400`, `409`) audit qoldirmaydi | real PG |
| Javobda `userAgent` yo‘q; metadata’da parol, hash, token yo‘q (yozishda tozalanadi); IP faqat `audit.read` egasiga. SEC-01 (§15.1) — Phase 16 da yopildi | real PG + unit |
| Filtr va cursor qiymatlari parametr sifatida (SQL injection yo‘q); buzilgan cursor — `400`; `limit` ≤ 100 | real PG + shared |

### Phase 12'da implement qilingan va tekshirilgan xavfsizlik choralari

| Chora | Tekshiruv |
|---|---|
| Ruxsat backend'da: hisobotlar — `reports.read`, admin dashboard — `dashboard.admin`, sotuvchi — faqat `dashboard/my-summary` (`dashboard.own`, `WHERE user_id = ctx.userId`); sozlamalar — `settings.read` / `settings.manage` | real PG (`reports`, `dashboard`, `settings` `.db-spec.ts`) + mock pariteti |
| Tannarx va undan hisoblanadiganlar (foyda, ombor tannarxi, kirim summasi) — bitta joyda (`visibleReportParts`) ustun, qiymat va yig‘madan olib tashlanadi; yashirin ustun bo‘yicha saralash — `400` (qiymatni tartib orqali sizdirmaslik) | unit (`reports.spec.ts`) + real PG |
| Saralash va filtr whitelist'i `ReportDefinition`dan: SQL'ga faqat ma’lum ustun nomlari `Prisma.raw` bilan, qiymatlar — parametr; `search` LIKE belgilari ekranlanadi | real PG + unit |
| Resurs cheklovi: sana oralig‘i majburiy va ≤ 366 kun, `pageSize` ≤ 100 — cheksiz to‘liq skan so‘rovi yo‘q | real PG + mock pariteti |
| Dashboard va hisobot so‘rovlari bitta `REPEATABLE READ` snapshot'dan (parallel sotuv yig‘ma va sahifani farqlantirmaydi) | real PG |
| Sozlamalar: `strictObject` (noma’lum va eski mock maydonlari — `400`), kalit qatorlari `FOR UPDATE`, audit `SETTINGS_UPDATED` faqat haqiqiy o‘zgarishda (`from/to`) | real PG |

### Phase 16'da tekshirilgan va tuzatilgan xavfsizlik choralari

| Talab | Tekshiruv yoki test |
|---|---|
| SEC-01: noma’lum login xom qiymati audit, Redis va API'da yo‘q; eski yozuvlar o‘zgarmaydi | `auth.db-spec.ts` "SEC-01" (4), unit `login-fingerprint.spec.ts` (5), `mock-api.test.ts` |
| Log, audit va Redis'da parol (yaratilgan, tiklangan, urinilgan, login maydonidagi), access/refresh token, token va parol hash'i, JWT secret, pepper yo‘q — to‘liq oqimdan keyin grep | `security-leaks.db-spec.ts` (pino `trace`, 90+ yozuv) |
| Har bir GET endpoint javobi (ADMIN va USER, haqiqiy ID'lar bilan, metadata'dan topilgan 42 ta): maxfiy kalit (`pass/hash/secret/pepper/cookie/token`), hash yoki JWT yo‘q | `security-leaks.db-spec.ts` |
| RBAC fuzz: sotuvchi ruxsatsiz endpointlarga yo‘l variantlari (katta harf, `/`, kodlangan belgi, query'da rol), HEAD, method-override bilan kira olmaydi | `security-fuzz.db-spec.ts` |
| JWT: to‘g‘ri imzoli, lekin `role: ADMIN` yozilgan sotuvchi tokeni ham `403` (ruxsat DB'dan); payload o‘zgartirilgan, begona kalit, pepper bilan imzo, mavjud bo‘lmagan user, iss/aud xato → `401` | `security-fuzz.db-spec.ts`, `auth.db-spec.ts` (`alg=none`, muddati o‘tgan) |
| Input fuzz: har bir yozuvchi endpoint × 12 xil buzilgan body, path (SQL, traversal, NUL, 4000 belgi) va query (saralash injection, `__proto__`, chegaradan tashqari sahifa) — 5xx yo‘q, xato shakli yagona, stack/SQL yo‘q, prototype pollution yo‘q | `security-fuzz.db-spec.ts` (~1 200 so‘rov) |
| Endpoint × rol matritsasi (AC-18) | `rbac-matrix.db-spec.ts` (Phase 15) |
| Production header'lari (HSTS, CSP, nosniff, frame, referrer, CORP, COOP) muvaffaqiyatli va xato javoblarida; `X-Powered-By` yo‘q; Swagger `404` | `security-hardening.db-spec.ts` + ishlayotgan API image (`--read-only`, `NODE_ENV=production`) |
| Biznes javoblari `Cache-Control: no-store` | `security-hardening.db-spec.ts` (eski kodda yiqildi) |
| Refresh cookie: `HttpOnly; Secure; SameSite=Strict; Path=/api/v1/auth`, `Domain`siz | `security-hardening.db-spec.ts`, `auth.db-spec.ts` |
| Refresh rate limit 30/daq/IP (Phase 4 da testi yo‘q edi) | `security-hardening.db-spec.ts` (cookie'siz va haqiqiy rotatsiya bilan) |
| Login enumeration: mavjud login + xato parol va mavjud bo‘lmagan login — status, kod, xabar, header'lar bir xil; median vaqt farqi < 35% (ikkalasida argon2) | `security-hardening.db-spec.ts`; lockout — `auth.db-spec.ts` |
| Brauzer: sotuvchi 9 ta admin sahifasini URL bilan ochsa "Ruxsat yo‘q", admin API'si chaqirilmaydi; devtools'dan o‘z sessiyasi tokeni bilan 9 ta admin so‘rovi — `403`; token `localStorage`/`sessionStorage`da yo‘q, refresh cookie JS'ga ko‘rinmaydi; kelgan narxi UI va javobda yo‘q | Playwright `main-flows.spec.ts` (Phase 16 qadami) |
| Production build API rejimisiz yig‘ilmaydi; web image — `VITE_API_MODE=http` | `build-api-mode.test.ts`; `.env`siz build simulyatsiyasi + brauzer tekshiruvi (§19) |
| Nginx header'lari, non-root (`nginx`, `node`), `--read-only --cap-drop ALL --security-opt no-new-privileges` bilan ishlash; web image haqiqiy API'ga murojaat qiladi | joriy kod bilan yig‘ilgan `divine-api`/`divine-web` image'lari to‘liq stek sifatida (PG + Redis + API + Nginx) ishga tushirilib tekshirildi (2026-10-30) |
| `pnpm audit --prod` — 0 | buyruq (§19) |

## 18. Phase 16 xavfsizlik checklist'i

- [x] Har bir endpoint × rol matritsa testi o‘tadi (AC-18), himoyasiz endpoint yo‘q — `rbac-matrix.db-spec.ts`, `RouteSecurityAuditor`; Phase 16: `security-fuzz.db-spec.ts`
- [x] `pnpm audit --prod` — critical/high yo‘q (0 ta; dev — 1 high, §19)
- [x] Login brute-force testi: progressive lockout ishlaydi, enumeration yo‘q (javob va vaqt bir xil) — `auth.db-spec.ts`, `security-hardening.db-spec.ts`
- [x] Refresh reuse detection testi — `auth.db-spec.ts`; `security-leaks.db-spec.ts` (oqimda)
- [x] Log'larda parol, token va cookie yo‘qligi (grep testi) — `security-leaks.db-spec.ts`
- [x] SEC-01 (§15.1) yopilgan: noma’lum login xom qiymati audit va Redis'da saqlanmaydi — `auth.db-spec.ts` "SEC-01"
- [x] Header'lar: securityheaders darajasida tekshiruv (CSP, HSTS) — API: `security-hardening.db-spec.ts`; web (Nginx): ishlayotgan image. Web'da HSTS — TLS terminatorda (Phase 17)
- [x] DB huquqlari: `divine_app` ledger va auditni o‘zgartira olmaydi — `immutability.db-spec.ts`, `migrations.db-spec.ts`. Prod'da ilovani `divine_app` a’zosi bilan ulash — Phase 17 (DATABASE §6)
- [x] Prod env: `NODE_ENV=production`, Swagger o‘chiq, `TRUST_PROXY` to‘g‘ri, secretlar noyob — `env.schema.spec.ts`, `security-hardening.db-spec.ts`, docker-compose (`TRUST_PROXY: 1` — Nginx ortida)
- [x] Docker: non-root, read-only filesystem imkoniyati, minimal image — joriy kod bilan yig‘ilgan image'lar: `uid=1000(node)` / `uid=101(nginx)`, `--read-only --tmpfs /tmp --cap-drop ALL --security-opt no-new-privileges` bilan sog‘lom, `/app` ga yozish rad etiladi; runtime image faqat production bog‘liqliklar (alpine)
- [x] Backup va tiklash sinovi — **Phase 17** da bajarildi: [§20.2](#202-backup-va-tiklash)

## 19. Phase 16 natijalari va qolgan xavflar

**Topilgan va tuzatilgan (har biri uchun test avval eski kodda yiqilgan):**

| # | Muammo | Daraja | Tuzatish | Test |
|---|---|---|---|---|
| 1 | SEC-01: login maydoniga yozilgan parol audit va Redis'da ochiq | Yuqori (o‘zgarmas jadvalda parol) | §15.1 | `auth.db-spec.ts` "SEC-01" |
| 2 | **Production web image brauzer ichidagi mock API bilan yig‘ilardi:** Vite `.env`ni repo ildizidan o‘qiydi, `.dockerignore` uni image'ga kiritmaydi, `web.Dockerfile` esa `VITE_API_MODE` bermasdi → standart `mock`. Deploy qilinganda SPA backend'ga umuman murojaat qilmasdi, login'siz demo sessiya bilan ochilardi, sotuvlar brauzer `localStorage`'iga yozilardi | Yuqori (A05; ma’lumot yaxlitligi) | `web.Dockerfile`: `ARG VITE_API_MODE=http`; `vite build` rejim aniq berilmasa to‘xtaydi (`assertBuildApiMode`); CI build qadamida `VITE_API_MODE: http` | `build-api-mode.test.ts`; `.env`siz build: tuzatishdan oldin — `/api`ga 0 so‘rov, `/` (mock sessiya); keyin — rejimsiz build to‘xtaydi, `http` bilan — `POST /api/v1/auth/refresh` → `/login`; joriy kod bilan yig‘ilgan `divine-web` image ham — haqiqiy API'ga `POST /api/v1/auth/refresh` (401) → `/login` |
| 3 | Biznes GET javoblarida `Cache-Control` yo‘q edi — shaxsiy ma’lumot va kelgan narxi umumiy kompyuter brauzer keshida qolishi mumkin | O‘rta (OWASP ASVS 8.2.1) | barcha API javoblariga `no-store` (`configure-app.ts`) | `security-hardening.db-spec.ts` |
| 4 | `pnpm audit --prod`: 3 high (zod 4.6.5 — xotira tugashi; body-parser 2.3.0 va multer 2.4.0 — DoS), 2 moderate + 2 low (qs, fast-uri) | Yuqori (bog‘liqliklar) | zod `^4.6.7`; body-parser 2.4.0, qs 6.17.1 (oraliq ichida); `pnpm-workspace.yaml` `overrides`: multer 2.5.0 (NestJS 12.1 uni aniq 2.4.0 ga qotirgan; fayl yuklash endpointi yo‘q — foydalanib bo‘lmasdi), fast-uri `^3.1.9` | `pnpm audit --prod` → 0; barcha testlar qayta o‘tdi |
| 5 | Dev bog‘liqliklar: undici (vitest/testcontainers), zod (eslint plagini), mysql2 (prisma CLI) | Past (production'ga tushmaydi) | `overrides` (minor/patch) | `pnpm audit` → 1 high (pastda) |

**Qolgan xavflar (qabul qilingan yoki keyingi phase):**
- `deepmerge-ts` 7.1.5 (prisma CLI, dev va `migrate` image) — high advisory, tuzatish faqat 8.x (major), Prisma 7.10.0 uni qotirgan. Faqat lokal konfiguratsiyani birlashtiradi (hujumchi kiritmasi yo‘q). Prisma yangilanganda yopiladi.
- Eski (SEC-01 gacha) audit qatorlarida xom noma’lum login DB darajasida qoladi (immutable) — API ko‘rsatmaydi.
- SEC-01 izi 6 raqamdan boshqa loginlar uchun kalit oshkor bo‘lsa lug‘at bilan tekshirilishi mumkin (login — sir emas; parol shaklidagilar uchun iz yo‘q).
- docker-compose hozir dev ko‘rinishida: API superuser bilan ulanadi (DATABASE §6), `read_only`/`cap_drop` yoqilmagan, web'da HSTS yo‘q (TLS yo‘q) — Phase 17 (prod compose, TLS terminator, DB rollari). Read-only ishlash imkoniyati tasdiqlangan. TLS terminator Nginx oldiga qo‘yilsa, `TRUST_PROXY` = 2 bo‘lishi kerak.
- 6 xonali parol (TZ) — §5 dagi qoldiq xavf o‘zgarmagan.
- Web CSP'da `style-src 'unsafe-inline'` (inline stil; skript emas).
- Backup va tiklash sinovi — Phase 17.

## 20. Phase 17 production konfiguratsiyasi va qolgan xavflar

> **Muhit haqida ochiq:** haqiqiy production serverga kirish imkoni bo‘lmagan. Quyidagi barcha dalillar — lokal mashinada (Intel i5-13420H noutbuk, Docker): production konfiguratsiyasi alohida `divine-drill` loyihasida (127.0.0.1:18443, self-signed TLS) ishga tushirilgan, yuklama testi — Testcontainers'da. Bu **production o‘lchovi emas**. Deploy'dan keyin serverda `security-check.sh`, `monitor.sh` va `drill.sh` qayta bajarilishi shart ([RUNBOOK §1, §6](RUNBOOK.md)).

### 20.1. Production stack (`docker-compose.prod.yml`)

Dev konfiguratsiyasi (`docker-compose.yml`) o‘zgartirilmadi va **production uchun emas** (API u yerda superuser bilan ulanadi, hardening yo‘q). Production — alohida fayl (`name: divine-prod`), o‘rnatish va yuritish — [RUNBOOK](RUNBOOK.md).

| Talab | Qanday bajarilgan | Dalil |
|---|---|---|
| API superuser bilan ishlamaydi | API `divine_api` (LOGIN, `divine_app` a’zosi) bilan ulanadi; migratsiya va seed — alohida bir martalik `migrate` konteyneri, `divine_owner` bilan; rollar `docker/postgres/init-roles.sh` (birinchi ishga tushishda, parollar fayldan, `log_statement = none`); `PUBLIC`dan `CONNECT` va `public` sxemada `CREATE` olingan | `security-check.sh`: "api DB ulanishi: divine_api (superuser emas)", "divine_api ∈ divine_app", "divine_* rollarida SUPERUSER/CREATEROLE/CREATEDB yo‘q"; manifest: `guard.app_can_update_ledger_or_audit = f`, `guard.db_owner = divine_owner` |
| `read_only`, `tmpfs`, `cap_drop` | barcha 5 servis (postgres, redis, migrate, api, web): read-only root FS, yoziladigan joylar faqat `tmpfs`/volume, `cap_drop: [ALL]`, `no-new-privileges`, root emas (postgres `70`, redis `999`, api/migrate `node` 1000, web `nginx` 101) | `security-check.sh` — har bir servis bo‘yicha |
| Healthcheck va restart | uzoq ishlaydigan servislar `restart: unless-stopped` + healthcheck (`pg_isready`, `redis-cli ping`, API `/health`, web `/healthz`); `migrate` — restart'siz; `api` migratsiya muvaffaqiyatli tugashini kutadi | `security-check.sh` ("healthy", restart siyosati); drill — `wait_healthy` aniq `(healthy)` holatini kutadi |
| Tarmoq | `backend` tarmog‘i `internal: true` — postgres, redis, api host'ga port ochmaydi va internetga chiqa olmaydi; faqat web 80/443 (`BIND_ADDRESS`) | `security-check.sh`: "host'ga port ochilmagan" — postgres, redis, api; "api: internetga chiqish yo‘q" (egress faqat api'dan sinaladi) |
| TLS, HSTS faqat HTTPS orqali | Nginx (web) TLS terminator: TLS 1.2/1.3, Mozilla intermediate shifrlari; 80 → 301 https; HSTS (`max-age=31536000; includeSubDomains`, `preload`siz) faqat 443 javoblarida (`security-headers-tls.conf`); `TRUST_PROXY=1` (Nginx yagona proxy) | `security-check.sh`: HSTS va CSP https'da bor, http javobida HSTS yo‘q, http → https 301, API oddiy HTTP orqali ochilmaydi, TLS 1.2/1.3 ishlaydi, TLS 1.0/1.1 rad etiladi (klient `SECLEVEL=0` bilan — server alert 70 qaytaradi, tekshiruv "bo‘sh" o‘tmaydi) |
| Secretlar `.env` va image'da emas | Docker secrets fayllari (`secrets/`, katalog 0700): ilova `*_FILE` o‘zgaruvchilarini o‘qiydi (`src/config/secret-files.ts`: ikkalasi berilsa, fayl o‘qilmasa yoki bo‘sh bo‘lsa — qiymatsiz xato bilan to‘xtaydi; `prisma.config.ts` ham); `.env.prod`da faqat domen, port, yo‘llar; `.dockerignore` — `.env*`, `secrets`, `backups`; Redis paroli va konfiguratsiyasi ham secret (xavfli buyruqlar `FLUSHALL`/`FLUSHDB`/`CONFIG` o‘chirilgan) | `security-check.sh`: har bir secret qiymati `docker inspect` (env, cmd) va barcha konteyner log'larida qidirildi — topilmadi, secrets katalogi 0700, Redis parolsiz rad etadi; `secret-files.spec.ts` (4); drill image'lari (2026-10-30): `Config.Env`da faqat `PATH`/`NODE_*`/`NGINX_*` kabi standart nomlar, fayl tizimida `.env`/kalit fayllari yo‘q (faqat Alpine'ning ommaviy CA to‘plami) |
| Log'larda secret yo‘q | ilova redaction'i (§14) o‘zgarmagan; postgres `log_min_error_statement = panic` (xato so‘rov matni — ichidagi ma’lumot bilan — log'ga tushmaydi); log rotatsiyasi `json-file` 10 MB × 5 | `security-check.sh` (log grep), `security-leaks.db-spec.ts` (Phase 16) |

**Qo‘shimcha (Phase 17 rejasidagi bandlar):**
- **Pepper rotation** — `PASSWORD_PEPPER_V2` (ixtiyoriy, pepper va JWT secret'dan farqli bo‘lishi shart): yangi hash'lar `v2$`, eski `v1$` hash muvaffaqiyatli login'da shartli `UPDATE` bilan avtomatik yangilanadi (parallel login'da ustidan yozilmaydi). Testlar: `password-hasher.spec.ts` (3), `env.schema.spec.ts`, `auth.db-spec.ts`. Yo‘riqnoma — RUNBOOK §5.
- **Sessiyalar jadvali cheksiz o‘smaydi** — `SessionCleanupJob` (har kuni 04:00 Toshkent, Redis `SET NX` qulfi — bir nechta API nusxasida bitta): muddati yoki bekor qilinganiga 30 kundan oshgan `user_sessions` qatorlari o‘chiriladi (audit jurnaliga tegmaydi). Test: `auth.db-spec.ts`.

### 20.2. Backup va tiklash

| Talab | Qanday | Dalil |
|---|---|---|
| Backup yaratiladi | `backup.sh` (`pg_dump -Fc`, kunlik), `backup-base.sh` (`pg_basebackup`, haftalik), `backup-wal.sh` (WAL arxivi, `archive_timeout = 300`) | drill |
| Shifrlash | har bir fayl GPG **ochiq kalit** bilan (`*.gpg`); maxfiy kalit serverda emas — server egallansa ham backup o‘qilmaydi; ochiq matnli nusxa faqat 0700 vaqtinchalik katalogda | drill: shifrlangan dump'da `PGDMP` sarlavhasi va drill mijoz ismlari — 0 ta |
| Yaxlitlik | `.sha256`; backup'dan oldin `pg_restore --list` (muhim jadvallar ma’lumoti bor); manifest — jadval sonlari, o‘zgarmas va moliyaviy jadvallarning md5'i, invariantlar (reconciliation view'lari, shu jumladan `reconcile_sales_totals`, manfiy qoldiq), himoya (immutability trigger'lari yoqilgan, `divine_app` yoza olmaydi, baza egasi, `TimeZone`, migratsiyalar soni) | `verify-db.sh --expect` — bayt-ma-bayt solishtiruv |
| Haqiqiy restore | `restore.sh`: nazorat yig‘indisi → shifr ochiladi → API to‘xtatiladi → `DROP DATABASE … WITH (FORCE)` → `pg_restore --create` → manifest solishtiruvi → o‘zgarmas jadvalda jonli `UPDATE` urinishi trigger tomonidan rad etilishi (`DV001`) → API; `restore-pitr.sh` — vaqt nuqtasiga | drill: **barcha volume'lar o‘chirilib**, toza postgres'ga tiklandi, manifest backup paytidagi bilan bir xil, ilova orqali login, sotuvlar soni va reconciliation (0) tekshirildi; PITR: T nuqtasigacha bo‘lgan ma’lumot bor, T dan keyingi yo‘q, manifest T paytidagi bilan bir xil |
| Takrorlanadigan | `drill.sh` — bitta buyruq, alohida loyiha, vaqtinchalik secretlar va GPG kalitlari; har qanday buzilish — exit 1; hisobot `backups/drill/` | `backups/drill/drill-20261030T151900Z.txt` — **MUVAFFAQIYATLI**, 204 s; audit paytida qayta: `drill-20261030T170416Z.txt` — **MUVAFFAQIYATLI**, 239 s, dalillar `drill-20261030T170416Z/` da (pastda). Ikkalasida `schema.migrations = 7` (`warehouse_sales_totals` bilan) |
| Xatoni aniqlash | ERR trap → `status/last-<tur>-failure.json` + webhook (xabarda faqat holat va yiqilgan buyruq nomi); muvaffaqiyatli backup xato holatini tozalaydi; `monitor.sh` backup yoshi, xatolar, `pg_stat_archiver`, sertifikat muddati, 5xx darajasi, reconciliation, disk — bitta yig‘ma alert | drill 5-qadam: postgres to‘xtatilganda backup exit 1, xato holati yozildi, monitor exit 1; keyingi backup tozaladi. Webhook: lokal tinglovchiga (127.0.0.1) bitta `application/json` xabar keldi, matnda secret yo‘q (2026-10-30) |

**Saqlangan dalillar** (`backups/drill/drill-20261030T170416Z/`, gitignore'da; faqat sonlar, md5 va sozlamalar — secret yo‘q): `manifest-backup.tsv` va `manifest-restored.tsv` — `cmp` bilan bir xil (sha256 `011e0025…`; 25 sotuv, 55 ledger harakati, 65 audit); `manifest-T.tsv` va `manifest-pitr.tsv` — bir xil (sha256 `95c9a7bb…`; 30 sotuv — T dan keyingi 3 ta yo‘q). Har ikkala holatda 6 ta invariant = 0, `guard.immutable_triggers = 8`, `guard.app_can_update_ledger_or_audit = f`, `guard.timezone = UTC`. `security-check.txt` — 51 PASS, 0 FAIL; `monitor.txt` — 14 OK. Birinchi drill (15:19Z) davrida manifest fayllari saqlanmagan edi (muvaffaqiyatda ish katalogi o‘chirilardi — faqat hisobotdagi "manifest … bir xil (44 qator)" yozuvi) — audit paytida `drill.sh` dalillarni saqlaydigan qilindi va restore'dan keyingi manifest alohida `cmp` bilan tekshiriladi.

### 20.3. Performance (REQ-167)

`sort=sold:desc` ko‘p yillik tarixli omborda (Phase 15 dagi "ma’lum chegara") — **alohida ssenariy** sifatida o‘lchandi va tuzatildi (§20.4 #1). To‘liq usul, muhit va jadval — [TESTING §5.2](TESTING.md#52-api-yuklama-testi--p95--300-ms-benchload).

| O‘lchov (p95, ms, normal / peak) | Phase 15 (quvvat holati qayd etilmagan) | Phase 17, tuzatishdan oldin | Phase 17, batareya + `balanced` | **Phase 17 yakuniy** (batareya + `performance`) |
|---|---|---|---|---|
| `GET /products` (kassa, tarixli ombor) | — (o‘lchanmagan) | 1 512 / 1 657, **434 xato** | 80 / 136 | **22 / 61** |
| `GET /products` (kassa katalogi) | 39 / 65 | 177 / 286 | 69 / 126 | 18 / 55 |
| `GET /sales` (admin, hammasi) | 160 / 179 | 536 / 569 | 250 / 280 | 129 / 199 |
| `GET /sales` (sotuvchi, o‘z tarixi) | 191 / 212 | 483 / 565 | 269 / 298 | 109 / 204 |
| `GET /dashboard/summary` | 172 / 196 | 575 / 561 | 279 / **325** | 111 / **212** |
| `POST /sales` | 89 / 128 | 304 / 466 | 167 / 251 | 54 / 133 |
| Xatolar / natija | 0 / PASS | 435 / FAIL | 0 / **FAIL** | **0 / PASS** |

Yakuniy o‘lchov (`load-2026-10-30T16-41-08-305Z.json`) — barcha 19 endpoint p95 < 300 ms, eng sekini 212 ms, 0 xato. **Cheklov:** noutbuk o‘lchov paytida zaryadga ulanmagan edi; CPU energiya profili vaqtincha `performance`ga o‘tkazildi (o‘lchovdan keyin `balanced`ga qaytarildi). Shu mashinada, **xuddi shu kod** bilan, batareya + `balanced` rejimida (`balance_power` — o‘lchov tugagan zahoti tekshirilgan: AC0 = 0, batareya `Discharging`) dashboard peak'da 325 ms bilan FAIL bo‘lgan — natija faylda izoh bilan saqlangan, o‘chirilmagan. U yakuniy o‘lchovdan endpoint'lar bo‘yicha p95'da 1,4–3,2× (peak, median 2,3×) va 2,0–11,7× (normal, median 3,7×) sekin. Bu dashboard/summary va sotuvlar ro‘yxatining zaxirasi kichikligini ko‘rsatadi (§20.5).

**Phase 15 bilan solishtirish cheklovi:** Phase 15 o‘lchovi paytida quvvat holati (AC/batareya, CPU profili) qayd etilmagan — muhit tengligi isbotlanmagan. Yakuniy peak p95 Phase 15 ga nisbatan: 13 endpoint tezroq, 5 tasi sekinroq — `GET /customers` (admin) +45% (36 so‘rov, kichik tanlanma), `GET /sales` (hammasi) +11,2%, `GET /dashboard/summary` +8,2%, `POST /sales` +3,5%, `GET /warehouses/:id/stock` +2,3%; normal bosqichda barcha 18 taqqoslanadigan endpoint −20…−86%.

### 20.4. Phase 17 da topilgan va tuzatilgan

| # | Muammo | Tuzatish | Dalil |
|---|---|---|---|
| 1 | Kassa katalogi `sort=sold:desc` tarixli omborda (1 mln sotuvli seed) har so‘rovda ombordagi barcha `SALE` harakatlarini yig‘ardi: p95 ~1,5–1,7 s, DB pool to‘yinib 434 ta 503 | yangi migratsiya `20261030100000_warehouse_sales_totals`: (ombor, mahsulot) bo‘yicha sotilgan miqdor yig‘ma jadvali, `inventory_movements`ga `SALE` yozilganda `SECURITY DEFINER` trigger bilan **shu tranzaksiyada** yangilanadi (stock bilan bir xil qulf tartibi — yangi deadlock yo‘q); ledger'dan backfill; `divine_app` — faqat `SELECT`; nomuvofiqlik view'i `reconcile_sales_totals` (monitor va `verify-db.sh` tekshiradi). Javob shakli o‘zgarmadi; ledger va audit o‘zgarmas qoldi | `inventory.db-spec.ts` (2), `migrations.db-spec.ts` (derived jadval — faqat SELECT), yuklama: 22 / 61 ms, 0 xato |
| 2 | Backup skripti funksiya ichida yiqilsa ERR trap ishlamasdi — exit 1, lekin alert va xato holati yo‘q | `set -E` (`lib.sh`) | drill 5-qadam, webhook sinovi |
| 3 | Bazaviy backup'da `tar … \| grep -q` `pipefail` ostida SIGPIPE bilan soxta xato | mundarija avval faylga yoziladi | drill 3-qadam |
| 4 | `verify-db.sh` immutability sinovi identity ustunida (`id = id`) — "bo‘sh" o‘tishi mumkin edi | oddiy ustun + `ctid`, `DV001` kutiladi | drill |
| 5 | TLS 1.0/1.1 rad etish tekshiruvi klient OpenSSL'ning o‘zi rad etgani uchun "bo‘sh" o‘tardi | klient `SECLEVEL=0`, server alert'i tekshiriladi | `security-check.sh` |
| 6 | `migrate` konteyneri internal tarmoqda corepack orqali pnpm yuklamoqchi bo‘lib yiqilardi | Prisma CLI to‘g‘ridan-to‘g‘ri, `USER node` | drill 1-qadam |
| 7 | Drill: `unhealthy` ham "healthy" deb sanalardi; subshell'da takroriy alert; `security-check` bo‘sh pool'da rol topmasdi | `(healthy)` aniq sanaladi; `BASH_SUBSHELL` himoyasi; oldin health so‘rovi | drill |
| 8 | `products.db-spec.ts` audit tartibi `ORDER BY`siz — vaqti-vaqti bilan yiqilardi (Phase 17 dan oldingi test) | `orderBy: { id: 'asc' }` (test talabi o‘zgarmadi) | `test:db` 384/384 |

### 20.5. Qolgan xavflar va tugallanmagan ishlar

- **Production serverda hech narsa o‘lchanmagan.** Server, domen, haqiqiy sertifikat va tarmoq yo‘q — p95, TLS va backup faqat lokal. Yuklama generatori server va DB bilan bir mashinada (natija pessimistik), lekin server apparati noma’lum.
- **Yakuniy yuklama o‘lchovi zaryadsiz** (batareya + `performance` profili); Phase 15 o‘lchovining quvvat holati qayd etilmagan — sharoit tengligi isbotlanmagan. CPU cheklanganda `GET /dashboard/summary` peak'da 325 ms (FAIL), `GET /sales` (o‘z tarixi) 298 ms. Zaif serverda shu endpoint'lar chegaradan oshishi mumkin. Sabab — dashboard'ning "barcha vaqt" ko‘rsatkichlari har so‘rovda barcha sotuvlarni filtrsiz yig‘adi (`dashboard.repository.ts`, `totals(tx)`); tuzatish (kunlik yig‘ma jadval) REQ-031 ("keshsiz", real vaqt) va sotuv tranzaksiyasiga ta’sir qiladi — **arxitektura qarori**, Phase 17 da qilinmadi.
- **Offsite nusxa** — RUNBOOK'da `rsync` cron namunasi, lekin sinalmagan; moliyaviy ma’lumotlarni saqlash muddati — biznes egasining qarori (RUNBOOK §3).
- **Backup maxfiy GPG kaliti yo‘qolsa** barcha backup'lar o‘qilmaydi — saqlash (seyf/parol menejeri, ikki nusxa) tashkiliy masala.
- **RPO:** WAL arxivi staging'i data volume ichida; disk butunlay yo‘qolsa oxirgi ~15 daqiqa (`archive_timeout` 5 + cron 10) yo‘qolishi mumkin.
- **TLS:** faqat self-signed sertifikat bilan sinaldi. Let's Encrypt yangilanishi stack ichida avtomatlashtirilmagan (host'dagi certbot + `nginx -s reload`); `monitor.sh` muddat < 14 kun qolganda ogohlantiradi.
- **Alert:** webhook faqat lokal tinglovchiga sinaldi; haqiqiy Slack/Telegram kanaliga emas.
- **Gorizontal kengaytirish** (`--scale api=2`, REQ-169) — dizayn tayyor (holat Redis'da, job qulflari), lekin Phase 17 da **sinalmagan**.
- Phase 16 dan: `deepmerge-ts` (dev va `migrate` image) high advisory; eski audit qatorlarida xom noma’lum login DB darajasida; CSP `style-src 'unsafe-inline'`; 6 xonali parol (TZ). Load balancer/CDN qo‘shilsa — `TRUST_PROXY` va `set_real_ip_from` (RUNBOOK §1).
- **Dependabot amalda o‘chirilgan:** `.github/dependabot.yml` — `updates: []` (repo egasining 2026-10-30 dagi commit'i `04b70f7`; Phase 17 o‘zgarishi emas — prettier faqat bo‘sh birinchi qatorni olib tashlagan). §16–§17 dagi "Dependabot" himoyasi hozir ishlamaydi: bog‘liqlik va image yangilanishlari — qo‘lda (`pnpm audit`). Base image'lar teg bilan (`postgres:18-alpine`, `redis:8-alpine`, `node`/`nginx` alpine), digest bilan qotirilmagan — har build yangi patch olishi mumkin, lekin takrorlanuvchanlik kafolatlanmaydi.
- **D-13, D-14, D-15** — tasdiqlanmagan, Phase 17 ga ta’sir qilmaydi.
