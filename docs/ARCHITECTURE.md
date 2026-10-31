# Divine.uz — Arxitektura

> **Holat:** Phase 1 (Architecture + Project Foundation) · **Manba:** `Divine_uz_TZ_02` (TZ) — source of truth
> Bog‘liq hujjatlar: [DATABASE](DATABASE.md) · [RBAC](RBAC.md) · [API](API.md) · [BUSINESS-RULES](BUSINESS-RULES.md) · [SECURITY](SECURITY.md) · [DEVELOPMENT-PLAN](DEVELOPMENT-PLAN.md) · [REQUIREMENTS-MATRIX](REQUIREMENTS-MATRIX.md)

---

## 1. Tizim haqida umumiy ma’lumot

Divine.uz — chakana savdo va bozor bizneslari uchun **web ERP**. Tizimning markazida **inventar** turadi:

- tasdiqlangan **kirim** ombor qoldig‘ini oshiradi;
- tasdiqlangan **sotuv** qoldiqni kamaytiradi;
- qoldiq hech qachon manfiy bo‘lmaydi;
- har bir harakat o‘zgarmas ledger’da qayd etiladi.

| Xususiyat | Qaror |
|---|---|
| Arxitektura uslubi | **Modular monolith**: qatlamli (layered) va domain yadroli |
| Mijozlar | Brauzer (React SPA); kelajakda mobil ilova (xuddi shu REST API) |
| API | REST, `/api/v1`, JSON, OpenAPI |
| Ma’lumotlar | PostgreSQL 18 (yagona haqiqat manbai), Redis (rate limit va hisoblagichlar; biznes ma’lumotlari emas) |
| Rollar | `ADMIN`, `USER` + permission-based RBAC |
| UI tili | 100% o‘zbek tili (lotin) |
| Vaqt | DB va API'da UTC; biznes kuni va ko‘rinish `Asia/Tashkent` (UTC+5) bo‘yicha |

### 1.1. Qabul qilingan qarorlar (Phase 1 da tasdiqlangan)

Quyidagilar TZ'dagi noaniqlik va ziddiyatlar bo‘yicha qabul qilingan qarorlar. Batafsil: [BUSINESS-RULES.md §5](BUSINESS-RULES.md#5-qabul-qilingan-qarorlar).

| ID | Qaror |
|---|---|
| D-01 | Navigatsiyadagi **"Chiqim" = Xarajatlar** bo‘limi (TZ §11) |
| D-02 | Foyda uchun tannarx: sotuv paytidagi `product.cost_price` **snapshot**i `sale_items.unit_cost` ga yoziladi |
| D-03 | Sotuvni bekor qilish, qaytarish, inventarizatsiya tuzatishi va omborlararo ko‘chirish **hozircha scope'da yo‘q**; ledger va enum'lar ularga tayyor |
| D-04 | USER'lar omborga biriktiriladi (`user_warehouses`) va faqat o‘sha omborlardan sotadi |
| D-05 | Shtrix-kod **ixtiyoriy**, lekin berilsa **unique** |
| D-06 | Audit jurnali **hamma uchun o‘zgarmas** (ADMIN ham faqat o‘qiydi) |
| D-07 | Tasdiqlangan kirim va sotuv o‘zgartirilmaydi va o‘chirilmaydi (TZ §2 "full CRUD" va §14 ledger o‘rtasidagi ziddiyat ledger foydasiga hal qilingan) |
| D-08 | Sotuv va kirim qatorlarida mahsulot nomi va shtrix-kodi snapshot qilinadi (Phase 2) |
| D-09 | Shtrix-kod barcha mahsulotlar (arxivlanganlar ham) orasida unique (Phase 2) |
| D-10 | Birinchi admin Phase 4 CLI orqali yaratiladi, seed'da parol yo‘q (Phase 2) |

---

## 2. Arxitektura diagrammasi

```
                         ┌──────────────────────────────────────────┐
   Brauzer (SPA)         │  Nginx (8080)                            │
   React + Vite  ───────▶│   /          → statik SPA (index.html)   │
                         │   /assets/*  → hash'langan fayllar       │
                         │   /api/*     → reverse proxy ──────┐     │
                         └────────────────────────────────────┼─────┘
                                                              ▼
┌──────────────────────────────────────────────────────────────────────────┐
│ NestJS API (Node 24, ESM)                                                │
│                                                                          │
│  HTTP middleware: helmet · CORS · pino-http (requestId) · body limit     │
│  ┌────────────────────────────────────────────────────────────────────┐  │
│  │ Presentation/API: Controller ← Guards (Auth, Permissions, Throttle)│  │
│  │                   ← ZodValidationPipe ← ErrorFilter                │  │
│  ├────────────────────────────────────────────────────────────────────┤  │
│  │ Application: Service (use-case, transaction chegarasi, audit,      │  │
│  │              ownership tekshiruvi)                                  │  │
│  ├────────────────────────────────────────────────────────────────────┤  │
│  │ Domain: sof TS qoidalar (miqdor siyosati, total/foyda, holat        │  │
│  │         o‘tishlari, login/parol qoidalari) — framework'siz         │  │
│  ├────────────────────────────────────────────────────────────────────┤  │
│  │ Data access: Repository (Prisma; atomic stock uchun parametrlangan  │  │
│  │              raw SQL)                                               │  │
│  └────────────────────────────────────────────────────────────────────┘  │
└──────────────┬──────────────────────────────────────────┬────────────────┘
               ▼                                          ▼
   ┌──────────────────────────┐              ┌───────────────────────────┐
   │ PostgreSQL 18            │              │ Redis 8                   │
   │ PK/FK/UNIQUE/CHECK,      │              │ rate-limit storage,       │
   │ trigger (ledger va audit │              │ IP throttle hisoblagich-  │
   │ o‘zgarmasligi), indexlar │              │ lari (ephemeral)          │
   └──────────────────────────┘              └───────────────────────────┘

   shared (@divine/shared): Zod sxemalari, enumlar, permission va error kodlari,
   o‘zbekcha xabarlar. API ham, Web ham shu paketni ishlatadi.
```

---

## 3. Modullar

### 3.1. Backend modullari (`backend/src/modules/*`)

| Modul | Mas’uliyati | Bog‘liqliklar | Phase |
|---|---|---|---|
| `health` | Liveness/readiness (PostgreSQL, Redis) | infra | **1 (tayyor)** |
| `auth` | Login, refresh, logout, `me`, lockout, sessiyalar, `JwtAuthGuard`, `AccessTokenMiddleware`, bootstrap admin CLI | audit | **4 (tayyor)** |
| `users` | User ro‘yxati/qidiruv, yaratish (server paroli), tahrirlash, bloklash, parol tiklash, omborga biriktirish, self-protection | auth (`PasswordHasher`), audit | **5 (tayyor)** |
| `roles` | Rol va permissionlarni o‘qish (seed orqali boshqariladi). Phase 4'da alohida modul kerak bo‘lmadi: permissionlar `auth.repository` orqali o‘qiladi | — | 4 → kerak bo‘lganda |
| `product-groups` | Guruhlar CRUD, arxivlash (D-14) | audit | **6 (tayyor)** |
| `products` | Mahsulot CRUD, qidiruv (nom/shtrix-kod), lookup, holat, summary; `costPrice` faqat `products.read_cost` bilan (`toProductDto`) | audit | **6 (tayyor)** |
| `warehouses` | Ombor CRUD, faollashtirish/nofaol qilish (o‘chirish yo‘q, D-15), detal, qoldiq, harakatlar; USER — faqat o‘z ACTIVE omborlari (OWN-01) | inventory (harakatlar ro‘yxati), audit | **7 (tayyor)** |
| `inventory` | **Stockni o‘zgartiradigan YAGONA modul**: `assertOperationalWarehouse` (OWN-02 + BR-21, ombor `FOR SHARE`), `increase`/`decrease` (tartiblangan lock, shartli UPDATE, ledger), harakatlar, reconciliation endpointi va kunlik job (Redis qulfi) | audit | **7 (tayyor)** |
| `incoming` | Kirim (DRAFT → CONFIRMED/CANCELLED): qoralama yaratish/tahrirlash (snapshot, server totallari), atomik tasdiqlash (`InventoryService`), bekor qilish; narxlar faqat `products.read_cost` (`toIncomingDto`) | inventory, audit | **8 (tayyor)** |
| `customers` | Mijozlar: qidiruv (ism trgm, telefon raqamlari), yaratish, tahrirlash, xarid tarixi (haqiqiy `sales`dan), yig‘malar (cache ustunlar — faqat o‘qish); USER uchun minimal DTO (`toCustomerDto`, OWN-07); o‘chirish/arxiv yo‘q | audit | **9 (tayyor)** |
| `sales` | Atomic sotuv (§12.1): ombor ruxsati/faollik, mahsulotlar `FOR SHARE`, narx va tannarx snapshot (D-16), `InventoryService.decrease`, mijoz yig‘malari, audit — bitta tranzaksiya; idempotentlik (UNIQUE kalit + kanonik `request_hash`); ro‘yxat (OWN-04, summary) va detal (OWN-05); `toSaleDto` — mijoz xarid tarixida ham | inventory, audit | **10 (tayyor)** |
| `expenses` | Xarajatlar: ro‘yxat (filtrlar + yig‘ma), qo‘shish (sotuvchi ham — D-12), qisman tahrirlash, soft delete; kategoriyalar (majburiy, faqat faol tanlanadi, ADMIN boshqaradi — D-19; `toExpenseCategoryDto` sotuvchiga `id, name`); sana Toshkent bo‘yicha bugundan keyin emas (`Clock`); holat yo‘q (D-11) | audit | **11 (tayyor)** |
| `reports` | 8 ta hisobot + `finance-summary` (ustunlar, filtrlar, yig‘ma — shared `REPORT_DEFINITIONS`; raw SQL CTE, sahifa + yig‘ma bitta `REPEATABLE READ` tranzaksiyada); sana oralig‘i majburiy, ≤ 366 kun (D-21); tannarx ustunlari faqat `products.read_cost`; `reportStatements`/`financeStatement` — benchmark ham shu SQL'ni o‘lchaydi | o‘qish (read-model so‘rovlari) | **12 (tayyor)** |
| `dashboard` | Admin KPI'lari (`summary`, `sales-trend`, `top-products` — `dashboard.admin`), sotuvchining bugungi ko‘rsatkichlari (`my-summary` — `dashboard.own`, OWN-08); "bugun" — `Clock` bo‘yicha Toshkent kuni; kesh yo‘q | o‘qish | **12 (tayyor)** |
| `audit` | Audit yozish (tranzaksiya ichida, maxfiy metadata kalitlari tozalanadi) va o‘qish: `GET /audit-logs` (filtrlar, keyset cursor `(occurred_at, id)`), `GET /audit-logs/:id` — `audit.read`; yozish/o‘zgartirish endpointi yo‘q (D-06) | — | yozish **4 (tayyor)**, o‘qish **13 (tayyor)** |
| `settings` | 3 ta sozlama (kompaniya nomi, kam qoldiq chegarasi, valyuta yozuvi — D-21); qisman PATCH, kalit qatorlari `FOR UPDATE`, audit faqat o‘zgarganlar (`from/to`) | audit | **12 (tayyor)** |

**Modullararo qoida:** stock faqat `InventoryService` orqali o‘zgaradi. `incoming` va `sales` uni o‘z tranzaksiya klienti (`tx`) bilan chaqiradi. Stock mantig‘i yagona joyda turadi va shu tufayli ledger va qoldiq ajralib ketmaydi.

### 3.2. Frontend feature’lari (`frontend/src/features/*`)

`session` (login, sessiya, permission hook'lari — Phase 4), `dashboard`, `users`, `products`, `product-groups`, `warehouses`, `incoming`, `sales`, `customers`, `expenses`, `reports`, `audit`, `settings`, `system` (Phase 1: server holati).

---

## 4. Qatlamlar mas’uliyati

| Qatlam | Joylashuv | Nima qiladi | Nima QILMAYDI |
|---|---|---|---|
| **Presentation (Web)** | `frontend` | Ko‘rsatish, UX-validatsiya (shared Zod), navigatsiya, RBAC asosida menyuni yashirish | Biznes qoidalarni yakuniy tekshirish, narx yoki total hisoblab serverga "haqiqat" sifatida yuborish |
| **API (Controller)** | `modules/*/*.controller.ts` | HTTP: routing, guard, DTO validatsiya, status kod, OpenAPI | Biznes logika, Prisma'ga murojaat |
| **Application (Service)** | `modules/*/*.service.ts` | Use-case orkestratsiyasi, **tranzaksiya chegarasi**, ownership, audit yozish, domain qoidalarini chaqirish | HTTP obyektlari (`req`/`res`) bilan ishlash, SQL yozish |
| **Domain** | `modules/*/domain/*.ts` | Sof funksiyalar: miqdor siyosati, total/foyda (Decimal), holat mashinasi, invariantlar | I/O, framework importlari |
| **Data access (Repository)** | `modules/*/*.repository.ts` | Prisma so‘rovlari, atomic SQL, filter/sort/pagination tarjimasi | Biznes qaror qabul qilish |
| **Database** | PostgreSQL | Constraint’lar (oxirgi himoya chizig‘i), trigger’lar, indexlar | — |

Phase 1'dagi namuna: `modules/health` — `HealthController` (HTTP, status 200/503) → `HealthService` (umumiy holatni hisoblash) → `HealthRepository` (PostgreSQL `SELECT 1`, Redis `PING`).

**Amaldagi holat (Phase 15 da qayd etildi):** `modules/*/domain/` papkalari alohida yaratilmagan. Sof qoidalar — `shared` paketida (validatsiya, ruxsatlar, hisobot ta’riflari, xato kodlari: client va server uchun bitta manba), backend `common/*` (vaqt, ro‘yxat so‘rovi, xatolar, `access-context`) va `modules/auth/password/*` da; miqdor va summa invariantlari esa DB constraint/trigger va service tranzaksiyalarida. Coverage'ning "domain" guruhi shu fayllar bo‘yicha o‘lchanadi ([TESTING §4](TESTING.md#4-coverage-pnpm-coverage)).

---

## 5. Backend arxitekturasi

### 5.1. Texnologiyalar

NestJS 12 (ESM) · TypeScript 6.0 · Prisma 7 (`@prisma/adapter-pg`) · PostgreSQL 18 · Zod 4 · pino (`nestjs-pino`) · ioredis · helmet · `@nestjs/swagger` · SWC (build va test) · Vitest + Supertest.

### 5.2. Papka tuzilmasi

```
backend/
├─ prisma/
│  ├─ schema.prisma          # Phase 1: generator + datasource; Phase 2: modellar
│  └─ migrations/            # Phase 2+
├─ prisma.config.ts          # Prisma CLI konfiguratsiyasi (DATABASE_URL)
├─ src/
│  ├─ main.ts                # bootstrap
│  ├─ app.module.ts          # ildiz modul
│  ├─ bootstrap/             # configure-app (helmet, CORS, prefix), swagger
│  ├─ config/                # env.schema (Zod), config.module (APP_CONFIG), load-env-file
│  ├─ common/                # Phase 3: errors, filters, validation, query (pagination/sort/filtr),
│  │                         #          time (Toshkent kuni), http (request ID), throttling, swagger
│  ├─ database/              # seed (Phase 2), pg ulanish sozlamasi
│  ├─ infrastructure/        # logger (pino), prisma (+ TransactionRunner), redis
│  ├─ generated/prisma/      # prisma generate natijasi (git'da emas)
│  └─ modules/<modul>/
│     ├─ <modul>.module.ts
│     ├─ <modul>.controller.ts
│     ├─ <modul>.service.ts
│     ├─ <modul>.repository.ts
│     ├─ dto/                # shared Zod sxemalaridan olingan DTO va javob mapperlari
│     └─ domain/             # sof qoidalar
├─ test/
│  ├─ unit/                  # domain va service unit testlari
│  ├─ db/                    # Phase 2+: Testcontainers (real PostgreSQL 18, Redis 8) — `pnpm test:db`
│  └─ e2e/                   # HTTP darajasidagi testlar (Supertest); support/probe.module.ts — FAQAT test
├─ nest-cli.json · .swcrc · tsconfig*.json · vitest.config.ts
```

### 5.3. Konvensiyalar

- **ESM:** NestJS 12 faqat ESM. Relative importlar `.js` kengaytmasi bilan yoziladi (`./health.service.js`).
- **Decorator metadata:** DI `emitDecoratorMetadata`ga tayanadi. Shu sababli build va test SWC orqali o‘tadi (esbuild/tsx metadata bermaydi).
- **Konfiguratsiya:** barcha env `config/env.schema.ts` da Zod bilan startup paytida tekshiriladi (fail fast). Kodga `@InjectConfig() config: AppConfig` orqali beriladi, `process.env` to‘g‘ridan-to‘g‘ri o‘qilmaydi.
- **Logging:** faqat pino logger (`no-console` ESLint qoidasi). So‘rov body'si log qilinmaydi. Sensitive kalitlar redact qilinadi (`logger.options.ts`).
- **Xatolar (Phase 3 — implement qilingan):** service va pipe'lar `new AppError(ErrorCode.X, { details?, message?, status? })` tashlaydi → global `GlobalExceptionFilter` (`common/filters/`) → `{ error: { code, message, details?, requestId } }`. Status `error-status.ts` dagi `Record<ErrorCode, number>` dan (API §1.4). DB xatolari `database-errors.ts` orqali map qilinadi (DATABASE §12); Nest/body-parser xatolari kod bo‘yicha o‘zbekcha xabarga aylanadi (framework'ning inglizcha matni hech qachon chiqmaydi). Kutilmagan xatolar `500 INTERNAL_ERROR`; texnik tafsilot faqat server log'ida, `requestId` bilan. Log uchun xato `serializeErrorForLog` orqali o‘tadi: Prisma xabarlari (argument qiymatlari) va DB `detail` (qator qiymatlari) yozilmaydi.
- **Validatsiya (Phase 3 — implement qilingan):** `ZodValidationPipe` (`nestjs-zod` Nest 12'ni qo‘llamaydi). Controller'da `@ZodBody(schema)`, `@ZodQuery(schema)`, `@ZodParam('id', uuidSchema)`. Sxemalar va o‘zbekcha xabarlar `@divine/shared`dan (takrorlanmaydi). Body uchun `z.strictObject` — noma’lum maydonlar rad etiladi (mass assignment himoyasi); query'da noma’lum parametrlar e’tiborga olinmaydi.
- **Ro‘yxatlar (Phase 3):** `createListQuerySchema({ sortFields, defaultSort, filters })` + `listFilters` (search, oneOf, id, dateRange) → repository'da `toPrismaPagination`, `toPrismaOrderBy` (sort whitelist → aniq mapping, `id` tie-breaker), `toPrismaDateRange` (Toshkent kuni → UTC), javob `toPaginated` (`{ data, meta }`). Raw SQL hisobotlari uchun `toSqlOrderBy` (faqat `Prisma.sql` fragmentlar).
- **Tranzaksiyalar (Phase 3 — implement qilingan):** `TransactionRunner.run(fn, { isolationLevel?, timeoutMs?, maxWaitMs?, retries? })` — Prisma interaktiv tranzaksiyasi; standart READ COMMITTED, timeout 10 s, maxWait 5 s; faqat `40001`/`40P01`/`P2034` da 3 martagacha eksponensial qayta urinish (§12.3). Repository metodlari ixtiyoriy `tx: Tx` klientini qabul qiladi.
- **Raw SQL:** faqat tagged template (`` $queryRaw`…${v}` ``); `$queryRawUnsafe`/`$executeRawUnsafe` ESLint bilan taqiqlangan.
- **Pul va miqdor:** `Prisma.Decimal` (decimal.js). JSON'da string. JS `number` bilan pul hisoblanmaydi.

---

## 6. Frontend arxitekturasi

### 6.1. Texnologiyalar

React 19 · Vite 8 · TypeScript 6.0 · React Router 8 · Tailwind CSS 4 · shadcn/ui (Radix) · TanStack Query 5 · Zustand 5 · React Hook Form 7 + Zod 4 · sonner (toast) · lucide-react · Vitest + Testing Library.

### 6.2. Papka tuzilmasi

```
frontend/src/
├─ main.tsx                 # Zod o‘zbekcha error map, router, providers
├─ app/
│  ├─ routes.tsx            # marshrutlar: /login (lazy) + RequireAuth → AppLayout (SectionGate — permission)
│  ├─ navigation.ts         # TZ §16 navigatsiyasi + har bir bo‘lim uchun permission
│  ├─ providers.tsx         # QueryClientProvider, Toaster
│  ├─ query-client.ts       # TanStack Query standart sozlamalari
│  ├─ layouts/              # AppLayout, Sidebar (desktop + planshet drawer), MobileNav (telefon pastki menyusi), Topbar
│  └─ pages/                # NotFound, Forbidden ("Ruxsat yo‘q")
├─ features/<feature>/
│  ├─ api/                  # so‘rov funksiyalari + query hook'lar (queryKey fabrikasi)
│  ├─ components/           # feature komponentlari
│  ├─ pages/                # marshrut sahifalari
│  └─ hooks/
├─ shared/
│  ├─ ui/                   # shadcn/ui primitivlari (Button, Card, Badge, Skeleton, ...)
│  ├─ components/           # PageHeader, EmptyState, ErrorState, OptionsLoadError, DataTable, DataPagination, ConfirmDialog
│  ├─ forms/                # zod.ts (zod + zodResolver, o'zbekcha xabarlar bilan), fields.ts
│  ├─ lib/                  # api-client (401 → refresh → qayta urinish), auth-session (token xotirada), api-mode, format, utils
│  └─ hooks/
├─ stores/                  # Zustand: faqat UI holati
├─ i18n/uz.ts               # UI matnlarining YAGONA manbai
└─ styles/globals.css       # Tailwind + dizayn tokenlari
```

### 6.3. Tamoyillar

- **Server state ≠ client state.** Ro‘yxatlar, qoldiqlar, hisobotlar faqat TanStack Query keshida turadi. Zustand faqat UI holati va sessiya holati (`checking`/`authenticated`/`anonymous`) uchun. Access token zustand'da ham emas — `shared/lib/auth-session.ts` modul o‘zgaruvchisida (xotirada); refresh token faqat HttpOnly cookie'da.
- **API rejimlari:** `VITE_API_MODE` (`mock`/`http`) biznes so‘rovlari uchun, `VITE_AUTH_MODE` — backend'da tayyor modullar uchun (`BACKEND_READY_PREFIXES`: `/auth/*`, `/users*`, `/products*`, `/product-groups*`, `/warehouses*`, `/inventory*`, `/incoming*`, `/customers*`, `/sales*`, `/expenses*`, `/expense-categories*`, `/reports*`, `/dashboard*`, `/settings*`, `/audit-logs*`). Phase 12 dan beri barcha biznes modullari backend'da; aralash rejimda mock'da faqat `POST /__demo/reset` qoladi. Bosqichma-bosqich ulash uchun bo‘lgan `pendingBackend` bayrog‘i Phase 14 da olib tashlandi (manba faqat yo‘l bo‘yicha: `transportFor(path)`). `VITE_API_MODE=http` bo‘lsa auth ham `http`.
- **Biznes logika komponentda emas.** Komponent ma’lumotni ko‘rsatadi va hook'ni chaqiradi. Hisob-kitoblar, masalan kirim totali, faqat **UX uchun** qilinadi va server baribir qayta hisoblaydi.
- **Formalar:** React Hook Form + `@divine/shared` Zod sxemasi (`zodResolver`). Server qaytargan `details[].field` xatolari formadagi maydonga bog‘lanadi. `zod` va `zodResolver` faqat `@/shared/forms/zod` orqali import qilinadi (ESLint `no-restricted-imports`; `import type` ruxsat): u import qilinganda o‘zbekcha error map (`configureZodUzbek`) o‘rnatiladi. Shu sababli zod boshlang‘ich bundle'da yo‘q — faqat formali sahifalar yuklaydi (Phase 14: `api-client` chunk 42 → 13 KB gzip). Mock kirish nuqtasi ham o‘zi sozlaydi. `@divine/shared` — `"sideEffects": false` (tree-shaking).
- **i18n:** bitta locale bo‘lgani uchun i18next o‘rniga tiplangan lug‘at (`t.nav.sales`) ishlatiladi. Kalit noto‘g‘ri bo‘lsa, kompilyatsiya xatosi chiqadi. ESLint qo‘lda yozilgan harfli matnni taqiqlaydi (`frontend/src/{app,features,shared/components,shared/ui}/**/*.tsx`): JSX matni, `{'matn'}`, ko‘rinadigan atributlar (`placeholder`, `title`, `aria-label`, `label`, `description` …), `toast.*('…')` va forma xabarlari (`{ error: '…' }`, `{ message: '…' }`). Brauzer QA (`qa:ui`, `qa:interactions`) sahifa, kalendar, ro‘yxat, menyu va modallarda inglizcha UI so‘zlarini qidiradi (AC-25).
- **Formatlash:** pul va miqdor string ko‘rinishida formatlanadi (`1 250 000 so‘m`, Number'ga aylantirilmaydi). Sana va vaqt `Asia/Tashkent` zonasida (`06.10.2026 15:25`).
- **RBAC (UX):** `/auth/me` permissionlari asosida menyu va tugmalar yashiriladi. Haqiqiy himoya backendda ([RBAC.md §5](RBAC.md#5-frontend-permission-tekshiruvi)).
- **Holatlar:** har bir ma’lumot ko‘rsatuvchi sahifa va panelda loading (Skeleton), empty (`EmptyState`), error (`ErrorState` + "Qayta urinish") va success (toast) holatlari bo‘ladi. Yuklanmagan ma’lumot hech qachon "bo‘sh" deb ko‘rsatilmaydi (`error && !data` → xato). Forma tanlov ro‘yxati yuklanmasa — `OptionsLoadError` (maydon ostida, qayta urinish bilan).
- **Code splitting:** sahifalar `lazy` (`app/routes.tsx`); bosh sahifadagi grafik (recharts) alohida chunk — KPI'lar uni kutmaydi.
- **Tasdiqlash (BR-33):** o‘chirish, arxivlash/nofaol qilish, bloklash, parolni tiklash, kirimni tasdiqlash/bekor qilish, savatni tozalash va demo'ni tiklash — `ConfirmDialog`; faollashtirish va arxivdan chiqarish (xavfsiz, qaytariladigan) — darhol.
- **Responsive:** desktop-first. `lg` (1024px) dan kichik ekranda sidebar drawer'ga aylanadi; telefonda (`md`, 768px dan kichik) menyu — ekran pastidagi panel (`MobileNav`): 4 ta guruh (Asosiy, Katalog, Operatsiyalar, Boshqaruv), guruh bosilsa bo‘limlari pastdan ochiladi, bitta bo‘limli guruh to‘g‘ridan-to‘g‘ri havola. Guruhlar — `NAV_SECTIONS` (yon panel bilan bitta manba), ruxsatsiz bo‘limlar yashiriladi.

---

## 7. Shared paket (`shared` → `@divine/shared`)

| Bo‘lim | Tarkibi |
|---|---|
| `constants` | `APP_TIMEZONE`, `API_PREFIX`, pul va miqdor aniqligi, login/parol qoidalari, pagination chegaralari |
| `enums` | `RoleCode`, `UserStatus`, `ProductStatus`, `ProductUnit`, `WarehouseStatus`, `IncomingStatus`, `SaleStatus`, `MovementType`, `MovementReferenceType`, `AuditAction`, `AuditEntityType` — DB enumlari bilan aynan bir xil |
| `permissions` | `Permission` kodlari, `ROLE_PERMISSIONS` (seed manbai), `hasAllPermissions`/`hasAnyPermission` |
| `errors` | `ErrorCode`, `ERROR_MESSAGES_UZ`, `ApiErrorBody`, `isApiErrorBody` |
| `validation` | O‘zbekcha global Zod error map (`configureZodUzbek`), primitivlar (`loginSchema`, `generatedPasswordSchema`, `customerNameSchema`, `moneySchema`, `quantitySchema`, `optionalPhoneSchema`, `barcodeSchema`, `dateRangeSchema`, ...), pagination va sort sxemalari |
| `types` | `MoneyString`, `QuantityString`, `CurrentUser`, `HealthResponse`, ... |

Paket `tsc` bilan `dist/` ga (ESM + `.d.ts`) build qilinadi. Turborepo `^build` bog‘liqligi orqali API va Web'dan oldin build bo‘lishini ta’minlaydi. Modulga xos sxemalar (masalan, `createSaleSchema`) tegishli phase'da shu paketga qo‘shiladi.

---

## 8. Infratuzilma

| Komponent | Tafsilot |
|---|---|
| **Monorepo** | pnpm 11 workspaces + Turborepo 2 (`build`, `lint`, `typecheck`, `test`, `dev`, `db:generate` tasklari, kesh) |
| **Supply-chain** | pnpm `allowBuilds` (faqat tekshirilgan native paketlar install skript ishlatadi), `minimumReleaseAge`, `--frozen-lockfile`, Dependabot |
| **Dev infra** | `docker compose up -d`: PostgreSQL 18 (`127.0.0.1:5434`) va Redis 8 (`127.0.0.1:6381`) |
| **Full stack** | `docker compose --profile app up -d --build`: + `api` (non-root Node image) + `web` (nginx-unprivileged, 8080) |
| **Image'lar** | `docker/api.Dockerfile` (multi-stage; `migrate` target — `prisma migrate deploy`), `docker/web.Dockerfile` (statik build + Nginx; `VITE_API_MODE=http` standart — Phase 16) |
| **Nginx** | SPA fallback, `/api` proxy, secure header'lar (CSP va boshqalar), `/assets` uchun immutable kesh, `client_max_body_size 1m` |
| **Env** | Root `.env` (namunasi: `.env.example`). API uni Zod bilan tekshiradi. Web faqat `VITE_*` qiymatlarni oladi. `NODE_ENV` `.env`da berilmaydi (sabab `.env.example`da yozilgan). `vite build` `VITE_API_MODE` (`http`/`mock`) aniq berilmasa to‘xtaydi — `.env` image va CI'ga kirmaydi, rejim jimgina `mock` bo‘lib qolmasin (Phase 16, SECURITY §19) |
| **Logging** | JSON (prod), pino-pretty (dev), requestId (`X-Request-Id`), redact |
| **CI** | GitHub Actions: `format:check + lint → typecheck → test → build`, keyin Docker image build |
| **Deploy (Phase 17)** | TLS terminator (HSTS) → Nginx → API; migratsiya alohida qadam; PostgreSQL backup (pg_dump + WAL) |

---

## 9. So‘rovning hayot sikli (request lifecycle)

```
1. Brauzer → Nginx: /api/v1/... (bir origin, cookie va CORS muammosiz)
2. Nginx → API: X-Request-Id, X-Forwarded-For
3. Express middleware:
   a. helmet       — secure header'lar (API uchun CSP default-src 'none')
   b. CORS         — faqat CORS_ORIGINS
   c. requestId    — BIRINCHI middleware: kelgan xavfsiz ID yoki yangi UUID, javobga X-Request-Id
                     (body-parser xatolarida ham ID bo'lishi uchun undan oldin)            [Phase 3 ✅]
   d. pino-http    — o'sha ID bilan so'rov logi
   e. body-parser  — JSON/urlencoded, 1 MB chegara (oshsa 413)                          [Phase 3 ✅]
   f. AccessTokenMiddleware — Bearer imzosi (DB'siz) → req.authToken (throttler kaliti uchun) [Phase 4 ✅]
4. Nest pipeline (guard tartibi AuthModule'da aniq):
   a. AppThrottlerGuard     — rate limit (Redis storage; user yoki IP kaliti)                 [Phase 3–4 ✅]
   b. JwtAuthGuard (global) — @Public bo‘lmasa token majburiy; user ACTIVE; AccessContext   [Phase 4 ✅]
   c. PermissionsGuard      — @Authenticated / @RequirePermissions / @RequireAnyPermission   [Phase 4 ✅]
   d. ZodValidationPipe     — params/query/body → tiplangan DTO            [Phase 3 ✅]
   e. Controller            — service'ni AccessContext bilan chaqiradi
   f. Service               — ownership, domain qoidalar, tranzaksiya, audit
   g. Repository            — Prisma / parametrlangan SQL
5. Javob: DTO mapper (rolga qarab maydonlar, masalan costPrice faqat ADMIN'ga) → JSON
6. Xato: GlobalExceptionFilter → { error: { code, message (uz), details, requestId } } [Phase 3 ✅]
7. pino-http: requestId, method, url (query'siz), route shabloni, status, responseTime;
   daraja 2xx/3xx info, 4xx warn, 5xx error (body va header'larsiz)
```

---

## 10. Authentication oqimi

Batafsil: [SECURITY.md §1–3](SECURITY.md#1-authentication).

### 10.1. Login

```
Web                         API                                   PostgreSQL / Redis
 │ POST /auth/login          │                                          │
 │ {login, password} ───────▶│ throttle (IP)  ─────────────────────────▶│ Redis INCR
 │                           │ user = findByLogin(lower(login))  ──────▶│
 │                           │ yo‘q → Redis lockout (kalit: HMAC iz) + dummy verify → 401
 │                           │        audit: xom login EMAS — iz yoki maska (SEC-01)
 │                           │ locked_until > now? → 423 + Retry-After  │
 │                           │ argon2.verify(hash, HMAC(pepper, pwd))   │
 │                           │  ✗ → failed_attempts++ (atomik, progressive lock)
 │                           │      audit AUTH_LOGIN_FAILED → 401 (5-xatoda 423)
 │                           │  ✓ lekin BLOCKED → 403 ACCOUNT_BLOCKED   │
 │                           │  ✓ → failed_attempts=0, last_login_at    │
 │                           │      session: refresh = random(256 bit)  │
 │                           │      INSERT user_sessions(sha256(refresh))│
 │                           │      accessToken = JWT(sub, role, 15 daq)│
 │                           │      audit AUTH_LOGIN_SUCCEEDED          │
 │◀── 200 {accessToken, user}│                                          │
 │    Set-Cookie: dv_refresh=…; HttpOnly; Secure; SameSite=Strict; Path=/api/v1/auth
 │ accessToken → faqat XOTIRADA (localStorage EMAS)
```

**Phase 16 (SEC-01):** mavjud bo‘lmagan login uchun kiritilgan qiymat parol bo‘lishi mumkin — audit metadata'siga xom holda yozilmaydi: aynan 6 raqam (parol shakli) → `loginMasked` + uzunlik, boshqasi → `loginFingerprint` (HMAC-SHA256, kalit `PASSWORD_PEPPER`dan HKDF bilan hosil qilinadi; `common/security/login-fingerprint.ts`, global `AuditModule` provider'i). Redis lockout kaliti ham shu iz bilan; audit o‘qishda eski yozuvlar ham xuddi shunday ko‘rsatiladi (DB'dagi qator o‘zgarmaydi). [SECURITY §15.1](SECURITY.md#151-sec-01-login-maydoniga-yozilgan-parol-auditda-qolishi-mumkin-edi--yopildi-phase-16).

### 10.2. Himoyalangan so‘rov

`Authorization: Bearer <JWT>` → signature, `exp`, `iss`/`aud` tekshiriladi → user PK bo‘yicha DB'dan olinadi (status ACTIVE, rol permissionlari, ombor ID'lari) → `AccessContext` hosil bo‘ladi. Bloklangan user'ning keyingi so‘rovi darhol 401 oladi.

### 10.3. Refresh (rotation + reuse detection)

```
POST /auth/refresh (cookie dv_refresh, header X-Requested-With, Origin tekshiruvi)
 → session = find(sha256(token))
   - topilmadi / muddati o‘tgan        → 401 SESSION_EXPIRED
   - revoked_reason = ROTATED (qayta ishlatilgan!) → butun family revoke,
     audit AUTH_REFRESH_REUSE_DETECTED → 401
   - OK → eski session ROTATED, yangi session (shu family), yangi cookie + yangi accessToken
```

### 10.4. Logout

`POST /auth/logout` (public, cookie + CSRF — access token muddati o‘tgan bo‘lsa ham ishlaydi) → joriy session revoke (`LOGOUT`), cookie tozalanadi, audit yoziladi. Parol reset yoki bloklashda **barcha** sessiyalar revoke qilinadi (Phase 5 ✔, users moduli).

---

## 11. Authorization oqimi

Batafsil: [RBAC.md](RBAC.md).

```
JwtAuthGuard ──▶ AccessContext { userId, role, permissions:Set, warehouseIds:Set }
      │
PermissionsGuard ──▶ @RequirePermissions('sales.create')  → yo‘q bo‘lsa 403 FORBIDDEN
      │
Service ──▶ ownership:
      │      • USER: sale.user_id === ctx.userId, aks holda 404 NOT_FOUND (enumeration'ning oldi olinadi)
      │      • USER: warehouseId ∈ ctx.warehouseIds, aks holda 403 WAREHOUSE_ACCESS_DENIED
      │      • ro‘yxatlarda: WHERE user_id = :me (filtr majburan qo‘yiladi)
Repository ──▶ scoped so‘rov
Response mapper ──▶ maydonlar rolga qarab (USER: costPrice, totalCost, foyda yo‘q)
```

Deny-by-default: guard global. Public endpointlar faqat `@Public()` bilan belgilanadi: `POST /auth/login`, `POST /auth/refresh`, `POST /auth/logout`, `GET /health`. Dekoratorsiz endpoint bo‘lsa, `RouteSecurityAuditor` ilovani ishga tushirmaydi.

**Birinchi admin:** HTTP endpoint yo‘q — faqat server terminalidagi CLI (`pnpm --filter @divine/backend db:bootstrap-admin -- --login admin`). Parol bir marta chiqadi; admin mavjud bo‘lsa (exit 3) yoki login band bo‘lsa (exit 4) hech narsa yaratilmaydi; parallel ishga tushirishda `pg_advisory_xact_lock` faqat bittasini o‘tkazadi.

---

## 12. Tranzaksiya oqimi

Barcha kritik stock operatsiyalari **bitta DB tranzaksiyasi** ichida (`READ COMMITTED` + atomic shartli UPDATE + row lock). Audit yozuvi ham **shu tranzaksiya ichida** bo‘ladi: audit'siz sotuv bo‘lmaydi, sotuvsiz audit ham bo‘lmaydi.

### 12.1. Sotuv (`POST /sales`)

```
BEGIN
 1. idempotency_key bo‘yicha sale bormi? → bor va request_hash bir xil: o‘sha sale (200)
                                           hash boshqa: 409 IDEMPOTENCY_KEY_REUSED
 2. warehouse ACTIVE va ctx'ga ruxsat etilgan
 3. products (ACTIVE) DB'dan; takroriy qatorlar birlashtiriladi; allow_decimal siyosati
 4. customer: customerId bo‘yicha yoki yangi (ism majburiy, telefon ixtiyoriy)
 5. narx va tannarx DB'dan snapshot (clientdan kelgan narx qabul qilinmaydi)
 6. total'lar Decimal bilan
 7. INSERT sales
 8. har bir item, product_id tartibida (deadlock oldini olish uchun):
      UPDATE warehouse_stock SET quantity = quantity - $q, updated_at = now()
       WHERE warehouse_id = $w AND product_id = $p AND quantity >= $q
      RETURNING quantity
      0 qator → ROLLBACK, 409 INSUFFICIENT_STOCK (mahsulot nomi va mavjud miqdor bilan)
 9. INSERT sale_items; INSERT inventory_movements (quantity = -q, balance_after = RETURNING)
10. UPDATE customers: purchase_count, total_spent, last_purchase_at
11. INSERT audit_logs (SALE_CREATED)
COMMIT  (40P01/40001 bo‘lsa 3 martagacha qayta urinish; 23505 idempotency → mavjud sale qaytariladi)
```

**Phase 10 implementatsiyasi** (`SalesService.create`): (0) tranzaksiyadan oldin — kalit bo‘yicha mavjud sotuv: shu user va shu `request_hash` → o‘sha sotuv (200), aks holda `409`; (1) `InventoryService.assertOperationalWarehouse` (ombor `FOR SHARE`); (2) mahsulotlar `FOR SHARE` (ACTIVE, `allowDecimal`); (3) qoldiq oldindan tekshiruvi — barcha yetmayotgan qatorlar bitta `409`da; (4) mijoz: `id` → `FOR UPDATE`, `name` → yangi mijoz + audit; (5) `INSERT sales … SELECT sum(round(q × sale_price, 2)), sum(round(q × cost_price, 2))` — totallar DB yaxlitlashi bilan (sotuv o‘zgarmaydi, keyin UPDATE qilib bo‘lmaydi); (6) `INSERT sale_items` (narx/tannarx/nom/shtrix-kod snapshot); (7) `InventoryService.decrease` — shartli UPDATE, parallel holatda ham aniq xabar bilan `409`; (8) mijoz yig‘malari; (9) audit. `request_hash` — `{ warehouseId, customer, items (birlashtirilgan, productId bo‘yicha tartiblangan, normallashtirilgan miqdor) }` SHA-256. Parallel bir xil kalit: ikkinchi tranzaksiya UNIQUE (`sales_idempotency_key_key`) bilan yiqiladi → service mavjud sotuvni qaytaradi. Lock tartibi: ombor → mahsulotlar → mijoz → stock qatorlari (kirim: hujjat → ombor → mahsulotlar → stock) — sikl yo‘q.

### 12.2. Kirimni tasdiqlash (`POST /incoming/:id/confirm`)

```
BEGIN
 1. UPDATE incoming SET status='CONFIRMED', confirmed_by, confirmed_at
     WHERE id = $1 AND status = 'DRAFT' RETURNING *        (0 qator → 409 INCOMING_NOT_DRAFT)
 2. items = SELECT ... (kamida 1 ta, aks holda 422 INCOMING_EMPTY); product'lar ACTIVE
 3. total_quantity = Σ quantity, total_amount = Σ round(quantity × cost_price, 2) — serverda qayta
 4. har bir item (product_id tartibida):
      INSERT INTO warehouse_stock (warehouse_id, product_id, quantity) VALUES ($w,$p,$q)
      ON CONFLICT (warehouse_id, product_id)
      DO UPDATE SET quantity = warehouse_stock.quantity + EXCLUDED.quantity, updated_at = now()
      RETURNING quantity
      INSERT inventory_movements (INCOMING, +q, balance_after, unit_cost = cost_price)
 5. INSERT audit_logs (INCOMING_CONFIRMED, metadata: totals, items soni)
COMMIT
```

Idempotency: 1-qadamdagi shartli UPDATE va `UNIQUE(reference_type, reference_item_id)` takroriy tasdiqlash stockni ikki marta oshirishiga yo‘l qo‘ymaydi.

**Phase 8 implementatsiyasi** (`IncomingService.confirm`): tartib trigger'lar talabiga moslangan — `SELECT … FOR UPDATE` (hujjat) → DRAFT tekshiruvi (aks holda `409`, joriy holat bilan) → `InventoryService.assertOperationalWarehouse` (OWN-02 + BR-21, ombor `FOR SHARE`) → qatorlar va mahsulotlar `FOR SHARE` (ACTIVE, `allowDecimal`) → shartli `UPDATE … SET status='CONFIRMED', totals = Σ qatorlar WHERE status='DRAFT'` (`incoming_guard` totallarni tekshiradi) → `InventoryService.increase` (omborlar va mahsulotlar ID tartibida; stock UPSERT → ledger) → audit. Ledger trigger'i hujjat CONFIRMED bo‘lishini talab qilgani uchun holat stock'dan oldin yangilanadi; hammasi bitta `TransactionRunner` tranzaksiyasida. Lock tartibi: hujjat → ombor → mahsulotlar → stock qatorlari (ombor holatini o‘zgartirish faqat ombor qatorini `FOR UPDATE` qiladi — sikl yo‘q).

**Tannarx manbai (D-16, tasdiqlangan):** kirim `products` jadvaliga yozmaydi — mahsulotlar faqat `FOR SHARE` bilan o‘qiladi. Kirim narxi hujjat qatorida (`incoming_items.cost_price`) va ledger'da (`inventory_movements.unit_cost`) tarix sifatida qoladi. Foyda va ombor qiymati mahsulot kartochkasidagi `products.cost_price`dan hisoblanadi; sotuv (§12.1, Phase 10) uni `sale_items.unit_cost`ga snapshot qiladi, keyingi kartochka o‘zgarishi eski sotuv foydasiga ta’sir qilmaydi (D-02).

### 12.3. Izolyatsiya strategiyasi (Phase 3)

| Qaror | Sabab |
|---|---|
| Standart **READ COMMITTED** (`TransactionRunner`) | Overselling'ga qarshi himoya izolyatsiya darajasida emas, **atomik shartli UPDATE + row lock**da (`WHERE quantity >= $q`): parallel tranzaksiya lock'ni kutadi va shartni yangi qiymat bilan qayta tekshiradi (PostgreSQL EvalPlanQual). SERIALIZABLE bu yerda ortiqcha qayta urinishlarni keltirib chiqaradi |
| Ko‘p qatorli operatsiyalarda qatorlar **`product_id` tartibida** lock qilinadi | Ikki sotuv bir xil mahsulotlarni teskari tartibda olsa ham deadlock bo‘lmaydi |
| Deadlock (`40P01`) yoki serialization (`40001`) bo‘lsa — **3 martagacha qayta urinish** (20/40/80 ms + jitter) | Kamdan-kam holatlar uchun; `fn` qayta bajarilgani sababli u tranzaksiyadan tashqarida yon ta’sir qilmasligi kerak (HTTP chaqiruv, xabar yuborish — COMMIT'dan keyin) |
| Yakuniy tekshiruvlar **DB'da**: CHECK (`quantity >= 0`), DEFERRED trigger'lar (ledger ↔ stock ↔ hujjat) | Service xato qilsa ham buzilgan holat COMMIT bo‘lmaydi; COMMIT paytidagi xato `DriverAdapterError` sifatida keladi va to‘g‘ri map qilinadi |
| Timeout 10 s, ulanish kutish 5 s | Osilib qolgan tranzaksiya lock'larni ushlab turmasin; oshsa — ROLLBACK va `503` |
| Audit yozuvi **shu tranzaksiya ichida** | Audit'siz o‘zgarish ham, o‘zgarishsiz audit ham bo‘lmaydi |

Tasdiqlangan testlar: 10 dona qoldiqqa 20 ta parallel sotuv → aynan 10 tasi (Phase 2, `inventory.db-spec.ts`); haqiqiy deadlock'dan keyin qayta urinish va ikkala tranzaksiyaning yakunlanishi, timeout → ROLLBACK, COMMIT paytidagi DEFERRED xato → ROLLBACK (Phase 3, `transaction-runner.db-spec.ts`).

---

## 13. Arxitektura qarorlari jurnali (ADR-lite)

| # | Qaror | Sabab | Alternativa |
|---|---|---|---|
| ADR-01 | Modular monolith | ERP domenlari bir-biriga chambarchas bog‘langan, tranzaksiyalar modullararo. Mikroservis ortiqcha murakkablik | Mikroservislar |
| ADR-02 | NestJS 12 (ESM) | DI, guard/pipe/filter qatlamlari, yetuk ekotizim. v12 ESM-only, shuning uchun loyiha ham ESM | Fastify sof, Express sof |
| ADR-03 | Prisma 7 + parametrlangan raw SQL (atomic stock) | Tiplangan klient, migratsiyalar. Atomic shartli UPDATE va `ON CONFLICT` uchun `$queryRaw` | Drizzle, TypeORM |
| ADR-04 | Ledger + joriy stock jadvali | TZ §14 tavsiyasi; tez o‘qish + to‘liq tarix + reconciliation | Faqat ledger (sekin), faqat stock (tarixsiz) |
| ADR-05 | Atomic shartli UPDATE (READ COMMITTED) | Row lock overselling'ning oldini oladi. SERIALIZABLE'ga qaraganda kamroq retry | `SELECT … FOR UPDATE`, SERIALIZABLE |
| ADR-06 | REST (`/api/v1`) | Mobil ilova, kesh, export (CSV) va OpenAPI uchun sodda | GraphQL |
| ADR-07 | JWT access (xotirada) + rotatsiyali refresh (httpOnly cookie, DB'da hash) | Stateless API + sessiyani bekor qilish imkoniyati | Faqat server-side session |
| ADR-08 | shadcn/ui | Har bir UI matni bizning qo‘limizda, shuning uchun 100% o‘zbekcha UI | Ant Design (ichki matnlari to‘liq o‘zbekcha emas) |
| ADR-09 | Tiplangan o‘zbekcha lug‘at (i18next emas) | Bitta locale; kalit xatosi kompilyatsiyada chiqadi | i18next |
| ADR-10 | Vitest (API va Web) + SWC | Bitta test runner; ESM'ni tabiiy qo‘llaydi; decorator metadata SWC orqali | Jest |
| ADR-11 | TypeScript 6.0 (7.0 emas) | `typescript-eslint` va `@nestjs/swagger` hali TS 7'ni qo‘llamaydi | TS 7 |
| ADR-12 | Nginx (web image ichida) | SPA + `/api` proxy bitta origin'da; non-root image | Caddy |
| ADR-13 | PostgreSQL 18 | `uuidv7()` native, CHECK, partial/expression index, `pg_trgm`, JSONB | MySQL |

---

## 14. Versiyalar (Phase 1)

| Paket | Versiya |
|---|---|
| Node.js | 24 |
| pnpm | 11.21 |
| Turborepo | 2.11 |
| TypeScript | 6.0.3 |
| NestJS | 12.1 |
| Prisma | 7.10 (stabil; `latest` tegi RC'ni ko‘rsatgani uchun aniq versiya qotirilgan) |
| Zod | 4.6 |
| React | 19.3 |
| Vite | 8.3 |
| React Router | 8.4 |
| Tailwind CSS | 4.3 |
| TanStack Query | 5.104 |
| Vitest | 5.0 |
| PostgreSQL / Redis (Docker) | 18-alpine / 8-alpine |
