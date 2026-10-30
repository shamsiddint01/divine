# Divine.uz — Ishlab chiqish rejasi

> Loyiha 17 ta phase'da ishlab chiqiladi. Oldingi phase'ga bog‘liq bo‘lgan phase u tugamaguncha boshlanmaydi.
> Har bir phase oxirida: yaratilgan fayllar, test natijalari, REQ → implementatsiya jadvali ([REQUIREMENTS-MATRIX](REQUIREMENTS-MATRIX.md) yangilanadi) va qolgan ishlar ro‘yxati.

---

## 1. Holat

| Phase | Nomi | Holat |
|---|---|---|
| 1 | Architecture + Project Foundation | ✅ **Tugallandi** |
| 2 | Database | ✅ **Tugallandi** (2026-10-08) |
| 3 | Backend foundation | ✅ **Tugallandi** (2026-10-09) |
| 4 | Authentication + RBAC | ✅ **Tugallandi** (2026-10-22) |
| 5 | Users | ✅ **Tugallandi** (2026-10-22) |
| 6 | Products + Groups | ✅ **Tugallandi** (2026-10-22) |
| 7 | Warehouses + Inventory | ✅ **Tugallandi** (2026-10-22) |
| 8 | Incoming | ✅ **Tugallandi** (2026-10-22) |
| 9 | Customers | ✅ **Tugallandi** (2026-10-22) |
| 10 | Sales | ✅ **Tugallandi** (2026-10-22) |
| 11 | Expenses | ✅ **Tugallandi** (2026-10-23) |
| 12 | Reports + Dashboard + Settings | ✅ **Tugallandi** (2026-10-27) |
| 13 | Audit | ✅ **Tugallandi** (2026-10-29) |
| 14 | Frontend integration | ✅ **Tugallandi** (2026-10-29) |
| 15 | Testing | ✅ **Tugallandi** (2026-10-30) |
| 16 | Security review | ✅ **Tugallandi** (2026-10-30) |
| 17 | Production preparation | ⬜ |

## 2. Bog‘liqliklar grafi

```
1 ─▶ 2 ─▶ 3 ─▶ 4 ─▶ 5 ─▶ 6 ─▶ 7 ─▶ 8 ─────────┐
                    │                 └▶ 10 ◀─┤
                    ├──────▶ 9 ───────────┘   │
                    ├──────▶ 11               │
                    └──────▶ 13 (o‘qish API)  │
                     8,10,11 ─▶ 12 ◀──────────┘
                     5–13 ─▶ 14 ─▶ 15 ─▶ 16 ─▶ 17
```

Audit **yozish** har bir modulda o‘z phase'ida qo‘shiladi (5-phase'dan boshlab). Phase 13'da audit o‘qish API'si va qamrov tekshiruvi qilinadi. Har bir backend modul phase'i shu modulning minimal UI sahifasini ham o‘z ichiga olishi mumkin; Phase 14 — yakuniy integratsiya va UX sayqali.

---

## 3. Phase'lar

### Phase 1 — Architecture + Project Foundation ✅
- **Maqsad:** monorepo, konfiguratsiya, ishga tushadigan skeletlar, to‘liq arxitektura hujjatlari.
- **Natija:** pnpm + Turborepo; `@divine/shared` (enumlar, permissionlar, error kodlari, o‘zbekcha xabarlar, Zod primitivlari); NestJS 12 skeleti (config, pino, Prisma, Redis, helmet, CORS, Swagger, `/health`); React skeleti (layout, TZ navigatsiyasi, server holati, i18n); Docker (compose, api/web image'lari, Nginx); CI; `docs/` (8 ta hujjat); README.
- **DoD:** `pnpm ci` (lint → typecheck → test → build) o‘tadi; real PostgreSQL va Redis bilan smoke test; Docker full stack smoke test.

### Phase 2 — Database ✅
- **Bog‘liqlik:** Phase 1 (DATABASE.md).
- **Natija:**
  - `schema.prisma` — barcha 20 ta jadval, enumlar, relationlar
  - Boshlang‘ich migratsiya + qo‘lda SQL: `pg_trgm`, CHECK'lar, `lower()` va partial indexlar, `GENERATED` ustunlar, trigger'lar (ledger, audit, sales immutability, incoming guard), `uuidv7()` default'lari
  - DB rollari (`divine_owner`, `divine_app`) va `GRANT`'lar; `MIGRATION_DATABASE_URL`
  - Seed: rollar, permissionlar, `role_permissions` (`ROLE_PERMISSIONS`dan), sozlamalar, birinchi admin (A-21)
- **Testlar (Testcontainers, real PG 18):** migratsiya toza DB'ga qo‘llanadi; har bir CHECK va UNIQUE buzilishi rad etiladi; trigger'lar UPDATE/DELETE'ni bloklaydi; `divine_app` ledger va auditni o‘zgartira olmaydi; seed idempotent.
- **DoD:** sxema DATABASE.md bilan 1:1 mos; barcha constraint testlari o‘tadi.
- **Natija (2026-10-08):** 5 ta migratsiya, idempotent seed, 99 ta DB testi (real PG 18, Testcontainers), drift yo‘q. Rejadan farqlar: birinchi admin Phase 4 CLI'ga ko‘chirildi (D-10); qo‘shimcha ravishda ledger ↔ stock ↔ hujjat to‘liqligi trigger'lari va 4 ta reconciliation view (DATABASE §5, §13).

### Phase 3 — Backend foundation ✅
- **Bog‘liqlik:** Phase 2.
- **Natija:** `AppError` + global `ErrorFilter` (yagona o‘zbekcha xato strukturasi); `ZodValidationPipe` (body, query, params); pagination va sort helper'lari; `TransactionRunner` (retry 40P01/40001); Prisma xatolarini (`P2002` → `*_TAKEN`) mapping qilish; `@nestjs/throttler` + Redis storage; Toshkent kun chegarasi utiliti; Zod → OpenAPI integratsiyasi; ESLint qoidasi (`$queryRawUnsafe` taqiqi); request timeout; matn maydonlarida boshqaruv belgilarini rad etish; Testcontainers test infratuzilmasi.
- **DoD:** e2e: noma’lum maydon → 400 o‘zbekcha; kutilmagan xato → 500 `INTERNAL_ERROR` stack'siz; rate limit → 429.
- **Natija (2026-10-09):** DoD bajarildi. Implementatsiya: `backend/src/common/` (errors, filters, validation, query, time, http, throttling, swagger) + `TransactionRunner`; Testcontainers infratuzilmasi Phase 2'da qurilgan, Phase 3'da Redis bilan kengaytirildi. Rejadan farqlar: (1) "Zod → OpenAPI integratsiyasi" — umumiy sxemalar (`ApiErrorBodyDto`, `PaginationMetaDto`, global 429/500/503) qilindi; endpoint DTO sxemalarini Zod'dan avtomatik yaratish biznes endpointlari bilan birga (P4+) qo‘shiladi. (2) "Request timeout" — DB darajasida tranzaksiya timeout'i (10 s) qilindi; HTTP darajasidagi umumiy timeout qo‘shilmadi (Nginx `proxy_read_timeout` bilan P17). (3) "Matnlarda boshqaruv belgilarini rad etish" — biznes sxemalari bilan P5+ (Phase 3'da matnli body endpointi yo‘q). Auth'ga oid rate limit (login/refresh) — Phase 4.

### Phase 4 — Authentication + RBAC ✅
- **Bog‘liqlik:** Phase 3.
- **Natija:** `auth` moduli (login, refresh rotation + reuse detection, logout, me); argon2id + pepper (`v1$`); **birinchi admin bootstrap CLI** (`SEED_ADMIN_LOGIN`, 6 xonali parol faqat terminalda bir marta — A-21, D-10); progressive lockout; `JwtAuthGuard` (global, `@Public`); `PermissionsGuard` (`@RequirePermissions`, `@RequireAnyPermission`); `AccessContext`; "himoyasiz endpoint yo‘q" testi. Frontend: login sahifasi, auth store (token xotirada), 401 → refresh → qayta urinish, `/auth/me`, permission bo‘yicha navigatsiya filtri, route guard.
- **Testlar:** login (to‘g‘ri, noto‘g‘ri, bloklangan, lock), timing va enumeration, refresh reuse, RBAC matritsa skeleti.
- **REQ:** REQ-012, REQ-025, REQ-027, REQ-144, REQ-164 (qisman).
- **Natija (2026-10-22):** DoD bajarildi. Backend: `modules/auth` (login/refresh/logout/me, `PasswordHasher`, `TokenService`, Redis'da noma'lum login lockout'i, `JwtAuthGuard`, `AccessTokenMiddleware`), `common/auth` (dekoratorlar, `AccessContext` + ownership helper'lari, `PermissionsGuard`, `RouteSecurityAuditor`), `modules/audit` (`AuditService` — Phase 5 rejasidan oldinroq, auth audit'i uchun), auth rate limit guruhlari, `db:bootstrap-admin` CLI. Frontend: login sahifasi, sessiya store, token xotirada, 401 → single-flight refresh, `RequireAuth`, `SectionGate` + "Ruxsat yo‘q", nav filtri, `VITE_AUTH_MODE`. Yangi migration kerak bo‘lmadi (Phase 2 sxemasi yetarli). Rejadan farqlar: (1) logout — public + CSRF (cookie bo‘yicha), access token talab qilinmaydi; (2) argon2 verify ~170–210 ms (reja 50–100 ms) — parametrlar kamaytirilmadi; (3) `roles` moduli kerak bo‘lmadi; (4) muddati o‘tgan sessiyalarni tozalash — P17. Biznes egasi qarorlari: D-11 (Xarajatlar formasi), D-12 (USER `expenses.create`) — Phase 11'da backend'ga.

### Phase 5 — Users ✅
- **Bog‘liqlik:** Phase 4.
- **Natija:** user CRUD, `POST /users` (server parol generatsiyasi, bir martalik javob), status, reset-password, omborga biriktirish (ombor jadvali Phase 2'da mavjud), self-protection (BR-27), `AuditService` (tranzaksion yozish) birinchi marta ishlatiladi. UI: Userlar sahifasi, parol modali.
- **Testlar:** AC-01…AC-04, audit `USER_CREATED`, parol log'da yo‘qligi.
- **REQ:** REQ-020…REQ-026, BR-01…BR-04.
- **Natija (2026-10-22):** DoD bajarildi. Backend `modules/users` (controller, service, repository): ro‘yxat/qidiruv, detal, yaratish (server paroli), tahrirlash (ism, rol, omborlar — bitta tranzaksiya), bloklash, parol tiklash, ombor biriktirish, `warehouse-options`; self-protection va oxirgi faol ADMIN (`LAST_ACTIVE_ADMIN`, advisory lock); audit `USER_*`. Shared: user sxemalari va `UserDto`. Frontend: Userlar sahifasi haqiqiy backend'ga ulangan (`VITE_AUTH_MODE=http` → `/users*`), mock shu shartnomaga moslandi. Migratsiya kerak bo‘lmadi. Testlar: `users.db-spec.ts` (24, real PG + Redis), `users.service.spec.ts` (6), shared `users.test.ts` (4), frontend (Users 5, transport 3), AC-04 testi 10 000 generatsiyaga oshirildi. Qaror: D-13. Qoldiq: tiklash soniyasida berilgan access token ≤ 1 s amal qiladi (SECURITY §3).

### Phase 6 — Products + Groups ✅
- **Bog‘liqlik:** Phase 5.
- **Natija:** guruhlar CRUD; mahsulot CRUD, status, qidiruv (trgm + barcode), `lookup`, `summary`/`sales`/`stock` (ma’lumot Phase 7–10 dan keyin to‘ladi), rolga qarab DTO (costPrice). UI: Mahsulotlar va Mahsulot guruhlari sahifalari.
- **Testlar:** AC-05, AC-06 (parallel duplicate barcode ham), USER javobida costPrice yo‘q (AC-20).
- **REQ:** REQ-050…REQ-054, BR-10, BR-13.
- **Natija (2026-10-22):** DoD bajarildi. Backend `modules/product-groups` va `modules/products` (controller, service, repository): guruh CRUD + arxivlash (`isActive`), mahsulot CRUD, status, qidiruv/filtr/saralash, `lookup` (shtrix-kod), `summary` (`products.read_cost`), omborga qarab qoldiq. Kelgan narxi (`costPrice`) `products.read_cost` bo‘lmasa javobda kalit sifatida ham yo‘q; bu maydon bo‘yicha saralash 400, `summary` 403. Audit `PRODUCT_*`, `PRODUCT_GROUP_*`. Shared: katalog sxemalari va DTO'lar. Frontend: Mahsulotlar va guruhlar sahifalari haqiqiy backend'ga ulangan (`/products*`, `/product-groups*`); hali mock'dagi modullar `pendingBackend` orqali mock katalogda qoladi. Migratsiya kerak bo‘lmadi. Testlar: `products.db-spec.ts` (28, real PG + Redis), shared `catalog.test.ts` (4), frontend (Products 3, transport 4). Qaror: D-14. Qoldiq: `/products/:id/sales` va `/stock` Phase 7/10 ga qoldirildi (REQ-053 qisman).

### Phase 7 — Warehouses + Inventory ✅
- **Bog‘liqlik:** Phase 6.
- **Natija:** ombor CRUD; `InventoryService.increase/decrease` (atomic SQL, `balance_after`, tartiblangan lock); ombor detali (stock, movements); `GET /inventory/movements`; reconciliation (endpoint + kunlik job). UI: Ombor ro‘yxati va detali.
- **Testlar:** increase/decrease unit va integration; manfiy qoldiq bo‘lmasligi; reconciliation farqni topishi.
- **REQ:** REQ-040…REQ-043, REQ-132, BR-26.
- **Natija (2026-10-22):** DoD bajarildi. Backend `modules/warehouses` (ro‘yxat/qidiruv/holat filtri, detal ko‘rsatkichlari, qoldiq, harakatlar, yaratish, tahrirlash, faollashtirish/nofaol qilish — o‘chirish yo‘q) va `modules/inventory` (`InventoryService.assertOperationalWarehouse/increase/decrease` — ombor `FOR SHARE`, tartiblangan lock, shartli UPDATE, ledger; `GET /inventory/movements`, `GET /inventory/reconciliation` + audit; kunlik job 03:00, Redis qulfi). OWN-01 (USER — faqat o‘z ACTIVE omborlari, ko‘rsatkichlarsiz), BR-21 (nofaol omborga kirim/sotuv → 422), kelgan narxi maydonlari faqat `products.read_cost`. Audit `WAREHOUSE_*`, `INVENTORY_RECONCILIATION_RUN`. Frontend: Ombor sahifalari haqiqiy backend'ga ulangan (qidiruv, holat filtri, nofaol qilish tasdig‘i); kassa aralash rejimda ombor va mahsulotni serverdan o‘qiydi, sotuvni saqlash Phase 10 gacha o‘chirilgan; dev sozlash yo‘li README'da. Migratsiya kerak bo‘lmadi. Testlar: `warehouses.db-spec.ts` (22, real PG + Redis), `test/unit/inventory` (5), shared `warehouses.test.ts` (4), frontend `WarehousesPage.test.tsx` (3), real backend E2E (35 tekshiruv). Qaror: D-15. Qoldiq: HTTP orqali stock o‘zgartiradigan oqimlar (kirim tasdiqlash, sotuv) — Phase 8/10.

### Phase 8 — Incoming ✅
- **Bog‘liqlik:** Phase 7.
- **Natija:** DRAFT yaratish va tahrirlash (server totallari), confirm (atomic, idempotent), cancel. UI: kirim formasi (`useFieldArray`, jami **darhol** yangilanadi, decimal-safe), ro‘yxat, detal, tasdiqlash dialogi.
- **Testlar:** AC-07…AC-10 (rollback, takroriy confirm, UI total testi).
- **REQ:** REQ-060…REQ-065, BR-08, BR-11, BR-17, BR-18.
- **Natija (2026-10-22):** DoD bajarildi. Backend `modules/incoming`: ro‘yxat (raqam/izoh qidiruvi, holat/ombor/mahsulot/user/sana filtrlari, saralash, ombor doirasi), detal, DRAFT yaratish va tahrirlash (qatorlar to‘liq almashtiriladi, nom/shtrix-kod snapshot, totallar DB qatorlaridan), tasdiqlash (hujjat `FOR UPDATE` → `InventoryService.assertOperationalWarehouse` → mahsulotlar `FOR SHARE` → shartli holat o‘tishi → `InventoryService.increase` → audit, bitta tranzaksiya), bekor qilish. Kelgan narxi va summalar faqat `products.read_cost` (`toIncomingDto`). Audit `INCOMING_CREATED/UPDATED/CONFIRMED/CANCELLED`. Frontend: Kirim sahifalari haqiqiy backend'ga ulangan (`/incoming*`), ruxsatga qarab tugmalar, mock API backend shartnomasiga moslandi (snapshot, narx ruxsati, ombor doirasi). Migratsiya kerak bo‘lmadi. Testlar: `incoming.db-spec.ts` (25, real PG + Redis — atomiklik, takroriy va 5 ta parallel tasdiqlash, rollback), `test/unit/incoming` (2), shared `incoming.test.ts` (14), frontend `IncomingPage.test.tsx` (3), real backend E2E (30 tekshiruv). Qaror: D-16. Qoldiq: sotuv (Phase 10) — kassa aralash rejimda haqiqiy qoldiqni ko‘rsatadi, saqlash hali o‘chiq.

### Phase 9 — Customers ✅
- **Bog‘liqlik:** Phase 4 (parallel 5–8 bilan bajarilishi mumkin).
- **Natija:** CRUD, qidiruv (ism trgm, telefon), xarid tarixi, yig‘malar; USER uchun minimal DTO. UI: Mijozlar sahifasi.
- **REQ:** REQ-074, REQ-080, REQ-081, BR-05, BR-06.
- **Natija (2026-10-22):** DoD bajarildi. Backend `modules/customers`: qidiruv (ism ILIKE/trgm, telefon raqamlari ≥ 3), saralash, pagination; yaratish (ism majburiy, telefon normallashtiriladi, takroriy ruxsat — A-23), tahrirlash (snapshot'lar o‘zgarmaydi), detal, xarid tarixi (haqiqiy `sales`dan, tannarx faqat `products.read_cost`), yig‘malar (cache ustunlar). USER: faqat `id, name, phone` (OWN-07), izoh yoza olmaydi, yig‘ma bo‘yicha saralay olmaydi. O‘chirish/arxiv yo‘q (BR-30). Audit `CUSTOMER_*` — shaxsiy qiymatlarsiz. Shared: mijoz sxemalari, `CustomerDto`, `SaleDto` (Phase 10 qayta ishlatadi). Frontend: Mijozlar sahifalari va kassadagi mijoz qidiruvi haqiqiy backend'ga ulangan, ruxsatga qarab tugmalar, mock pariteti. Migratsiya kerak bo‘lmadi. Testlar: `customers.db-spec.ts` (16), `test/unit/customers` (2), shared `customers.test.ts` (10), frontend `CustomersPage.test.tsx` (3), real backend E2E (21). QA: dev serverdagi qa:ui flakiness sababi aniqlandi (Vite dev server ba'zan ilovani yuklamaydi — production build'da 0/120), `ui-qa.mjs`ga CDP timeout va Chrome profilini tozalash qo‘shildi. Qaror: D-17 (tasdiqlangan, 2026-10-22). Qoldiq: yig‘malarni sotuv tranzaksiyasida yangilash va sotuvdagi mijoz qoidalari (AC-15/16) — Phase 10.

### Phase 10 — Sales ✅
- **Bog‘liqlik:** Phase 7, 9.
- **Natija:** `POST /sales` (atomic, idempotent, snapshot narxlar, ownership), ro‘yxat (birlashtiriladigan filtrlar + summary), detal. UI: POS ekrani (skaner, qidiruv, savat, qoldiq, mijoz ismi majburiy, telefon niqobi, Idempotency-Key).
- **Testlar:** AC-11…AC-16, **AC-13 concurrency** (20 parallel → aniq 10), AC-14 idempotency, AC-19 ownership, AC-23 reconciliation; **D-16:** `sale_items.unit_cost` = sotuv paytidagi `products.cost_price` (oxirgi kirim narxi emas).
- **REQ:** REQ-070…REQ-077, REQ-145, BR-05…BR-07, BR-09, BR-15, BR-19…BR-23.
- **Natija (2026-10-22):** DoD bajarildi. Backend `modules/sales`: `POST /sales` — bitta tranzaksiya (ombor ruxsati va faolligi → mahsulotlar `FOR SHARE` → qoldiq tekshiruvi → mijoz `FOR UPDATE` yoki yangi → `sales` + `sale_items` (narx/tannarx snapshot'i kartochkadan — D-16, totallar DB yaxlitlashi bilan) → `InventoryService.decrease` → mijoz yig‘malari → audit); idempotentlik — UUID kalit UNIQUE + kanonik `request_hash` (takroriy → 200, boshqa payload/user → 409, parallel → bitta sotuv); `GET /sales` (OWN-04, filtrlar, yig‘ma) va `GET /sales/:id` (OWN-05); tannarx/foyda faqat `products.read_cost` (`toSaleDto` — mijoz xarid tarixida ham). Frontend: kassa va sotuvlar tarixi haqiqiy backend'ga ulangan (gibrid rejimdagi "sotuv ulanmagan" cheklovi olib tashlandi), ruxsatga qarab foyda ustuni va user filtri; mock backend shartnomasiga moslandi. Migratsiya kerak bo‘lmadi. Testlar: `sales.db-spec.ts` (17, real PG + Redis — AC-11…16, AC-13 20 parallel, AC-14, AC-19, D-16, D-18 (1)–(5), atomiklik, reconciliation), shared `sales.test.ts` (11), frontend `SalesHistoryView.test.tsx` (3) + `mock-api.test.ts` yangilandi, real backend E2E (21). Qaror: D-18 — **tasdiqlangan (2026-10-22)**. Qoldiq: dashboard va hisobotlar (Phase 12) hali mock'da.

### Phase 11 — Expenses ✅
- **Bog‘liqlik:** Phase 4.
- **Natija:** kategoriyalar (ADMIN boshqaradi), xarajat CRUD (soft delete), summary. UI: "Xarajatlar" sahifasi (D-01, D-11).
- **REQ:** REQ-100, REQ-101 (xarajat qismi), BR-31 (kategoriya), BR-32. **Qarorlar:** D-01, D-11 (holat yo‘q), D-12 (USER faqat qo‘shadi), **D-19** (kategoriya majburiy, sotuvchi tanlaydi, kelajak sana taqiq).
- **Topshiriq (2026-10-23, tahlildan keyin):**
  1. **Migratsiya** (yangi, mavjudlari o‘zgarmaydi): `expenses.status` ustuni va `expense_status` turi olib tashlanadi; `category_id` NOT NULL qoladi (D-19). Prisma sxemasi va `migrations.db-spec`/`relationships.db-spec` ("standart holat PAID" → status ustuni yo‘qligi; talab D-11 bilan o‘zgargan).
  2. **Shared:** `validation/expenses.ts` — yaratish `{ date, amount, categoryId, note? }` (strict; `status` → `400`; `date` ≤ bugun, Toshkent), qisman tahrirlash (kamida bitta maydon), kategoriya `{ name }` / `{ name?, isActive? }`, ro‘yxat query (`dateFrom`, `dateTo`, `categoryId`, `createdBy`, `search` — izoh, `sort` ∈ {`date`, `amount`}); `ExpenseDto`, `ExpenseCategoryDto` shared'ga.
  3. **Backend `modules/expenses`:** `GET /expense-categories` — `expenses.read` yoki `expenses.create` (USER: faqat faol, `{ id, name }`); `POST`/`PATCH /expense-categories` — `expenses.manage`, `409 NAME_TAKEN`. `GET /expenses` (+ `summary { count, totalAmount }`, o‘sha filtrlar bilan) va `GET /expenses/:id` — `expenses.read`; `POST /expenses` — `expenses.create` yoki `expenses.manage` (kategoriya mavjud va faol: `404`/`422`); `PATCH` — `expenses.manage` (o‘zgarishsiz — audit yo‘q; faqat faol kategoriyaga ko‘chiriladi); `DELETE` — `expenses.manage`, soft delete `204`, qayta → `404`. Audit: `EXPENSE_CREATED/UPDATED/DELETED`, `EXPENSE_CATEGORY_CREATED/UPDATED` — sana, summa, kategoriya id; **izoh matni yozilmaydi** (`hasNote`, o‘zgargan maydon nomlari).
  4. **Frontend:** `/expenses`, `/expense-categories` → `BACKEND_READY_PREFIXES`; formada majburiy kategoriya (sotuvchida ham); faol kategoriya yo‘q bo‘lsa — tushuntirish (ADMIN'ga kategoriya qo‘shish yo‘li); ADMIN uchun kategoriyalarni boshqarish (Xarajatlar sahifasidan, mavjud dizayn komponentlari bilan); tahrirlash/o‘chirish — `expenses.manage`. Mock backend'ga tenglashtiriladi (ruxsatlar yo‘q edi, PATCH qisman emas edi, kategoriyasiz demo yozuvlar).
  5. **Testlar:** DB — validatsiya (summa ≤ 0, kategoriyasiz, nofaol/noma’lum kategoriya, kelajak sana, `status` → rad), USER: yaratish `201`, kategoriyalar faqat faol va minimal, ro‘yxat/detal/tahrirlash/o‘chirish/kategoriya boshqaruvi `403`, anonim `401`, soft delete ro‘yxat va yig‘madan chiqaradi, yig‘ma filtrga mos, takroriy kategoriya nomi `409`, ishlatilgan kategoriyani o‘chirib bo‘lmaydi (FK), audit'da izoh matni yo‘q, migratsiya. Frontend + mock parity, real backend E2E.
  6. **Hujjatlar:** API §12, RBAC (§5 qatorlari, `GET /expense-categories` USER uchun), SECURITY, BUSINESS-RULES, REQUIREMENTS-MATRIX, README.
  - **Doiradan tashqari:** `/reports/expenses`, `finance-summary`, dashboard — Phase 12.
- **Natija (2026-10-23):** DoD bajarildi. Migratsiya `20261023100000_expenses_drop_status` (`expenses.status` va `expense_status` olib tashlandi, `category_id` NOT NULL saqlandi; dev bazada qo‘llashdan oldin xarajatlar soni 0 edi). Backend `modules/expenses`: `GET/POST/PATCH/DELETE /expenses` (filtrlar: sana, kategoriya, `createdBy`, izoh qidiruvi; yig‘ma butun filtr bo‘yicha; qisman PATCH; soft delete) va `GET/POST/PATCH/DELETE /expense-categories` (sotuvchiga faqat faol `{ id, name }`; `409 NAME_TAKEN`; ishlatilganini o‘chirib bo‘lmaydi — BR-31); kategoriya xarajat tranzaksiyasida `FOR SHARE`; kelajak sana `Clock` bo‘yicha `400`; yangi xato kodi `422 EXPENSE_CATEGORY_INACTIVE`, audit `EXPENSE_CATEGORY_DELETED`; audit'da izoh matni yo‘q. `listFilters.boolean()` umumiy filtrga ko‘chirildi (product-groups ham ishlatadi). Frontend: `/expenses`, `/expense-categories` → `BACKEND_READY_PREFIXES`; formada majburiy kategoriya; admin uchun "Kategoriyalar" oynasi; tahrirlash/o‘chirish — `expenses.manage`; sotuvchida faol kategoriya bo‘lmasa tushuntirish. Mock backend'ga tenglashtirildi (ruxsat tekshiruvlari yo‘q edi, PATCH qisman emas edi, summa normallashtirilmas edi). Testlar: `expenses.db-spec.ts` (17), migratsiya/constraint/relationships/seed testlari D-11/D-19 ga moslandi, unit `expenses.spec.ts` (3), shared `expenses.test.ts` (14), frontend `ExpensesPage.test.tsx` (6) + `mock-api.test.ts`, real backend E2E (24). Qarorlar: D-11, D-12, **D-19**. Qoldiq: xarajatlar hisoboti va moliyaviy xulosa — Phase 12.

### Phase 12 — Reports + Dashboard + Settings ✅
- **Bog‘liqlik:** Phase 8, 10, 11.
- **Natija:** 9 ta hisobot (`ReportDefinition` export arxitekturasi), `finance-summary` (tushunchalar ajratilgan), admin va USER dashboard'lari, sozlamalar. Performance: 1 mln sotuvli seed bilan `EXPLAIN ANALYZE`.
- **Testlar:** AC-17 (sana + mahsulot + user + sold/unsold kombinatsiyasi), AC-24 (dashboard = manba ma’lumotlari, Toshkent kun chegarasi).
- **REQ:** REQ-030, REQ-031, REQ-090…REQ-092, REQ-102, REQ-103, REQ-110, REQ-111, REQ-167.
- **Natija (2026-10-27):** DoD bajarildi. Shared `REPORT_DEFINITIONS` (ustunlar, filtrlar, `status` qiymatlari, yig‘ma, standart saralash, tannarx belgisi) — backend SQL, frontend mock va UI uchun yagona manba. Backend: `modules/reports` — 8 ta hisobot + `finance-summary` (raw SQL CTE; sahifa, yig‘ma va guruhlar bitta `REPEATABLE READ` tranzaksiyada; sana majburiy, ≤ 366 kun; tannarx ustunlari va yig‘malari faqat `products.read_cost`, yashirin ustun bo‘yicha saralash `400`; ombor tanlansa xarajat va sof foyda `null`); `modules/dashboard` — `summary`, `sales-trend` (7/14/30), `top-products`, sotuvchi uchun `my-summary` (OWN-08); `modules/settings` — 3 ta maydon, qisman PATCH, `FOR UPDATE`, audit faqat o‘zgarganlar. Frontend: hisobotlar sahifasi (standart — joriy oy, "Moliyaviy xulosa" bo‘limi, guruh/kategoriya/mijoz qidiruvi filtrlari, kategoriya bo‘yicha yig‘ma, ishlamaydigan "Eksport" tugmasi olib tashlandi), sotuvchi bosh sahifasi, sozlamalar 3 ta maydonga qisqartirildi (kassa va kirimda standart ombor — birinchi ruxsat etilgan faol ombor), `/reports`, `/dashboard`, `/settings` → `BACKEND_READY_PREFIXES`. Mock backend'ga tenglashtirildi (avval ruxsat tekshiruvi yo‘q edi). Topilgan va tuzatilgan xatolar: sotuvchi uchun Topbar kam qoldiq bildirishnomasi admin `dashboard/summary`ni so‘rab har daqiqada `403` olardi; xarajat o‘zgarganda hisobotlar keshi yangilanmasdi; 390px'da sana filtri sahifani kengaytirardi; 1 mln sotuvda 366 kunlik sotuvlar hisoboti 2,6 s edi (`count(*) OVER ()` + formatlangan vaqt) → 0,7 s. Migratsiya kerak bo‘lmadi. Testlar: `reports.db-spec.ts` (18), `dashboard.db-spec.ts` (6), `settings.db-spec.ts` (4), unit `reports.spec.ts` (11), shared `reports.test.ts`, frontend `ReportsPage.test.tsx` (3), `DashboardPage.test.tsx` (2), `SettingsPage.test.tsx` (1), `mock-api.test.ts` (+6), real backend brauzer E2E (39, vaqtinchalik DB), benchmark `bench:reports` (22, DATABASE §7.2). Qarorlar: D-20, D-21 — tasdiqlangan. Qoldiq: CSV/XLSX export (faqat arxitektura), API p95 yuklama testi (Phase 15), `pendingBackend` mexanizmi endi ishlatilmaydi (Phase 14 da olib tashlash mumkin).

### Phase 13 — Audit ✅
- **Bog‘liqlik:** Phase 5–12.
- **Natija:** `GET /audit-logs` (filtrlar, cursor pagination), audit qamrovini tekshirish (REQ-120 ro‘yxatidagi har bir amal), Sozlamalar ichidagi audit jurnali sahifasi.
- **Testlar:** AC-21 (har bir kritik mutatsiya audit yozadi), AC-22 (o‘zgartirib bo‘lmaydi).
- **REQ:** REQ-120…REQ-122, BR-24, BR-25.
- **Natija (2026-10-29):** DoD bajarildi. Backend: `GET /audit-logs` (filtrlar: sana — Toshkent kunlari, amal, obyekt turi, obyekt ID, user; keyset cursor `(occurred_at DESC, id DESC)` — OFFSET’siz, yangi yozuvlar sahifalarni siljitmaydi, buzilgan cursor `400`), `GET /audit-logs/:id` — `audit.read`; yozish/o‘zgartirish/o‘chirish endpointi yo‘q (`404`); javobda `userAgent` yo‘q. Shared: `auditLogQuerySchema`, cursor kodlash/ochish (backend va mock bitta funksiya), `AuditLogDto`/`AuditLogPage`. AC-21: `audit-coverage.db-spec.ts` mutatsiya endpointlarini Nest metadata’sidan topadi va 31 tasini audit jadvali bilan solishtiradi (yangi endpoint audit qarorisiz qolsa — test yiqiladi), har biri o‘z `request_id`si bilan to‘g‘ri amal, actor va obyektni yozishi, katalogdagi har bir `AuditAction` real oqimda paydo bo‘lishi va muvaffaqiyatsiz mutatsiya audit qoldirmasligi tekshiriladi. Frontend: Sozlamalar → "Audit jurnali" (faqat `audit.read`): filtrlar, jadval, "Yana yuklash", tafsilot oynasi (metadata kalit → qiymat, o‘zgarishlar "oldin → keyin", ID’lar nomga aylanadi — D-22). Mock ham audit yozadi (backend bilan bir xil amal nomlari va metadata, D-22). Test infratuzilmasi: `uniqueIp()` har fayl uchun alohida `10.B.x.y` blokda — ketma-ket fayllar Redis’dagi login rate limit hisoblagichlarini bo‘lishib `429` olardi. Migratsiya kerak bo‘lmadi. Testlar: `audit.db-spec.ts` (7), `audit-coverage.db-spec.ts` (4), shared `audit.test.ts` (3), frontend `metadata.test.ts` (3), `AuditLogView.test.tsx` (2), `mock-api.test.ts` (+3), real backend brauzer E2E (21, vaqtinchalik DB), `qa:ui` audit bo‘limi bilan (170). Qaror: D-22 — tasdiqlangan. Qoldiq: audit eksporti va saqlash muddati rejada yo‘q; mock’da IP, so‘rov ID, lockout va refresh reuse yo‘q; `pendingBackend` tozalash — Phase 14.

### Phase 14 — Frontend integration ✅
- **Bog‘liqlik:** Phase 5–13.
- **Natija:** barcha sahifalar yakuniy holatda; `DataTable` (server-side search, filter, pagination, sorting); `ConfirmDialog`; loading, empty, error va success holatlari hamma joyda; route-level code splitting (lazy) — boshlang‘ich bundle'ni kichraytirish; responsive tekshiruv; "hamma matn o‘zbekcha" auditi.
- **REQ:** REQ-150…REQ-155, BR-12, BR-33.
- **Natija (2026-10-29):** DoD bajarildi. Holatlar (REQ-154): bosh sahifa panellari (grafik, top mahsulotlar, oxirgi sotuvlar, kam qoldiq), POS (omborlar, mahsulotlar, mijoz tavsiyalari), `ProductCombobox` va forma tanlov ro‘yxatlari (`OptionsLoadError`) xato holati va "Qayta urinish"ga ega; bo‘sh holatlar qo‘shildi. Tuzatilgan xatolar: yuklash xatosi "bo‘sh"/"topilmadi"/"ombor biriktirilmagan" bo‘lib ko‘rinardi, kam qoldiq paneli xatoda "hammasi yetarli" derdi; omborlar sahifasi 100 tadan keyingisini jimgina kesardi → server-side pagination (REQ-155); guruhni arxivlash va kategoriyani nofaol qilish tasdiqsiz edi (BR-33). Bundle: zod faqat `@/shared/forms/zod` orqali (ESLint `no-restricted-imports`; o‘zbekcha error map shu modulda), `@divine/shared` `sideEffects: false`, recharts lazy — boshlang‘ich yuklama ~216 → ~190 KB gzip (`api-client` 42 → 13 KB). REQ-002/AC-25: ESLint qoidasi atributlar, `{'matn'}`, toast va forma xabarlarini ham tekshiradi (4 ta inline xabar lug‘atga ko‘chirildi); `qa:ui` va `qa:interactions` (kalendar, select, menyu, modal) inglizcha UI so‘zlarini qidiradi; `qa:ui` real backend uchun `QA_LOGIN`/`QA_PASSWORD_FILE`. `pendingBackend` olib tashlandi (biznes egasi roziligi bilan). Migratsiya kerak bo‘lmadi. Testlar: frontend 148 (yangi: `confirm-dialogs.test.tsx` 6, `ProductGroupsPage` 1, `zod.test.ts` 1, Dashboard +2, POS +2, Incoming +1, Warehouses +1, Expenses +1, Products +1; `test/fail-routes.ts`), shared 183, backend unit 171, `test:db` 353, `qa:ui` mock 170 holat + real backend (17 sahifa 1440/light, 390/dark), `qa:interactions` 39, real backend brauzer E2E (16, vaqtinchalik DB). Ochiq: SEC-01 (SECURITY §15.1) — backend audit siyosati, qaror kerak. Cheklov: filtr/forma tanlov ro‘yxatlari birinchi 100 ta yozuv. D-13, D-14, D-15 — tasdiqlanmagan (Phase 14 ga ta’sir qilmaydi).

### Phase 15 — Testing ✅
- **Natija:** TZ §19 dagi 13 ta acceptance test + 17 ta kritik ssenariy to‘liq avtomatlashtirilgan; Playwright E2E (asosiy oqimlar); coverage hisoboti (domain ≥ 90%, service ≥ 80%).
- **REQ:** REQ-172; REQ-167 (yuklama testi — REQUIREMENTS-MATRIX’da "P15 yuklama testi").
- **Natija (2026-10-30):** DoD bajarildi. [TESTING.md](TESTING.md): TZ §19 ning 13 ta testi va 17 ta kritik ssenariy → aniq test fayllari (§2–§3). Yangi: `rbac-matrix.db-spec.ts` (AC-18 — 74 ta endpoint Nest metadata'sidan × anonim/USER/ADMIN, kutilgan natija `ROLE_PERMISSIONS` dan), Playwright E2E (`frontend/e2e`, haqiqiy production backend + toza PG/Redis konteynerlari, 7 qadam), coverage konfiguratsiyalari va chegaralari (`pnpm coverage`; domain — shared, backend `common/*` + parol, frontend `features/*/lib`; service — `modules/*/*.service.ts`), domain unit testlari (xato statuslari, `access-context`, shared auth/settings validatsiyasi, Zod xato turlari, frontend decimal/format/fields). REQ-167: `bench:load` (1 mln sotuv, 32 virtual foydalanuvchi, qizdirish → normal → peak) — har bir endpoint p95 ≤ 212 ms, 0 xato; `bench:reports` — 22/22, eng sekini 1,25 s; natijalar `backend/test/bench/results/*.json` da (muhit, hajm, usul), `bench:compare` bilan solishtiriladi. Topilgan va tuzatilgan xatolar: tez ketma-ket skanerlashda kirim qatori ustidan yozilardi va kassada savatga faqat oxirgi mahsulot tushardi (E2E topdi); 1 mln sotuvda `GET /sales` p95 ~2,5 s → 0,18 s, `GET /products` ~1,6 s → 0,15 s (so‘rov shakli; migratsiya yo‘q). Testlar: unit 193 + 177 + 162, `test:db` 357, coverage to‘plami 534, E2E 7, `qa:ui` (muammo yo‘q), `qa:interactions` 39, `bench:reports` 22, `bench:load` 2. SEC-01 Phase 15 rejasiga kirmaydi → Phase 16 majburiy bandi. D-13/D-14/D-15 Phase 15 ga ta’sir qilmaydi — qoldirildi. Ma’lum chegara: kassa katalogining `sold:desc` saralashi ko‘p yillik tarixli omborda o‘lchanmagan (TESTING §5.2).

### Phase 16 — Security review ✅
- **Natija:** [SECURITY.md §18](SECURITY.md#18-phase-16-xavfsizlik-checklisti) checklist'i, `pnpm audit`, RBAC fuzz, log grep testi, header tekshiruvi, topilgan muammolarni tuzatish.
- **Majburiy masala — SEC-01** ([SECURITY §15.1](SECURITY.md#151-sec-01-login-maydoniga-yozilgan-parol-auditda-qolishi-mumkin-edi--yopildi-phase-16)): login maydoniga yozilgan parol noma’lum login sifatida auditda (va Redis kalitida) ochiq qolishi mumkin edi. Talab: parol hech qachon auditga ochiq yozilmaydi; yopilish sharti — `auth.db-spec.ts` testi. **Yopildi.**
- **Natija (2026-10-30):** DoD bajarildi; batafsil — [SECURITY §17 "Phase 16"](SECURITY.md#phase-16da-tekshirilgan-va-tuzatilgan-xavfsizlik-choralari), [§18](SECURITY.md#18-phase-16-xavfsizlik-checklisti), [§19](SECURITY.md#19-phase-16-natijalari-va-qolgan-xavflar). **SEC-01:** noma’lum login — parol shaklida (6 raqam) faqat maska va uzunlik, boshqasi — HMAC barmoq izi (kalit `PASSWORD_PEPPER`dan HKDF bilan hosil qilinadi); Redis kaliti ham iz bilan, xom loginli eski kalitlar ishga tushishda o‘chiriladi; eski audit qatorlari DB'da o‘zgarmaydi, API ularni xuddi shu qoida bilan ko‘rsatadi. **Topilgan va tuzatilgan:** production web image `VITE_API_MODE`siz — brauzer ichidagi mock API bilan yig‘ilardi (Dockerfile + build guard + CI); biznes javoblarida `Cache-Control: no-store` yo‘q edi; `pnpm audit --prod` — 3 high, 2 moderate, 2 low → 0 (zod, body-parser, qs yangilandi; multer va fast-uri — `overrides`). **Yangi testlar:** `security-leaks.db-spec.ts` (log/audit/Redis grep, 42 ta GET javobi skaneri), `security-fuzz.db-spec.ts` (RBAC fuzz, soxta JWT, input fuzz ~1 200 so‘rov), `security-hardening.db-spec.ts` (prod header'lari + HSTS, `no-store`, cookie, refresh limit, enumeration vaqti), `auth.db-spec.ts` "SEC-01" (4), `login-fingerprint.spec.ts` (5), `build-api-mode.test.ts` (2), Playwright xavfsizlik qadami. Testlar: unit 193 + 182 + 164, `test:db` 379, E2E 8, `qa:ui` (muammo yo‘q), `qa:interactions` 39; format, lint, typecheck, build toza. **Migratsiya yo‘q.** Docker: joriy kod bilan yig‘ilgan image'lar to‘liq stek sifatida read-only, `cap-drop ALL`, non-root holda tekshirildi; web image haqiqiy API bilan ishlaydi. Backup va tiklash sinovi — Phase 17. Qolgan xavflar — SECURITY §19. D-13/D-14/D-15 Phase 16 ga ta’sir qilmaydi — tasdiqlanmagan holda qoladi.

### Phase 17 — Production preparation
- **Natija:** prod compose/deploy konfiguratsiyasi, TLS terminator (HSTS), migratsiya qadami (`--target migrate`), DB rollari, backup (pg_dump + WAL) va tiklash sinovi, secret store, monitoring va alerting (health, xato darajasi, reconciliation), runbook'lar (deploy, rollback, pepper rotation, insident), README yakuniy.
- **REQ:** REQ-171.

---

## 4. Har bir phase uchun ish tartibi

1. **Oldin:** nima qilinishi, qaysi fayllar o‘zgarishi va bog‘liqliklar e’lon qilinadi.
2. **Implementatsiya:** soxta API, soxta DB, qotirilgan biznes ma’lumotlari yoki kritik joyda TODO **yo‘q**.
3. **Testlar:** unit (domain) + integration (real PG) + API (e2e) — kritik ssenariylar albatta.
4. **Oxirida:** yaratilgan fayllar, test natijalari (haqiqiy chiqish), REQ → implementatsiya jadvali, qolgan ishlar, ogohlantirishlar.
5. **Regressiya:** `pnpm ci` to‘liq o‘tishi shart; mavjud funksionallik buzilmaydi; keraksiz refaktoring qilinmaydi.
6. **Xato topilsa:** yashirilmaydi — muammo, sabab, yechim va tuzatish ko‘rsatiladi.

## 5. Definition of Done (umumiy)

- [ ] Kod TypeScript strict, lint va format toza
- [ ] Biznes logika service/domain'da (controller va komponentda emas)
- [ ] Barcha input serverda Zod bilan validatsiya qilinadi; xatolar o‘zbekcha
- [ ] Permission va ownership backendda tekshiriladi
- [ ] Kritik mutatsiyalar tranzaksiyada va audit bilan
- [ ] Testlar yozilgan va o‘tadi (`pnpm ci`)
- [ ] UI: loading, empty, error, success holatlari; destructive amalda tasdiqlash; barcha matn `uz.ts`da
- [ ] OpenAPI va `docs/API.md` mos
- [ ] REQUIREMENTS-MATRIX yangilangan

## 6. Git konvensiyalari

- Branch: `phase-<N>-<qisqa-nom>` (masalan, `phase-2-database`)
- Commit: Conventional Commits (`feat(sales): …`, `fix(inventory): …`, `docs: …`, `chore: …`)
- `main`ga faqat CI o‘tgandan keyin merge qilinadi
