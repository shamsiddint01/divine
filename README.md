# Divine.uz

Chakana savdo va bozor bizneslari uchun **web ERP**: mahsulotlar, omborlar, kirim, sotuv, mijozlar, xarajatlar, hisobotlar va audit. Interfeys to‘liq o‘zbek tilida (lotin).

> **Holat:** Phase 1–17 tugallandi ([docs/DEVELOPMENT-PLAN.md](docs/DEVELOPMENT-PLAN.md)). Production konfiguratsiyasi tayyor va lokal sinovdan o‘tgan; haqiqiy serverda deploy va tekshiruv — [docs/RUNBOOK.md](docs/RUNBOOK.md). Biznes egasining ochiq qarorlari: D-13, D-14, D-15.

---

## Hujjatlar

| Hujjat | Mazmuni |
|---|---|
| [ARCHITECTURE](docs/ARCHITECTURE.md) | Tizim tuzilmasi, qatlamlar, oqimlar, qarorlar |
| [DATABASE](docs/DATABASE.md) | Sxema, constraint'lar, indexlar, inventar ledger'i |
| [RBAC](docs/RBAC.md) | Rollar, permissionlar, ownership qoidalari |
| [API](docs/API.md) | REST contract (`/api/v1`) |
| [BUSINESS-RULES](docs/BUSINESS-RULES.md) | Biznes qoidalari (BR), formulalar, qarorlar, taxminlar |
| [SECURITY](docs/SECURITY.md) | Xavfsizlik arxitekturasi, 6 xonali parol xavfi |
| [DEVELOPMENT-PLAN](docs/DEVELOPMENT-PLAN.md) | 17 ta phase va Definition of Done |
| [REQUIREMENTS-MATRIX](docs/REQUIREMENTS-MATRIX.md) | TZ talabi → implementatsiya → test → status |
| [TESTING](docs/TESTING.md) | Test to‘plamlari, TZ §19 → testlar, coverage, benchmark natijalari |
| [RUNBOOK](docs/RUNBOOK.md) | Production: o‘rnatish, backup/tiklash, monitoring, rotation, insident |

## Texnologiyalar

| Qatlam | Stack |
|---|---|
| Monorepo | pnpm 11 workspaces, Turborepo 2 |
| Backend | NestJS 12 (ESM), TypeScript 6, Prisma 7 (`@prisma/adapter-pg`), Zod 4, pino, ioredis, helmet, Swagger |
| Frontend | React 19, Vite 8, React Router 8, Tailwind CSS 4, shadcn/ui, TanStack Query 5, Zustand 5, React Hook Form + Zod |
| Shared | `@divine/shared`: Zod sxemalari, enumlar, permission va error kodlari, o‘zbekcha xabarlar |
| Ma’lumotlar | PostgreSQL 18, Redis 8 |
| Test | Vitest (API, Web, Shared), Supertest, Testing Library |
| Infra | Docker (multi-stage, non-root), Nginx, GitHub Actions, Dependabot |

## Loyiha tuzilmasi

```
divine.uz/
├── backend/                 # NestJS REST API (@divine/backend)
│   ├── prisma/              # schema.prisma (Phase 2: modellar va migratsiyalar)
│   ├── src/                 # bootstrap, config, infrastructure, modules
│   └── test/                # unit, e2e (Phase 3+: integration)
├── frontend/                # React SPA (@divine/frontend)
│   └── src/                 # app, features, shared, mocks, i18n, stores, styles
├── shared/                  # @divine/shared — umumiy Zod sxemalari, enumlar, kodlar
├── docs/                    # arxitektura hujjatlari
├── docker/                  # api.Dockerfile, web.Dockerfile, nginx/
├── .github/                 # CI, Dependabot
├── docker-compose.yml
├── turbo.json · pnpm-workspace.yaml · tsconfig.base.json · eslint.config.js
└── .env.example
```

## Talablar

- **Node.js 24** (`.node-version`)
- **pnpm 11** (`corepack enable` — versiya `package.json` dagi `packageManager` dan olinadi)
- **Docker** + Docker Compose v2 (PostgreSQL va Redis uchun)

## O‘rnatish

```bash
corepack enable
pnpm install
cp .env.example .env          # qiymatlarni ko‘rib chiqing
pnpm infra:up                 # PostgreSQL (127.0.0.1:5434) va Redis (127.0.0.1:6381)
```

> Host portlari mahalliy PostgreSQL (5432) va Redis (6379) bilan to‘qnashmasligi uchun 5434 va 6381. Ularni `.env`da `POSTGRES_HOST_PORT`/`REDIS_HOST_PORT` (va mos ravishda `DATABASE_URL`/`REDIS_URL`) orqali o‘zgartirish mumkin.

## Environment o‘zgaruvchilari

Barcha qiymatlar root `.env` faylida. API ularni ishga tushishda Zod bilan tekshiradi; xato bo‘lsa, ilova ishga tushmaydi va noto‘g‘ri **kalit nomlarini** ko‘rsatadi (qiymatlarni emas).

| O‘zgaruvchi | Standart | Tavsif |
|---|---|---|
| `APP_VERSION` | `0.1.0` | `/health` va Swagger'da ko‘rinadi |
| `API_HOST` / `API_PORT` | `0.0.0.0` / `3000` | API manzili |
| `CORS_ORIGINS` | `http://localhost:5173` | Vergul bilan ajratilgan aniq originlar (`*` taqiqlangan). **Frontend origin'i shu ro‘yxatda bo‘lishi shart** — `/auth/refresh` va `/auth/logout` CSRF tekshiruvi `Origin` ni shu ro‘yxat bilan solishtiradi |
| `TRUST_PROXY` | `0` | Reverse proxy hop'lari (Nginx ortida `1`) |
| `LOG_LEVEL` | `info` | `fatal`…`trace`, `silent` |
| `SWAGGER_ENABLED` | prod'da `false`, boshqa muhitlarda `true` | `/api/docs` |
| `DATABASE_URL` | — | `postgresql://…` (**majburiy**) |
| `REDIS_URL` | — | `redis://…` (**majburiy**) |
| `JWT_ACCESS_SECRET` | — | ≥ 32 belgi (**majburiy**); prod'da `change-me…` rad etiladi |
| `JWT_ACCESS_TTL_SECONDS` | `900` | Access token muddati |
| `REFRESH_TOKEN_TTL_DAYS` | `7` | Refresh token muddati |
| `PASSWORD_PEPPER` | — | ≥ 32 belgi (**majburiy**), JWT secret'dan farqli |
| `AUTH_MAX_FAILED_ATTEMPTS` | `5` | Lock'gacha xato urinishlar |
| `AUTH_LOCKOUT_MINUTES` | `15` | Birinchi lock muddati (progressive) |
| `AUTH_COOKIE_SECURE` | `true` | Refresh cookie `Secure` belgisi. Prod'da `false` rad etiladi. Faqat HTTPS'siz lokal sinovda `false` |
| `POSTGRES_USER` / `POSTGRES_PASSWORD` / `POSTGRES_DB` | `divine` / — / `divine` | Docker PostgreSQL |
| `POSTGRES_HOST_PORT` / `REDIS_HOST_PORT` | `5434` / `6381` | Host portlari |
| `SEED_ADMIN_LOGIN` | `admin` | `db:bootstrap-admin` uchun standart login (`--login` berilmasa) |
| `VITE_API_BASE_URL` | `/api/v1` | Brauzer uchun API manzili (secret emas) |
| `VITE_API_MODE` | `mock` | `mock` — brauzer ichidagi namunaviy API (backend kerak emas); `http` — haqiqiy backend |
| `VITE_AUTH_MODE` | `mock` | Backend'da tayyor modullar (`BACKEND_READY_PREFIXES`: `/auth/*`, `/users*`, `/products*`, `/product-groups*`, `/warehouses*`, `/inventory*`, `/incoming*`, `/customers*`, `/sales*`, `/expenses*`, `/expense-categories*`) uchun: `http` — haqiqiy backend, qolgan biznes sahifalari `VITE_API_MODE` bo‘yicha (mock). `VITE_API_MODE=http` bo‘lsa avtomatik `http` |
| `VITE_DEV_API_PROXY_TARGET` | `http://localhost:3000` | Vite dev proxy |
| `WEB_DEV_PORT` | `5173` | Frontend dev server porti |
| `WEB_HOST_PORT` | `8080` | Docker full stack web porti |

Secret yaratish: `openssl rand -base64 48`.

> `VITE_*` qiymatlari brauzer bundle'iga tushadi — ularga **hech qachon** secret yozilmaydi. Refresh token faqat HttpOnly cookie'da, access token faqat xotirada (`localStorage` ishlatilmaydi).

> `NODE_ENV` `.env`da **berilmaydi**: Vite ham shu faylni o‘qiydi va `NODE_ENV=development` bo‘lsa, production build'ga React'ning dev versiyasi tushadi. API standart holatda `development`, testlar `test`, Docker esa `production` ni o‘zi o‘rnatadi.

## Ishlab chiqish

### Faqat frontend (hozirgi bosqich — mock ma'lumotlar bilan)

```bash
cd frontend
pnpm dev            # http://localhost:<WEB_DEV_PORT> (standart 5173)
```

Backend, PostgreSQL yoki Redis **kerak emas**: `VITE_API_MODE=mock` rejimida frontend so‘rovlari brauzer ichidagi mock API'ga (`frontend/src/mocks`) boradi. Mock API `docs/API.md` contract'ini takrorlaydi: javob shakllari, validatsiya (shared Zod sxemalari), xato kodlari (masalan, `409 INSUFFICIENT_STOCK`) va qoldiq/ledger mantig‘i. Backend tayyor bo‘lganda faqat `VITE_API_MODE=http` qilinadi — feature kodi o‘zgarmaydi.

- Demo ma'lumotlar (75 kunlik savdo, 3 ombor, 45 mahsulot, 7 user) birinchi ochilishda yaratiladi va **brauzer xotirasida** saqlanadi.
- O‘zgartirilmagan demo har kuni bugungi sanaga qayta yaratiladi; o‘zingiz kiritgan sotuv, kirim va boshqa ma'lumotlar saqlanib qoladi.
- Boshlang‘ich holatga qaytarish: **Sozlamalar → Demo ma'lumotlarni tiklash**.
- Demo login: istalgan demo user (`admin`, `aziz` — sotuvchi, …), parol `123456`. Bir brauzerning tablari demo ma'lumotni o‘zaro sinxronlaydi.

### Haqiqiy backend modullari + mock biznes ma'lumotlari

```bash
# backend ishlab turgan bo'lsa (CORS_ORIGINS'da frontend origin'i bo'lsin)
cd frontend
VITE_AUTH_MODE=http pnpm dev
```

Login, sessiya, ruxsatlar, Userlar, Mahsulotlar, Guruhlar, Ombor, Kirim, Mijozlar, Kassa va sotuvlar tarixi, Xarajatlar haqiqiy backend'dan. Hali mock'da: Bosh sahifa (dashboard), Hisobotlar va Sozlamalar (Phase 12) — ular backend'ga o‘z phase'ida ulanadi, shu sababli bu sahifalardagi raqamlar haqiqiy ma'lumotga mos kelmaydi.

### To‘liq stack

```bash
pnpm dev            # shared (watch) + backend (http://localhost:3000) + frontend
```

| Manzil | Tavsif |
|---|---|
| http://localhost:5173 | Frontend (Vite; `/api` → backend'ga proxy) |
| http://localhost:3000/api/v1/health | Backend holati |
| http://localhost:3000/api/docs | Swagger UI (dev) |

### Buyruqlar (root)

| Buyruq | Vazifasi |
|---|---|
| `pnpm dev` | Barcha ilovalarni watch rejimida ishga tushirish |
| `pnpm dev:frontend` / `pnpm dev:backend` | Faqat frontend yoki faqat backend |
| `pnpm build` | Production build (shared → backend, frontend) |
| `pnpm lint` | ESLint |
| `pnpm typecheck` | TypeScript tekshiruvi |
| `pnpm test` | Unit testlar (Docker kerak emas) |
| `pnpm test:db` | DB testlari — real PostgreSQL 18 (Testcontainers, Docker kerak) |
| `pnpm coverage` | Coverage hisoboti va chegaralari (domain ≥ 90%, service ≥ 80%; Docker kerak) |
| `pnpm e2e` | Playwright E2E — haqiqiy backend va toza DB bilan (Docker va Google Chrome kerak) |
| `pnpm db:deploy` / `pnpm db:seed` | Migratsiyalarni qo‘llash / ma’lumotnoma seed'i |
| `pnpm ci` | CI ketma-ketligi: lint → typecheck → test → test:db → build |
| `pnpm format` / `pnpm format:check` | Prettier |
| `pnpm infra:up` / `pnpm infra:down` | PostgreSQL va Redis konteynerlari |

Bitta paket uchun: `pnpm --filter @divine/backend test`, `pnpm --filter @divine/frontend dev` va h.k.

## Database

PostgreSQL 18 + Prisma 7: 20 ta jadval, 5 ta migratsiya, DB darajasidagi yaxlitlik (CHECK, trigger, huquqlar). To‘liq dizayn: [docs/DATABASE.md](docs/DATABASE.md).

### Birinchi marta (dev)

```bash
pnpm infra:up       # PostgreSQL (localhost:5434) va Redis (localhost:6381)
pnpm db:deploy      # migratsiyalarni qo'llash
pnpm db:seed        # rollar, 31 ta permission, rol → permission xaritasi, standart sozlamalar
pnpm --filter @divine/backend db:bootstrap-admin -- --login admin --full-name "Ism Familiya"
```

`db:deploy` va `db:seed` idempotent — qayta ishga tushirish xavfsiz. Seed'da parol yo‘q.

### Birinchi administrator (bootstrap)

Birinchi ADMIN **faqat server terminalidagi CLI** bilan yaratiladi — buning uchun HTTP endpoint yo‘q.

```bash
pnpm --filter @divine/backend db:bootstrap-admin -- --login admin [--full-name "Akmal Rahimov"]
# prod (Docker image ichida): node dist/database/bootstrap-admin.cli.js --login admin
```

- Parolni server yaratadi (6 raqam, CSPRNG) va **faqat bir marta** terminalga chiqaradi. U hech qayerda saqlanmaydi va log'ga yozilmaydi — darhol xavfsiz joyga yozib oling.
- Tizimda ADMIN allaqachon bo‘lsa, hech narsa yaratilmaydi. Bir vaqtda ikki marta ishga tushirilsa ham faqat bittasi yaratadi (`pg_advisory_xact_lock`).
- Kerak: `DATABASE_URL`, `PASSWORD_PEPPER` (API bilan **bir xil** pepper, aks holda login o‘tmaydi), migratsiya + seed qilingan DB.
- Chiqish kodlari: `0` — yaratildi · `1` — konfiguratsiya xatosi · `2` — noto‘g‘ri login/ism · `3` — admin allaqachon bor · `4` — login band · `5` — DB seed qilinmagan (`db:seed`).
- Keyingi userlarni admin ilovaning o‘zida yaratadi (**Userlar** sahifasi). Admin parolini unutsa — boshqa admin tiklaydi (**Parolni yangilash**). Yagona admin parolini unutsa — DB administratori aralashadi (yangi bootstrap ADMIN mavjud bo‘lgani uchun ishlamaydi).

### Buyruqlar (`pnpm --filter @divine/backend …`)

| Buyruq | Vazifasi |
|---|---|
| `db:generate` | Prisma client generatsiyasi (build, typecheck va test oldidan avtomatik) |
| `db:deploy` | Migratsiyalarni qo‘llash (`prisma migrate deploy`) — dev va prod |
| `db:seed` | Ma’lumotnoma seed'i (idempotent, prod'da ham xavfsiz) |
| `db:status` | Qo‘llanmagan migratsiyalar bormi |
| `db:migrate` | **Faqat dev:** schema o‘zgargach yangi migratsiya (`-- --create-only`, keyin qo‘lda SQL — [DATABASE §8](docs/DATABASE.md#8-migratsiya-strategiyasi)) |
| `db:reset` | **Faqat dev:** DB'ni tozalab, migratsiya + seed |
| `db:studio` | Prisma Studio |
| `db:bootstrap-admin` | Birinchi ADMIN (parol bir marta terminalda) — yuqoriga qarang |
| `test:db` | Toza PG 18 konteynerida migratsiya + DB testlari |

### Migratsiya va seed qoidalari

- Migratsiyalar faqat oldinga yuradi; qo‘llanilgan migratsiya tahrirlanmaydi.
- Migratsiya va seed — ilovadan **alohida** qadam: Docker'da `migrate` servisi (`--target migrate`) ularni bajaradi, `api` esa tugashini kutadi.
- Prod'da ikki DB foydalanuvchi: `MIGRATION_DATABASE_URL` — sxema egasi (DDL), `DATABASE_URL` — `divine_app` roliga a’zo login (ledger, audit va sotuvlarda UPDATE/DELETE huquqi yo‘q). [DATABASE §6](docs/DATABASE.md#6-db-rollari-va-huquqlar).
- Barcha vaqtlar UTC'da saqlanadi; "bugun" va kunlik hisobotlar Asia/Tashkent kuni bo‘yicha hisoblanadi.

## Testlar

```bash
pnpm test                               # unit testlar (Docker kerak emas)
pnpm test:db                            # DB/integration (real PG + Redis): migratsiya, constraint, trigger, huquq, seed, parallel sotuv, xato mapping, tranzaksiyalar, rate limit, auth (login, lockout, refresh, RBAC), bootstrap CLI
pnpm --filter @divine/shared test       # shared: validatsiya, permissionlar, xato kodlari
pnpm --filter @divine/backend test          # API: config, logger, health, foundation (xato, validatsiya, pagination, rate limit, request ID) — unit + e2e
pnpm --filter @divine/frontend test          # Web: i18n, navigatsiya, formatlash, api-client (401 → refresh), login, RBAC (UX), layout, mock API
pnpm --filter @divine/frontend qa:interactions   # real brauzer ssenariylari (dev server :5180 ishlab turishi kerak)
pnpm coverage                           # coverage + chegaralar (shared → frontend → backend, ketma-ket)
pnpm e2e                                # Playwright: asosiy oqimlar (o'z konteynerlari va portlari bilan; dev serverlarga tegmaydi)
pnpm --filter @divine/backend bench:reports   # hisobotlar, 1 mln sotuv (< 2 s)
pnpm --filter @divine/backend bench:load      # API yuklama testi, 1 mln sotuv (p95 < 300 ms)
pnpm --filter @divine/backend bench:compare reports   # oxirgi ikki natijani solishtirish
```

To‘liq xarita (TZ §19 → testlar, 17 ta kritik ssenariy, coverage, benchmark usuli va natijalari) — [docs/TESTING.md](docs/TESTING.md).

`test:db` real PostgreSQL 18 konteynerini (Testcontainers, `postgres:18-alpine`) o‘zi ko‘taradi va tugagach o‘chiradi — faqat Docker kerak, `pnpm infra:up` shart emas.

## Production build va deploy

**Production — faqat `docker-compose.prod.yml`** (Phase 17). To‘liq yo‘riqnoma: [docs/RUNBOOK.md](docs/RUNBOOK.md) — o‘rnatish, cron, monitoring, backup va kalitlar, tiklash, secret rotation, drill, yangilash/rollback/insident.

```bash
scripts/prod/init-secrets.sh                      # secrets/ (0700): parollar, kalitlar, ulanish URL'lari
cp .env.prod.example .env.prod                    # domen, portlar, yo'llar — secret EMAS
# + secrets/tls_cert, secrets/tls_key, secrets/backup_public_key.asc (RUNBOOK §1, §3.1)
docker compose -f docker-compose.prod.yml --env-file .env.prod up -d --build
docker compose -f docker-compose.prod.yml --env-file .env.prod run --rm --no-deps api \
  node dist/database/bootstrap-admin.cli.js --login admin
scripts/prod/security-check.sh                    # hammasi PASS bo'lishi shart
scripts/prod/drill.sh                             # backup → tiklash → PITR sinovi (alohida loyihada)
```

- API ma’lumotlar bazasiga `divine_api` (superuser emas) bilan ulanadi, migratsiya va seed — alohida `migrate` konteynerida `divine_owner` bilan; `api` uning muvaffaqiyatli tugashini kutadi.
- Barcha konteynerlar: read-only, `cap_drop: ALL`, `no-new-privileges`, root emas, healthcheck, restart; postgres/redis/api tashqariga ochilmaydi.
- Nginx (web) — TLS 1.2/1.3, http → https, HSTS faqat HTTPS'da, `/api` → `api:3000`, SPA fallback.
- Secretlar — Docker secrets fayllari (`*_FILE`), `.env`/image'da yo‘q. Backup'lar GPG ochiq kalit bilan shifrlanadi (maxfiy kalit serverda saqlanmaydi).
- `docker-compose.yml` (`--profile app`) — **faqat lokal sinov uchun**: API superuser bilan ulanadi, TLS va hardening yo‘q.

> **Eslatma:** `pnpm deploy` ni lokal workspace'da ishga tushirmang. U faqat Docker build ichida ishlatiladi va lokal `node_modules` holatini production rejimiga o‘tkazib qo‘yishi mumkin. Agar shunday bo‘lsa: `CI=true pnpm install`.

## API

- Base URL: `/api/v1`, JSON, pul va miqdor **string** sifatida.
- Autentifikatsiya: `Authorization: Bearer <accessToken>` + httpOnly refresh cookie `dv_refresh` (rotation). Refresh/logout uchun `X-Requested-With: XMLHttpRequest` va ruxsat etilgan `Origin`.
- Xato strukturasi: `{ "error": { "code", "message" (o‘zbekcha), "details"?, "requestId" } }`.
- To‘liq contract: [docs/API.md](docs/API.md). Ishlab turgan endpointlar: `GET /api/v1/health`, `POST /api/v1/auth/login`, `POST /api/v1/auth/refresh`, `POST /api/v1/auth/logout`, `GET /api/v1/auth/me`, Users (§4): `GET/POST /api/v1/users`, `GET /api/v1/users/warehouse-options`, `GET/PATCH /api/v1/users/:id`, `PATCH /api/v1/users/:id/status`, `POST /api/v1/users/:id/reset-password`, `PUT /api/v1/users/:id/warehouses`; mahsulotlar (§5–6): `/api/v1/product-groups` (GET, POST, `/:id` GET/PATCH/DELETE), `/api/v1/products` (GET, POST, `/lookup`, `/:id` GET/PATCH, `/:id/status`, `/:id/summary`); omborlar va inventar (§7–8): `/api/v1/warehouses` (GET, POST, `/:id` GET/PATCH, `/:id/status`, `/:id/stock`, `/:id/movements`), `/api/v1/inventory/movements`, `/api/v1/inventory/reconciliation`; kirim (§9): `/api/v1/incoming` (GET, POST, `/:id` GET/PATCH, `/:id/confirm`, `/:id/cancel`); mijozlar (§10): `/api/v1/customers` (GET, POST, `/:id` GET/PATCH, `/:id/purchases`); sotuvlar (§11): `/api/v1/sales` (GET, POST + `Idempotency-Key`, `/:id`); xarajatlar (§12): `/api/v1/expenses` (GET, POST, `/:id` GET/PATCH/DELETE), `/api/v1/expense-categories` (GET, POST, `/:id` PATCH/DELETE); hisobotlar (§13): `/api/v1/reports/{sales,products,warehouse-stock,incoming,expenses,user-sales,product-sales,customer-purchases,finance-summary}`; dashboard (§14): `/api/v1/dashboard/{summary,sales-trend,top-products,my-summary}`; sozlamalar (§16): `GET/PATCH /api/v1/settings`; audit (§15): `GET /api/v1/audit-logs`, `GET /api/v1/audit-logs/:id`.

## Phase 17 natijasi (Production preparation)

- **Production konfiguratsiyasi tayyor:** alohida `docker-compose.prod.yml` (superuser'siz API, read-only konteynerlar, internal tarmoq, TLS + HSTS, Docker secrets) va [docs/RUNBOOK.md](docs/RUNBOOK.md). Avtomatik tekshiruv `scripts/prod/security-check.sh` — 51/51 PASS
- **Backup va tiklash sinalgan:** kunlik/haftalik backup va WAL arxivi, shifrlangan; `scripts/prod/drill.sh` barcha ma’lumotni o‘chirib, backup'dan tiklaydi va vaqt nuqtasiga (PITR) qaytaradi — ma’lumot bayt-ma-bayt bir xil
- **Monitoring va alert:** `scripts/prod/monitor.sh` (health, sertifikat, backup, xato darajasi, reconciliation, disk) → webhook
- **Tezlik:** ko‘p yillik tarixli omborda kassa katalogi sekin edi (~1,6 s, xatolar bilan) → sotilgan miqdor yig‘ma jadvali (yangi migratsiya `20261030100000_warehouse_sales_totals`) → 0,06 s. Yuklama testi — barcha endpoint p95 < 300 ms ([docs/TESTING.md §5.2](docs/TESTING.md))
- Pepper rotation (`PASSWORD_PEPPER_V2`) va eski sessiyalarni avtomatik tozalash
- **Muhim:** hammasi lokal mashinada sinalgan — haqiqiy production serverda o‘lchanmagan. Qolgan xavflar — [docs/SECURITY.md §20](docs/SECURITY.md)

## Phase 16 natijasi (Security review)

- **SEC-01 yopildi:** login maydoniga tasodifan yozilgan parol endi audit jurnaliga va Redis'ga ochiq yozilmaydi (6 raqamli qiymat — yashiriladi, boshqa noma’lum login — kalitli barmoq izi). Eski audit yozuvlari o‘zgartirilmadi, lekin jurnal ularni ham yashirib ko‘rsatadi
- **Production web image endi haqiqiy backend bilan ishlaydi:** avval Docker image `VITE_API_MODE`siz yig‘ilib, brauzer ichidagi demo (mock) API bilan ochilardi. Endi standart — `http`, rejim berilmasa build to‘xtaydi (demo image kerak bo‘lsa: `--build-arg VITE_API_MODE=mock`)
- API javoblari brauzer keshiga yozilmaydi (`Cache-Control: no-store`) — umumiy kassa kompyuterida ham shaxsiy ma’lumot va kelgan narxi keshda qolmaydi
- Bog‘liqliklar yangilandi: `pnpm audit --prod` — zaiflik yo‘q (`pnpm-workspace.yaml` `overrides` izohlari bilan)
- Yangi avtomatik xavfsizlik testlari: log/audit/Redis'da maxfiy qiymat qidirish, har bir endpoint uchun RBAC va kirish fuzz'i, production header'lari, brauzerda ruxsatsiz urinishlar — [docs/TESTING.md §7](docs/TESTING.md), [docs/SECURITY.md §17–§19](docs/SECURITY.md)
- Qolgan xavflar — [docs/SECURITY.md §19](docs/SECURITY.md) (Phase 17 da yopilganlari — §20)
- Yangi migratsiya yo‘q

## Phase 15 natijasi (Testing)

- **Test xaritasi:** TZ §19 dagi 13 ta acceptance test va 17 ta kritik ssenariy aniq avtomatik testlarga bog‘landi — [docs/TESTING.md](docs/TESTING.md)
- **RBAC matritsasi:** har bir endpoint (74 ta) anonim, sotuvchi va admin uchun avtomatik tekshiriladi — ro‘yxat koddan olinadi, yangi endpoint qo‘shilsa ham tekshiruvdan chetda qolmaydi
- **Playwright E2E:** login → mahsulot → sotuvchi → kirim → sotuv → hisobot → audit, haqiqiy backend va toza baza bilan (`pnpm e2e`)
- **Coverage:** `pnpm coverage` — domain ≥ 90%, service ≥ 80% (pastroq bo‘lsa buyruq yiqiladi); hozir domain 96–100%, service 90–100%
- **Tuzatildi:** shtrix-kodlar tez ketma-ket skanerlansa kirimda miqdor ustidan yozilardi, kassada savatga faqat oxirgi mahsulot tushardi
- **Tezlik (1 mln sotuv):** sotuvlar ro‘yxati ~2,5 s → 0,18 s, mahsulotlar ro‘yxati ~1,6 s → 0,15 s; yuklama ostida har bir endpoint p95 ≤ 212 ms (talab < 300 ms); hisobotlar < 1,3 s (talab < 2 s). Natijalar `backend/test/bench/results/` da saqlanadi va `bench:compare` bilan solishtiriladi
- Ochiq xavfsizlik masalasi SEC-01 — Phase 16 da yopildi
- Yangi migratsiya yo‘q

## Phase 14 natijasi (Frontend integration)

- **Xato holatlari hamma joyda:** bosh sahifa panellari, kassa (omborlar, mahsulotlar, mijoz tavsiyalari), mahsulot tanlovi va formalardagi tanlov ro‘yxatlari yuklanmasa — "Qayta urinish" bilan xato ko‘rsatiladi. Yuklanmagan ma’lumot endi "bo‘sh", "topilmadi" yoki "ombor biriktirilmagan" deb ko‘rinmaydi
- **Tasdiqlash:** guruhni arxivlash va xarajat kategoriyasini nofaol qilish ham tasdiq so‘raydi (BR-33 dagi barcha amallar endi tasdiq bilan); faollashtirish va arxivdan chiqarish — darhol
- **Omborlar** sahifasi sahifalanadi (12/24/48/96) — avval 100 tadan keyingilari ko‘rinmasdi
- **Tezroq ochilish:** boshlang‘ich yuklama ~216 → ~190 KB (gzip): validatsiya kutubxonasi faqat formali sahifalarda, bosh sahifa grafigi alohida yuklanadi
- **O‘zbekcha matn:** ESLint qoidasi kengaytirildi (atributlar, bildirishnomalar, forma xabarlari); brauzer QA sahifa, kalendar, ro‘yxat, menyu va oynalarda inglizcha so‘z qidiradi. `qa:ui` haqiqiy backend bilan ham ishlaydi: `QA_LOGIN=<login> QA_PASSWORD_FILE=<fayl> pnpm --filter @divine/frontend qa:ui --base <url> --sizes 1440`
- Ochiq xavfsizlik masalasi: [SECURITY §15.1](docs/SECURITY.md) (SEC-01) — login maydoniga yozilgan parol auditda qolishi mumkin; qaror kutilmoqda
- Yangi migratsiya yo‘q

## Phase 13 natijasi (Audit)

- **Audit jurnali** — Sozlamalar → "Audit jurnali" (faqat admin): kim, qachon, qaysi amalni bajargani; filtrlar (sana, amal, obyekt turi, foydalanuvchi, obyekt ID); "Yana yuklash" bilan sahifalash; yozuv tafsilotida o‘zgarishlar "oldin → keyin" ko‘rinishida
- Jurnalni hech kim o‘zgartira yoki o‘chira olmaydi (API'da bunday endpoint yo‘q, bazada trigger)
- Har bir o‘zgartiruvchi amal (user, mahsulot, ombor, kirim, sotuv, mijoz, xarajat, sozlama, kirish/chiqish) avtomatik test bilan audit qamrovi tekshiriladi
- Demo (mock) rejimida ham jurnal ishlaydi — amallar backend bilan bir xil nom bilan yoziladi (IP va so‘rov ID'siz)
- Yangi migratsiya yo‘q

## Phase 12 natijasi (Reports + Dashboard + Settings)

- **Hisobotlar** haqiqiy backend bilan: sotuvlar, mahsulotlar (sotilgan/sotilmagan), ombor qoldig‘i, kirimlar, xarajatlar (kategoriya bo‘yicha yig‘ma bilan), user sotuvlari, mahsulot sotuvlari, mijoz xaridlari va **moliyaviy xulosa** (tushum, tannarx, yalpi foyda, xarajatlar, sof foyda, kirimlar, ombor qiymati)
- Sana oralig‘i majburiy (ko‘pi bilan 366 kun); tanlanmasa — joriy oy. Filtrlar birgalikda ishlaydi; yig‘ma butun filtr bo‘yicha
- Tannarx, foyda va ombor tannarxi faqat `products.read_cost` ruxsati bilan (server javobida ham yo‘q); hisobotlar faqat admin uchun
- Moliyaviy xulosada ombor tanlansa xarajat va sof foyda "—" (xarajatlar omborga bog‘lanmagan)
- **Bosh sahifa:** admin — kompaniya bo‘yicha KPI, savdo grafigi (7/14/30 kun), eng ko‘p sotilganlar, kam qolgan mahsulotlar; sotuvchi — faqat o‘zining bugungi savdosi, oxirgi sotuvlari va omborlari. Barcha qiymatlar so‘rov paytida bazadan (Toshkent kuni bo‘yicha)
- **Sozlamalar:** kompaniya nomi, kam qoldiq chegarasi (dashboard, mahsulot, ombor va hisobotlarda darhol qo‘llanadi), valyuta yozuvi; o‘zgarishlar audit'ga yoziladi. Mock'dagi ta’sirsiz maydonlar olib tashlandi; kassa va kirimda standart ombor — ruxsat etilgan birinchi faol ombor
- Export (Excel/CSV) hali yo‘q — arxitektura tayyor (REQ-111)
- Performance: `pnpm --filter @divine/backend bench:reports` — 1 mln sotuvli alohida benchmark (Docker, ~4 daqiqa; CI'ga kirmaydi), natijalar — [docs/DATABASE.md §7.2](docs/DATABASE.md)
- Yangi migratsiya yo‘q

## Phase 11 natijasi (Expenses)

- Xarajatlar haqiqiy backend bilan: sana, summa, **kategoriya (majburiy)** va izoh; holat ("To‘langan / Kutilmoqda") yo‘q
- Sotuvchi faqat xarajat qo‘shadi (faol kategoriyani tanlab); ro‘yxat, summalar, tahrirlash va o‘chirish — faqat admin
- Kategoriyalarni admin Xarajatlar sahifasidagi **Kategoriyalar** oynasida boshqaradi: qo‘shish, qayta nomlash, nofaol qilish, xarajatsizini o‘chirish. Boshlang‘ich ro‘yxat bo‘sh — birinchi kategoriya qo‘shilmaguncha xarajat kiritib bo‘lmaydi
- Sana Toshkent vaqti bo‘yicha bugundan keyin bo‘lishi mumkin emas
- O‘chirish — soft delete (yozuv bazada qoladi, ro‘yxat va yig‘madan chiqadi); filtrlar: sana oralig‘i, kategoriya, kiritgan user, izoh bo‘yicha qidiruv
- **Yangi migratsiya:** `20261023100000_expenses_drop_status` — yangilangandan keyin `pnpm --filter @divine/backend db:deploy`

## Phase 10 natijasi (Sales)

- Kassa haqiqiy backend bilan: sotuv bitta tranzaksiyada — narx va tannarx mahsulot kartochkasidan (client narx yubora olmaydi), qoldiq faqat `InventoryService` orqali kamayadi, mijoz va uning yig‘malari, audit
- Idempotent: tarmoq xatosidan keyin qayta bosish ikkinchi sotuv yaratmaydi (`Idempotency-Key`); boshqa ma’lumot bilan shu kalit — rad etiladi
- Overselling yo‘q: parallel sotuvlarda ham qoldiqdan ortiq sotilmaydi; yetmasa — barcha yetmayotgan mahsulotlar nomi va qoldig‘i bilan xabar
- Sotuvlar tarixi: filtrlar (sana, mahsulot, sotuvchi, ombor, raqam/mijoz) va yig‘ma; sotuvchi faqat o‘z sotuvlarini ko‘radi, tannarx va foyda — faqat admin
- Yangi migratsiya yo‘q

## Phase 9 natijasi (Customers)

- Mijozlar: ro‘yxat (ism yoki telefon raqami bo‘yicha server qidiruvi, saralash, pagination), yaratish, tahrirlash, tafsilot va xarid tarixi (haqiqiy sotuvlardan; sotuvlar Phase 10 dan keyin paydo bo‘ladi)
- Ism majburiy, telefon ixtiyoriy va `+998XXXXXXXXX` ga keltiriladi; takroriy ism/telefon ruxsat (oila a’zolari); o‘chirish yo‘q
- Sotuvchi kassada mijozni qidiradi va yaratadi — faqat ism va telefonni ko‘radi; izoh, yig‘malar va xarid tarixi yopiq
- Audit'ga shaxsiy ma’lumot yozilmaydi
- Frontend: Mijozlar sahifalari va kassadagi mijoz qidiruvi haqiqiy backend'ga ulangan
- Yangi migratsiya yo‘q

## Phase 8 natijasi (Incoming)

- Kirim hujjatlari: ro‘yxat (raqam/izoh bo‘yicha qidiruv, holat, ombor, sana filtrlari, saralash), qoralama yaratish va tahrirlash, tafsilot, bekor qilish
- Totallar faqat serverda (`line_total` DB'da hisoblanadi); client yuborgan totallar rad etiladi; mahsulot nomi va shtrix-kodi hujjatda snapshot
- Tasdiqlash — bitta tranzaksiya: qoldiq faqat `InventoryService` orqali oshadi, ledger yoziladi; xato bo‘lsa hech narsa saqlanmaydi; takroriy/parallel tasdiqlash qoldiqni ikki marta oshirmaydi
- Nofaol omborga kirim yo‘q; begona ombor ID bilan chetlab o‘tib bo‘lmaydi; kelgan narxi faqat `products.read_cost` bilan
- Frontend: Kirim sahifalari haqiqiy backend'ga ulangan (ruxsatga qarab tugmalar); kassa aralash rejimda haqiqiy qoldiqni ko‘rsatadi
- Yangi migratsiya yo‘q

## Phase 7 natijasi (Warehouses + Inventory)

- Omborlar: ro‘yxat (qidiruv, holat filtri), yaratish, tahrirlash, faollashtirish / nofaol qilish (tasdiq bilan), detal — ko‘rsatkichlar, qoldiqlar, harakatlar tarixi
- Sotuvchi faqat o‘ziga biriktirilgan faol omborlarni ko‘radi (ko‘rsatkichlarsiz); detal, qoldiq, harakatlar va boshqaruv — faqat admin; to‘g‘ridan-to‘g‘ri API so‘rovi bilan ham `403`
- Nofaol omborga yangi kirim/sotuv qilinmaydi (`422`); qoldiq, tarix va userlarga biriktiruv saqlanadi; o‘chirish yo‘q
- `InventoryService` — qoldiqni o‘zgartiradigan yagona joy (Phase 8 kirim va Phase 10 sotuv shundan foydalanadi); reconciliation endpointi va kunlik job (03:00)
- Frontend: Ombor sahifalari haqiqiy backend'ga ulangan; kassa aralash rejimda ombor va mahsulotni serverdan o‘qiydi (sotuvni saqlash — Phase 10)
- Yangi migratsiya yo‘q

### Dev: sotuvchi kassasini haqiqiy backend bilan sinash

Production ma’lumoti avtomatik yaratilmaydi — ombor va biriktiruv admin tomonidan **ataylab** sozlanadi (audit'ga yoziladi):

1. Backend va `VITE_AUTH_MODE=http` frontendni ishga tushiring, `admin` bilan kiring.
2. **Ombor → Ombor qo‘shish**: masalan, "Sinov ombori".
3. **Userlar →** sotuvchi (masalan, `sinovkassir`) **→ Tahrirlash → Omborlar**: "Sinov ombori"ni belgilang, saqlang. Kerak bo‘lsa — **Parolni tiklash** (yangi parol bir marta ko‘rsatiladi).
4. Sotuvchi bilan kiring → **Sotuvlar**: kassada "Sinov ombori" tanlangan, mahsulotlar serverdan, qoldiq shu ombor bo‘yicha.

5. Qoldiq uchun: **Kirim → Kirim qo‘shish** — "Sinov ombori", mahsulotlar, miqdor va kelgan narxi → **Tasdiqlash va omborga qabul qilish** (Phase 8). Shundan keyin kassada mahsulot qoldiq bilan ko‘rinadi.

6. Sotuvchi kassada mahsulotni savatga qo‘shadi, mijoz ismini kiritadi va **Savdoni tasdiqlash** — sotuv serverda saqlanadi (Phase 10), qoldiq kamayadi, sotuv tarixida ko‘rinadi.

## Phase 6 natijasi (Products + Groups)

- Mahsulot guruhlari: ro‘yxat/qidiruv, yaratish, tahrirlash, arxivlash, mahsulotsiz guruhni o‘chirish
- Mahsulotlar: serverda qidiruv (nom yoki shtrix-kod), guruh/ombor/holat/qoldiq filtrlari, saralash, pagination; yaratish, tahrirlash, arxivlash, shtrix-kod bo‘yicha lookup, tafsilot (summary)
- **Kelgan narxi sotuvchiga hech qayerda berilmaydi** — backend javobida kalit yo‘q (ro‘yxat, detal, lookup, summary 403, saralash 400), frontend ham yashiradi
- Tahrirlash va arxivlash eski sotuv/kirim hujjatlarini o‘zgartirmaydi (snapshot)
- Frontend: Mahsulotlar va Guruhlar sahifalari haqiqiy backend'ga ulangan; kassa/kirim aralash rejimda mock mahsulotlar bilan ishlashda davom etadi
- Yangi migratsiya yo‘q

## Phase 5 natijasi (Users)

- Userlar ro‘yxati: serverda qidiruv (login/ism), rol va holat filtrlari, saralash, pagination
- User yaratish: parolni server yaratadi (6 raqam, CSPRNG), javobda bir marta; login case-insensitive unique; omborga biriktirish
- Tahrirlash (ism, rol, omborlar — bitta tranzaksiya), bloklash/blokdan chiqarish (sessiyalar darhol bekor), parol tiklash (eski parol va tokenlar bekor, lockout tozalanadi)
- Self-protection: o‘z roli, holati va paroli → `403`; oxirgi faol ADMIN → `409 LAST_ACTIVE_ADMIN` (parallel holat ham)
- Audit: `USER_CREATED/UPDATED/STATUS_CHANGED/PASSWORD_RESET/WAREHOUSES_CHANGED` — parol va hash'siz
- Frontend: Userlar sahifasi haqiqiy backend'ga ulangan (`VITE_AUTH_MODE=http`), demo rejim saqlangan
- Yangi migratsiya yo‘q

## Phase 4 natijasi (Authentication + RBAC)

- Login (case-insensitive login + 6 xonali parol), access JWT (15 daq, xotirada), rotatsiyali refresh cookie + reuse detection, logout, `me`
- argon2id + pepper (`v1$`), progressive lockout (5 xato → 15 → 30 … 24 soat; noma’lum login ham), bir xil xato javoblari (enumeration yo‘q)
- Global guard'lar: rate limit → JWT → permission; `@Public` / `@Authenticated` / `@RequirePermissions` / `@RequireAnyPermission`; dekoratorsiz endpoint bo‘lsa ilova ishga tushmaydi
- `AccessContext` + ombor ownership helper'lari, auth audit'i (parol/token'siz), login/refresh rate limit
- Birinchi admin — `db:bootstrap-admin` CLI (HTTP endpoint yo‘q)
- Frontend: login sahifasi, himoyalangan marshrutlar, ruxsat bo‘yicha menyu va "Ruxsat yo‘q" sahifasi, 401 → avtomatik refresh
- Biznes endpointlari — Phase 5 (Users)dan boshlab ✔

## Phase 3 natijasi (Backend foundation)

- Yagona xato tizimi: `AppError` → global filter → `{ error: { code, message (o‘zbekcha), details?, requestId } }`; DB xatolari (unique, FK, RESTRICT, CHECK, trigger, timeout) xavfsiz map qilinadi
- `ZodValidationPipe` (`@ZodBody` / `@ZodQuery` / `@ZodParam`), shared sxemalar, o‘zbekcha xabarlar
- Pagination, whitelist saralash, filtr foundation (search, holat, sana oralig‘i, user/ombor/mahsulot)
- Toshkent kuni chegaralari (IANA, DST'ga chidamli), `TransactionRunner` (timeout, rollback, deadlock retry)
- Request ID (birinchi middleware), structured so‘rov logi (route, status, davomiylik), kengaytirilgan redaction
- Rate limit (Redis, atomik), body ≤ 1 MB, `$queryRawUnsafe` taqiqi, Swagger umumiy sxemalari
- Biznes endpointlari hali yo‘q — Phase 4 (Auth)dan boshlanadi

## Phase 2 natijasi (Database)

- `schema.prisma`: 20 ta jadval, 10 ta enum, barcha relationlar va FK delete strategiyasi (tarixi bor yozuvlar RESTRICT)
- 5 ta migratsiya: sxema (IDENTITY, GENERATED ustunlar), CHECK'lar (NaN himoyasi bilan), o‘zgarmaslik va ledger invariant trigger'lari, reconciliation view'lari, `divine_app` roli va huquqlar, UTC
- Idempotent seed: rollar, permissionlar (`@divine/shared` bilan sinxron), sozlamalar
- 99 ta DB testi (real PG 18): constraint'lar, o‘zgarmaslik, ledger, 20 ta parallel sotuv, tarixiy yaxlitlik, relationlar, seed, drift
- Backend business logic hali yo‘q — Phase 3'dan boshlanadi

## Phase 1 natijasi

- Monorepo (pnpm + Turborepo), TypeScript strict, ESLint (shu jumladan "UI matni faqat lug‘atdan" va XSS qoidalari), Prettier
- `@divine/shared`: enumlar, 30 ta permission va rol xaritasi, error kodlari va o‘zbekcha xabarlar, o‘zbekcha Zod error map, validatsiya primitivlari (login, parol, mijoz ismi, telefon, pul, miqdor, shtrix-kod, sana oralig‘i, pagination, sort)
- API skeleti: Zod env validatsiyasi, pino (redaction, requestId), Prisma 7 + PostgreSQL, Redis, helmet, CORS, Swagger, `/health` (controller → service → repository)
- Web skeleti: layout (desktop sidebar + mobil drawer), TZ §16 navigatsiyasi, server holati ko‘rsatkichi, i18n lug‘ati, API klient, formatlash (pul, miqdor, Toshkent vaqti), loading/empty/error komponentlari
- Docker: compose (infra + full stack), multi-stage non-root image'lar, Nginx; CI (lint → typecheck → test → build → Docker); Dependabot
- To‘liq arxitektura hujjatlari (`docs/`)
