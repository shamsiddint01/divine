# Divine.uz — testlash (Phase 15)

> Manba: TZ §19 (13 ta acceptance test), dastlabki topshiriqdagi 17 ta kritik ssenariy, REQ-167, REQ-172.
> AC raqamlari — [REQUIREMENTS-MATRIX §5](REQUIREMENTS-MATRIX.md#5-acceptance-criteria--req).

## 1. Test to‘plamlari va buyruqlar

| Buyruq | Nima | Muhit |
|---|---|---|
| `pnpm test` | Unit: shared (validatsiya, ruxsatlar, hisobot ta’riflari), backend (domain, service mantiqi, e2e — in-process Nest), frontend (komponent va sahifa testlari — to‘liq ilova + mock API, jsdom) | Docker'siz |
| `pnpm test:db` | Integration: real PostgreSQL 18 + Redis 8 (Testcontainers) — constraint, trigger, huquqlar, API (supertest), concurrency, RBAC matritsasi, audit qamrovi | Docker |
| `pnpm coverage` | Coverage hisoboti va chegaralar (§4): shared → frontend → backend (unit + e2e + DB birga), ketma-ket | Docker |
| `pnpm e2e` | Playwright: asosiy oqimlar haqiqiy backend va toza DB bilan (§6) | Docker, Google Chrome |
| `pnpm --filter @divine/backend bench:reports` | Hisobotlar, 1 mln sotuv (< 2 s) | Docker, ~4 daq |
| `pnpm --filter @divine/backend bench:load` | API yuklama testi, 1 mln sotuv (p95 < 300 ms) | Docker, ~4 daq |
| `pnpm --filter @divine/backend bench:compare [reports\|load \| eski.json yangi.json]` | Benchmark natijalarini solishtirish (§5.3) | — |
| `pnpm --filter @divine/frontend qa:ui` / `qa:interactions` | Real brauzer QA: 17 sahifa × 5 kenglik × 2 mavzu; 39 ta interaktiv ssenariy | ishlayotgan preview |

`coverage`, `e2e` va `bench:*` doimiy `test`/`test:db` to‘plamidan alohida: ular Docker va bir necha daqiqa talab qiladi. `test:db`, `coverage` va turbo `typecheck`/`lint` (shared `dist`ni qayta quradi) bir vaqtda ishga tushirilmaydi.

## 2. TZ §19 acceptance testlari → avtomatik testlar

| # | TZ §19 | AC | Avtomatik test |
|---|---|---|---|
| 1 | User yaratish: to‘g‘ri/noto‘g‘ri login formatlari, takroriy login | AC-01, AC-02, AC-03 | `users.db-spec.ts` "POST /users — yaratish", "login formati…", "takroriy login (katta-kichik harf farqisiz) → 409"; shared `users.test.ts`, `primitives.test.ts`; `constraints.db-spec.ts` (DB CHECK); E2E "sotuvchi yaratadi" |
| 2 | Parol — aynan 6 raqam | AC-04 | `users.db-spec.ts` (server generatsiyasi, DB'da faqat argon2id hash); backend unit `password-hasher.spec.ts` "AC-04: 10 000 ta generatsiya"; E2E — dialogdagi parol `/^\d{6}$/`, yopilgach qayta ko‘rinmaydi |
| 3 | Shtrix-kod unikalligi | AC-06 | `products.db-spec.ts` "takroriy → 409 BARCODE_TAKEN", "5 ta parallel so‘rov → aynan bittasi 201", "arxivlanganning shtrix-kodi qayta ishlatilmaydi"; E2E — takroriy shtrix-kod formada xato |
| 4 | Bir nechta mahsulotli kirim — dinamik jami | AC-07 | `incoming.db-spec.ts` "TZ misoli 50+30+100+20 → 200"; `inventory.db-spec.ts`; frontend `IncomingEditorPage.test.tsx`, `totals.test.ts`; E2E (50 + 30 = 80) |
| 5 | Kirim qatori miqdori o‘zgarsa — jami qayta hisoblanadi | AC-08 | `incoming.db-spec.ts` "tahrirlash: … totallar qayta hisoblanadi"; `IncomingEditorPage.test.tsx`; E2E (80 → 90) |
| 6 | Kirim tasdiqlansa — ombor qoldig‘i oshadi | AC-09, AC-10 | `incoming.db-spec.ts` "tasdiqlash" (qoldiq, ledger, takroriy → 409, 5 ta parallel, atomiklik); E2E — ombor kartochkasida 90 |
| 7 | Qoldiqdan ko‘p sotish rad etiladi | AC-12, AC-13 | `sales.db-spec.ts` "AC-12", "AC-13: 20 ta parallel → aniq 10"; `inventory.db-spec.ts`, `warehouses.db-spec.ts` (parallel); E2E — API 409, qoldiq o‘zgarmaydi |
| 8 | To‘g‘ri sotuv: qoldiq ↓, total, tarix | AC-11, AC-14 | `sales.db-spec.ts` "to‘g‘ri sotuv…", idempotentlik; `PosView.test.tsx`; E2E — chek, qoldiq 60 → 59, tarixda mijoz |
| 9 | Mijoz ismi majburiy, telefon ixtiyoriy | AC-15, AC-16 | `sales.db-spec.ts` "AC-15/16"; `customers.db-spec.ts`; `PosView.test.tsx`; E2E — ismsiz rad, telefonsiz sotuv |
| 10 | Sana + mahsulot + user + sotilgan/sotilmagan filtrlari birga | AC-17 | `reports.db-spec.ts` "sana + mahsulot + user + sotilgan/sotilmagan kombinatsiyasi", "mahsulot, user va mijoz filtrlari birgalikda"; `ProductsPage.test.tsx` (server-side jadval); E2E — hisobot: user + mahsulot filtri |
| 11 | Ruxsatsiz User admin amallariga kira olmaydi | AC-18, AC-19, AC-20 | **`rbac-matrix.db-spec.ts`** (Phase 15): 74 ta endpoint × {anonim, USER, ADMIN}; har bir modul DB testidagi ruxsat bloklari; E2E — sotuvchi menyusi 4 bo‘lim, `/users` → "Ruxsat yo‘q", admin API → 403 |
| 12 | Kritik amallar audit yozadi | AC-21, AC-22 | `audit-coverage.db-spec.ts` (31 ta mutatsiya endpointi Nest metadata'sidan), `audit.db-spec.ts`, `immutability.db-spec.ts`; E2E — audit jurnalida "Sotuv qilindi", "Kirim tasdiqlandi", "User yaratildi" |
| 13 | Barcha UI matnlari o‘zbekcha | AC-25 | ESLint qoidasi (REQ-002); `uz.test.ts`, shared `error-map.test.ts` (har bir Zod xato turi); `qa:ui` (170 holat), `qa:interactions` (kalendar, ro‘yxat, menyu, modal); E2E — butun oqim o‘zbekcha matnlar orqali |

## 3. 17 ta kritik ssenariy → avtomatik testlar

| # | Ssenariy | Unit | Integration (real PG) / API | E2E |
|---|---|---|---|---|
| 1 | User creation | `UsersPage.test.tsx`, backend `users.service.spec.ts` | `users.db-spec.ts` | ✅ |
| 2 | Invalid login | shared `primitives.test.ts`, `auth.test.ts` | `users.db-spec.ts`, `auth.db-spec.ts`, `constraints.db-spec.ts` | ✅ (bo‘sh forma, noto‘g‘ri parol) |
| 3 | Duplicate login | — | `users.db-spec.ts` (409, katta-kichik harf) | — |
| 4 | Password generation | backend `password-hasher.spec.ts` (10 000 ta) | `users.db-spec.ts`, `auth.db-spec.ts` (DB'da faqat hash, auditda yo‘q) | ✅ |
| 5 | Product creation | `ProductsPage.test.tsx` | `products.db-spec.ts` (+ audit, AC-05) | ✅ |
| 6 | Duplicate barcode | shared `catalog.test.ts` | `products.db-spec.ts` (5 parallel) | ✅ |
| 7 | Incoming | `IncomingEditorPage.test.tsx` | `incoming.db-spec.ts` | ✅ |
| 8 | Incoming total calculation | `totals.test.ts` | `incoming.db-spec.ts` (server totallari, client totali → 400) | ✅ |
| 9 | Stock increase | — | `incoming.db-spec.ts`, `inventory.db-spec.ts` (ledger invariantlari) | ✅ |
| 10 | Sale | `cart.test.ts`, `PosView.test.tsx` | `sales.db-spec.ts` | ✅ |
| 11 | Stock decrease | — | `sales.db-spec.ts`, `inventory.db-spec.ts` | ✅ |
| 12 | Overselling prevention | `cart.test.ts` (UX chegarasi) | `sales.db-spec.ts` AC-12, `inventory.db-spec.ts` (CHECK) | ✅ (API 409) |
| 13 | Customer name validation | `PosView.test.tsx` | `sales.db-spec.ts` AC-15, `customers.db-spec.ts` | ✅ |
| 14 | RBAC | backend unit `access-context.spec.ts`, shared `permissions.test.ts` | **`rbac-matrix.db-spec.ts`**, `auth.db-spec.ts` "RBAC", har bir modulda ruxsat bloklari | ✅ |
| 15 | Audit | frontend `metadata.test.ts` | `audit-coverage.db-spec.ts`, `audit.db-spec.ts`, `immutability.db-spec.ts` | ✅ |
| 16 | Combined filters | `ProductsPage.test.tsx` (server-side) | `reports.db-spec.ts` AC-17, `audit.db-spec.ts` (AND filtrlar), har bir ro‘yxat | ✅ |
| 17 | Concurrent stock operations | — | `sales.db-spec.ts` AC-13 (20 → 10), `inventory.db-spec.ts`, `warehouses.db-spec.ts` (10 → 5, holat o‘zgarishi kutadi), `incoming.db-spec.ts` (5 parallel tasdiq), idempotentlik (5 parallel) | — (DB darajasida; yuklama testi §5.2 — yuklama ostida ledger = qoldiq) |

## 4. Coverage (`pnpm coverage`)

Chegaralar (DEVELOPMENT-PLAN, Phase 15): **domain ≥ 90%, service ≥ 80%** — statements, branches, functions va lines (to‘rttasi ham), har bir guruh yig‘indisi bo‘yicha. Chegaradan past bo‘lsa buyruq yiqiladi. Hisobot: `*/coverage/index.html`.

| Guruh | Fayllar | O‘lchov |
|---|---|---|
| domain — shared | `shared/src/**` (validatsiya, ruxsatlar, hisobot ta’riflari, xato kodlari, error map) | shared unit |
| domain — backend | `common/time`, `common/query/list-query.ts`, `common/errors/**`, `common/auth/access-context.ts`, `modules/auth/password/**` (framework va I/O'siz qoidalar) | backend unit + e2e + DB |
| domain — frontend | `features/*/lib/*.ts` (savat, kirim jami, savdo o‘zgarishi, audit metadata, xavfsiz redirect), `shared/lib/{decimal,format}.ts`, `shared/forms/fields.ts` | frontend unit |
| service | `backend/src/modules/*/*.service.ts` | backend unit + e2e + DB (service'lar asosan real PG testlari orqali) |

ARCHITECTURE §4 dagi `modules/*/domain/` papkasi alohida yaratilmagan: sof qoidalar shared paketda (client va server uchun bitta manba) va yuqoridagi `common/*` fayllarida.

**Natija (2026-10-30)** — barcha chegaralar bajarildi (statements / branches / functions / lines):

| Guruh | Testlar | Natija |
|---|---|---|
| domain — shared (`src/**`) | 193 | 98,67 / 96,49 / 98,78 / 99,25 |
| domain — backend (9 fayl) | 534 (unit + e2e + DB) | 99,41 / 96,91 / 100 / 100 |
| service — backend (16 fayl) | ↑ o‘sha | 98,63 / 90,14 / 100 / 99,88 (eng pasti: `token.service.ts` branches 75 — guruh yig‘indisi bo‘yicha o‘tadi) |
| domain — frontend (8 fayl) | 162 | 98,22 / 93,10 / 100 / 100 |

Ma’lumot uchun: frontend’ning umumiy qamrovi (sahifa va komponentlar bilan) — 76,35 / 67,42 / 73,24 / 78,15; UI qatlami uchun chegara rejada belgilanmagan, u komponent testlari, `qa:*` va Playwright bilan tekshiriladi.

## 5. Performance (REQ-167, A-L11)

### 5.1. Hisobotlar — 1 mln sotuv, < 2 s (`bench:reports`)

Usul va Phase 12 natijalari — [DATABASE §7.2](DATABASE.md#72-hisobotlar-performancei--1-mln-sotuv-phase-12-req-167-d-21-4). Phase 15 dan boshlab har ishga tushirish `backend/test/bench/results/reports-<vaqt>.json` ga yoziladi (muhit, ma’lumot hajmi, usul, raqamlar). Phase 12 baseline'i — `reports-2026-10-27T00-00-00-000Z.json` (hujjatdagi jadvaldan ko‘chirilgan; o‘sha paytda xom fayl saqlanmagan — fayldagi `source` maydoni).

**Phase 15 o‘lchovi** (`reports-2026-10-30T09-18-46-201Z.json`; muhit — §5.2 dagi bilan bir xil): 22/22 tekshiruv o‘tdi, eng sekini `productSales — 366 kun` 1 248 ms (SQL) / 1 028 ms (HTTP) → **PASS** (< 2000 ms). `bench:compare reports` Phase 12 baseline’iga nisbatan: yirik so‘rovlarda farq ±5% ichida (regressiya yo‘q); `products — oy` SQL −35%, `sales — 366 kun, ombor + mahsulot` −67%; bir necha 3–22 ms lik so‘rovlarda +50–80% — millisekund shovqini. Muhit ogohlantirishi: baseline’da CPU/OS/Node qayd etilmagan (hujjatdan ko‘chirilgan), RAM 14 → 15 GB (yaxlitlash) — mashina o‘sha.

### 5.2. API yuklama testi — p95 < 300 ms (`bench:load`)

`pnpm --filter @divine/backend bench:load` — `backend/test/bench/load.bench-spec.ts` (CI’siz, ~4 daqiqa). Natija `test/bench/results/load-<vaqt>.json` ga yoziladi.

**Muhit.** Intel Core i5-13420H (12 oqim), 15 GB RAM, Linux 7.1.2, Node v24.18.0; PostgreSQL 18.6 (`postgres:18-alpine`, Testcontainers, standart sozlamalar: `shared_buffers = 128MB`), Redis 8 (`redis:8-alpine`). Server — production build (swc), `NODE_ENV=production`, bitta Node jarayoni, `LOG_LEVEL=info`; yuk generatori shu mashinada (ya’ni server va DB bilan CPU ni bo‘lishadi — natija pessimistik). O‘lchov `systemd-inhibit` ostida (uyqu rejimi taqiqlangan).

**Ma’lumot hajmi.** Hisobotlar benchmark’i bilan bir xil seed (`support/seed-1m.ts`): 1 000 000 sotuv, 2 000 000 sotuv qatori va ledger harakati, 100 000 mijoz, 200 mahsulot, 5 ombor, 30 sotuvchi, 3 650 kirim, 20 000 xarajat, 365 kun. Yozuvlar (`POST /sales`) alohida «Yuklama ombori»ga — API orqali yaratilgan 20 mahsulot va tasdiqlangan kirim (har biri 100 000), ledger zanjiri trigger’lar bilan to‘g‘ri.

**Usul.** 32 virtual foydalanuvchi (30 sotuvchi + 2 admin), har biri o‘z tokeni va IP’si bilan yopiq siklda: qizdirish 15 s (pauza 250 ms, o‘lchanmaydi) → normal 60 s (pauza 250 ms) → peak 60 s (pauza 120 ms); pauza ×0,5–1,5 tasodifiy. Sotuvchi operatsiyalari vaznli: kassa katalogi (`sort=sold:desc`), nom/shtrix-kod qidiruvi, `products/lookup`, mijoz qidiruvi, `POST /sales`, o‘z sotuvlari, `my-summary`, `auth/me`; admin — dashboard, barcha sotuvlar, mahsulotlar, omborlar, qoldiq, kirim, xarajatlar, userlar, audit, mijozlar. Kechikish mijozda o‘lchanadi (so‘rov boshidan javob tanasi oxirigacha), percentil — nearest-rank. Mezon: **har bir** endpoint’ning p95 < 300 ms va 2xx bo‘lmagan javob yo‘q (`expect.soft` — barcha buzilishlar birdaniga ko‘rinadi). Alohida test: yuklamadan keyin «Yuklama ombori» uchun Σ harakat = qoldiq, qoldiq manfiy emas, sotuvlar soni mos.

**Natijalar (p95, ms).**

| Endpoint | 1-o‘lchov normal / peak | Yakuniy normal / peak |
|---|---|---|
| JAMI | 292 / 351 | 117 / 139 |
| `GET /sales` (admin, hammasi) | 2 468 / 2 571 | 160 / 179 |
| `GET /products` (admin) | 1 673 / 1 600 | 136 / 149 |
| `GET /sales` (sotuvchi, o‘z tarixi) | 392 / 475 | 191 / **212** |
| `GET /dashboard/summary` | 318 / 370 | 172 / 196 |
| `POST /sales` | 260 / 367 | 89 / 128 |
| `GET /products` (kassa katalogi) | 159 / 252 | 39 / 65 |
| `GET /customers?search` | 193 / 205 | 110 / 54 |
| qolgan 11 endpoint | ≤ 315 | ≤ 125 |

Yakuniy o‘lchov (`load-2026-10-30T09-15-53-979Z.json`): normal 6 741 so‘rov (112 RPS), peak 11 654 so‘rov (194 RPS), **0 xato**, eng sekin p95 — 212 ms → **PASS**. Ma’lumot yaxlitligi testi — PASS.

**Topilgan va tuzatilgan muammolar** (1-o‘lchov FAIL edi):
1. `GET /sales` — `count(*) OVER ()` korrelyatsiyalangan subquery bilan birga LIMIT’dan oldin 1 mln qatorni to‘liq hisoblatardi → sahifa va son alohida so‘rov (son `summary` dan).
2. `GET /products` — qoldiq/kirim/sotilgan yig‘malari barcha mahsulotlar va barcha sotuv qatorlari bo‘yicha hisoblanardi → yig‘ma bo‘yicha saralash/filtr bo‘lmasa, avval sahifa tanlanadi, yig‘malar faqat sahifa mahsulotlari uchun `= ANY(ARRAY(...))` bilan (index bo‘yicha; `IN (SELECT ...)` 2 mln qatorni skanerlardi), ombor doirasi bo‘lmasa `sales` bilan JOIN qilinmaydi.

`load-2026-10-30T08-53-26-861Z.json` — oraliq o‘lchov: peak bosqichi yaroqsiz (uyqu rejimi gumoni, faylda `note`); u faqat tarix uchun saqlangan.

**Ma’lum chegara (Phase 15).** Sotuvchining kassa katalogi `sort=sold:desc` yig‘ma bo‘yicha saralangani uchun ombordagi barcha sotuv qatorlarini yig‘adi. Yuklama omborida (20 mahsulot) bu tez; ko‘p yillik tarixli omborda o‘lchanmagan edi → Phase 17 da o‘lchandi va tuzatildi (pastda).

#### Phase 17 o‘lchovlari

**Ssenariy o‘zgarishi.** Kassa katalogi ikki ssenariyga bo‘lindi (Phase 17 talabi): «Yuklama ombori» (vazn 20, avvalgidek) va **«tarixli ombor»** (vazn 10) — seed'dagi 1 mln sotuvli omborlardan biri (`seedSales1M(...).sampleWarehouse`, bir yillik tarix); sotuvchilar ikkala omborga biriktirilgan. Seed trigger'larni o‘chirib yozgani uchun `warehouse_sales_totals` seed oxirida ledger'dan to‘ldiriladi. Mezon va boshqa vaznlar o‘zgarmadi.

**Muhit.** Mashina, OS, Node, PostgreSQL, Redis, seed — yuqoridagi bilan bir xil. Farqi — quvvat: Phase 17 o‘lchovlari paytida noutbuk **zaryadga ulanmagan**. Har bir faylda `note` maydoni (`bench:compare` uni ogohlantirish sifatida chiqaradi).

| Fayl | Holat | Eng sekin p95 | Xato | Natija |
|---|---|---|---|---|
| `load-2026-10-30T11-56-59-964Z.json` | tuzatishdan oldin; quvvat holati qayd etilmagan | 1 657 ms (kassa, tarixli ombor) | 435 (434 — 503) | FAIL |
| `load-2026-10-30T15-11-43-966Z.json` | tuzatishdan keyin; batareya, `balanced` (`balance_power`, CPU cheklangan) | 325 ms (peak `dashboard/summary`) | 0 | FAIL |
| `load-2026-10-30T16-41-08-305Z.json` | **yakuniy**; batareya, `powerprofilesctl set performance` (o‘lchovdan keyin `balanced`ga qaytarildi), `systemd-inhibit` | 212 ms (peak `dashboard/summary`) | 0 | **PASS** |

**Yakuniy natija (p95, ms, normal / peak)** va Phase 15 bilan solishtirish (`bench:compare load-2026-10-30T09-15-53-979Z.json load-2026-10-30T16-41-08-305Z.json`):

| Endpoint | Phase 15 | Phase 17 yakuniy |
|---|---|---|
| JAMI | 117 / 139 | 65 / 128 |
| `GET /products` (kassa, tarixli ombor) | — | **22 / 61** |
| `GET /products` (kassa katalogi) | 39 / 65 | 18 / 55 |
| `GET /products` (admin) | 136 / 149 | 19 / 59 |
| `GET /sales` (admin, hammasi) | 160 / 179 | 129 / 199 |
| `GET /sales` (sotuvchi, o‘z tarixi) | 191 / 212 | 109 / 204 |
| `GET /dashboard/summary` | 172 / 196 | 111 / 212 |
| `GET /dashboard/my-summary` | 32 / 55 | 16 / 50 |
| `POST /sales` | 89 / 128 | 54 / 133 |
| `GET /products/lookup` | 37 / 59 | 16 / 53 |
| qolgan 9 endpoint | ≤ 125 | ≤ 119 |

Normal 7 230 so‘rov (121 RPS), peak 12 123 so‘rov (202 RPS), **0 xato**, barcha 19 endpoint p95 < 300 ms; ma’lumot yaxlitligi testi — PASS. Normal bosqichda deyarli hammasi tezroq (yig‘ma jadval va `performance` profili ta’siri bir-biridan ajratib o‘lchanmagan); peak'da sotuvlar ro‘yxati va dashboard Phase 15 bilan bir xil darajada (±10%) — o‘zgarmagan so‘rovlar, farq shovqin chegarasida.

**Topilgan va tuzatilgan:** tarixli omborda kassa katalogi p95 ~1,5–1,7 s va 434 ta 503 (sotilgan miqdor har so‘rovda 2 mln harakatdan yig‘ilardi, DB pool to‘yinardi) → trigger bilan yuritiladigan `warehouse_sales_totals` (DATABASE §4.10a; migratsiya `20261030100000_warehouse_sales_totals`) → 22 / 61 ms. Testlar: `inventory.db-spec.ts` (har bir sotuv ledger `SALE` harakati orqali yig‘mani oshiradi va `sale_items` yig‘indisiga teng, `reconcile_sales_totals` bo‘sh; ilova roli yig‘mani to‘g‘ridan-to‘g‘ri o‘zgartira olmaydi), `migrations.db-spec.ts` (derived jadval — faqat SELECT).

**Ochiq qolgan:** batareya + `balanced` rejimida `GET /dashboard/summary` peak p95 325 ms (FAIL) — zaxira kichik. Sababi va arxitektura qarori — SECURITY §20.5. Production serverda o‘lchanmagan.

### 5.3. Natijalarni solishtirish

`pnpm --filter @divine/backend bench:compare reports` — shu turdagi oxirgi ikki natija; yoki ikkita fayl yo‘li. Har bir o‘lchov uchun eski, yangi va farq (%); muhit yoki ma’lumot hajmi farq qilsa — ogohlantirish (raqamlarni to‘g‘ridan-to‘g‘ri solishtirib bo‘lmaydi).

## 6. Playwright E2E (`pnpm e2e`)

`frontend/e2e/` — haqiqiy production backend (swc build, `NODE_ENV=production`) va har safar toza PostgreSQL 18 + Redis 8 konteynerlari (`global-setup.ts`: migratsiyalar, seed, bootstrap ADMIN — parol faqat jarayon xotirasida, diskka yozilmaydi), `VITE_API_MODE=http` bilan yig‘ilgan frontend (`vite preview`), tizimdagi Google Chrome (`channel: 'chrome'`), `uz-UZ`, `Asia/Tashkent`. Build natijalari `node_modules/.cache/` ostida — ishlayotgan dev serverlar va `dist` papkalariga tegmaydi; konteynerlar `--rm` va teardown’da o‘chiriladi.

`main-flows.spec.ts` — ketma-ket 8 qadam (Phase 16 da xavfsizlik qadami qo‘shildi, §7): login (bo‘sh forma, noto‘g‘ri parol) → ombor, guruh, 2 mahsulot, takroriy shtrix-kod xatosi → sotuvchi yaratish (6 raqamli parol bir marta) → kirim 50 + 30 = 80 → 90, tasdiqlash, ombor qoldig‘i → sotuvchi: 4 bo‘limli menyu, ismsiz sotuv rad, sotuv, qoldiq 60 → 59, `/users` ruxsat yo‘q → API: qoldiqdan ko‘p sotuv 409, sotuvchiga admin API 403 → admin: sotuvlar tarixi, hisobot filtrlari, audit jurnali. Natija (2026-10-30): **7/7**, ~31 s.

E2E topgan xato: kirimda shtrix-kodlar ketma-ket tez skanerlansa (skaner har biridan keyin Enter yuboradi), ikkinchi skan birinchisining javobidan oldin eskirgan forma holatini o‘qib, qatorni ustidan yozardi (50 → 1). Kassada ham xuddi shunday (savatga faqat oxirgi mahsulot tushardi). Tuzatish — skanlar navbati (ketma-ket qayta ishlanadi) va joriy holatni ref orqali o‘qish; regressiya testlari: `IncomingEditorPage.test.tsx`, `PosView.test.tsx` (sun’iy kechikish bilan; eski kodda yiqilishi tekshirildi).

## 7. Xavfsizlik testlari (Phase 16)

To‘liq xarita (har bir talab → test) — [SECURITY §17 "Phase 16"](SECURITY.md#phase-16da-tekshirilgan-va-tuzatilgan-xavfsizlik-choralari), checklist — §18, natijalar va qolgan xavflar — §19. Barchasi `pnpm test:db` va `pnpm e2e` tarkibida (alohida buyruq yo‘q).

| Fayl | Nima |
|---|---|
| `backend/test/db/auth.db-spec.ts` "SEC-01" (4) | Login maydoniga parol: audit, Redis va API'da xom qiymat yo‘q; iz bilan bog‘lanish; eski yozuvlar DB'da o‘zgarmaydi; eski Redis kalitlari o‘chiriladi |
| `backend/test/db/security-leaks.db-spec.ts` (4) | To‘liq oqim (yaratish, tiklash, refresh reuse, logout, xato login) → log (`trace`), audit va Redis'da 18 xil maxfiy qiymat grep; 42 ta GET javobi skaneri (ADMIN/USER, haqiqiy ID) |
| `backend/test/db/security-fuzz.db-spec.ts` (7) | RBAC fuzz (yo‘l variantlari, HEAD, method-override, soxta JWT, `role: ADMIN` yozilgan to‘g‘ri imzoli token); input fuzz (har bir yozuvchi endpoint × 12 body, path va query) — ~1 200 so‘rov, tokenlar rate limit'ga tushmasligi uchun aylantiriladi |
| `backend/test/db/security-hardening.db-spec.ts` (7) | Production header'lari (HSTS), `no-store`, Swagger 404, cookie atributlari, refresh 30/daq, enumeration (javob va vaqt) |
| `backend/test/unit/auth/login-fingerprint.spec.ts` (5) | Maska/iz qoidasi, kalit ajratilganligi (HKDF), deterministiklik |
| `frontend/src/shared/lib/build-api-mode.test.ts` (2) | Production build API rejimisiz yig‘ilmaydi |
| `frontend/e2e/main-flows.spec.ts` — xavfsizlik qadami | Sotuvchi: 9 ta admin sahifasi "Ruxsat yo‘q"; devtools'dan 9 ta admin so‘rovi → 403; token brauzer xotirasida emas; kelgan narxi yo‘q |

`backend/test/db/support/routes.ts` — endpointlar ro‘yxati Nest metadata'sidan (RBAC matritsasi, fuzz va skaner umumiy manbasi): yangi endpoint avtomatik qamraladi.

