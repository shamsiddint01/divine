# Divine.uz — Requirements traceability matrix

> TZ talabi → modul → rejalashtirilgan implementatsiya → test → status.
> **Statuslar:** `PLANNED` → `IMPLEMENTED` (kod tayyor) → `TESTED` (avtomatik testlar o‘tadi). Har bir phase oxirida yangilanadi.
> ID raqamlash guruhlari (001, 010, 020, …) birinchi tahlildagi bilan bir xil. Bo‘sh raqamlar ataylab qoldirilgan.
> **Oxirgi yangilanish:** Phase 13 — Audit (2026-10-28).

"Phase 1 hissasi" — Phase 1'da tayyorlangan, lekin talabni hali to‘liq yopmaydigan qism (status `PLANNED` qoladi).

---

## 1. Funksional talablar

| REQ ID | Talab | Modul | Rejalashtirilgan implementatsiya | Test | Status |
|---|---|---|---|---|---|
| REQ-001 | Retail/market uchun web ERP | Hammasi | Monorepo: NestJS API + React SPA (P1–P17) | AC-01…AC-27 | PLANNED |
| REQ-002 | Barcha user-facing matn o‘zbek lotinida (UI, validatsiya, xato, bildirishnoma, hisobot, empty state) | web, shared | `uz.ts` lug‘ati, `ERROR_MESSAGES_UZ`, `VALIDATION_MESSAGES_UZ`, o‘zbekcha Zod error map, ESLint qoidasi. **Phase 1 hissasi:** hammasi tayyor va testlangan. **Phase 3:** Barcha API xatolari (validatsiya, DB, framework, 404/413/429/500) o‘zbekcha; framework'ning inglizcha matni chiqmaydi **Phase 14:** ESLint qoidasi kengaytirildi (atributlar, `{'matn'}`, toast, forma xabarlari, `shared/ui`); qolgan 4 ta inline xabar lug‘atga ko‘chirildi; brauzer QA inglizcha UI so‘zlarini qidiradi | AC-25; `uz.test.ts`, `error-map.test.ts`, `errors.test.ts`, `shared/forms/zod.test.ts`; `foundation.e2e-spec.ts`; `qa:ui` (170 holat), `qa:interactions` (AC-25 qatlamlar) | TESTED |
| REQ-003 | Domainlar: Auth, Users, Products, Groups, Warehouses, Inventory, Incoming, Sales, Customers, Expenses, Reports, Audit | api, web | Har biri alohida modul (ARCHITECTURE §3) | — | PLANNED |
| REQ-010 | ADMIN barcha modullarga to‘liq kira oladi | auth, shared | `ROLE_PERMISSIONS.ADMIN = ALL_PERMISSIONS` (istisnolar: audit va tasdiqlangan hujjatlar immutable — D-06, D-07). **Phase 1 hissasi:** permission katalogi va testlar. **Phase 2:** Permissionlar DB'da (`permissions`, `role_permissions`), seed `ALL_PERMISSIONS`/`ROLE_PERMISSIONS` dan sinxronlaydi **Phase 4:** guard'lar — ADMIN barcha permission endpointlariga `200` (probe). Modullar — o‘z phase'larida. | AC-18; `permissions.test.ts`; `seed.db-spec.ts`; `auth.db-spec.ts` (RBAC) | PLANNED (Phase 4 qismi TESTED) |
| REQ-011 | USER — sotuv jarayoni va faqat aniq ruxsat berilgan o‘qish operatsiyalari | auth, shared | `ROLE_PERMISSIONS.USER` (9 ta permission), ownership OWN-01…09. **Phase 1 hissasi:** katalog va testlar. **Phase 2:** USER'ning 8 ta permissioni DB'da (seed) **Phase 4:** USER → admin permission `403`, kontekst = `ROLE_PERMISSIONS.USER`. **D-12 (biznes egasi):** USER'ga `expenses.create` qo‘shildi (9 ta permission) — TZ'dagi "faqat sotuv jarayoni"dan farq. | AC-18, AC-19, AC-20; `seed.db-spec.ts`; `auth.db-spec.ts` (RBAC), `permissions.test.ts` | PLANNED (Phase 4 qismi TESTED) |
| REQ-012 | RBAC frontendda ham, backend API/service qatlamida ham | auth, web | Global guard'lar + service ownership; frontend nav filtri va route guard. **Phase 1 hissasi:** `NAV_ITEMS[].anyOf` + test **Phase 4:** backend — global `JwtAuthGuard` + `PermissionsGuard` + `RouteSecurityAuditor`; frontend — nav filtri, `RequireAuth`, `SectionGate` ("Ruxsat yo‘q"). Service ownership — modul phase'larida. | AC-18; `navigation.test.ts`; `auth.db-spec.ts`, `rbac.spec.ts`, `LoginPage.test.tsx`, brauzer QA | PLANNED (Phase 4 mexanizmi TESTED) |
| REQ-020 | User'ni faqat ADMIN yaratadi | users | `POST /users` + `users.manage` **Phase 5:** `POST /users` + `users.manage`; USER → `403`. | AC-01, AC-18; `users.db-spec.ts` | **TESTED** |
| REQ-021 | Loginni admin qo‘lda kiritadi | users | `POST /users` body `login` **Phase 5:** login body'da admin tomonidan; o‘zgarmaydi (A-26, PATCH'da `login` → `400`). | AC-01; `users.db-spec.ts` | **TESTED** |
| REQ-022 | Login faqat A-Z, a-z, 0-9, probel va maxsus belgilarsiz | users, shared | `loginSchema` + DB CHECK. **Phase 1 hissasi:** `loginSchema` tayyor va testlangan. **Phase 2:** DB CHECK `users_login_format` **Phase 5:** `createUserSchema` (shared) — backend va frontend. | AC-02; `primitives.test.ts`; `constraints.db-spec.ts`; `users.db-spec.ts` (noto‘g‘ri format → 400) | **TESTED** |
| REQ-023 | Login case-insensitive unique | users | `UNIQUE(lower(login))`, `normalizeLogin`. **Phase 2:** DB `users_login_lower_key ON lower(login)` **Phase 5:** pre-check + DB unique → `409 LOGIN_TAKEN` (`details.field = login`). | AC-03; `constraints.db-spec.ts`; `users.db-spec.ts` (BOSH ↔ bosh) | **TESTED** |
| REQ-024 | Parolni server random yaratadi, aynan 6 raqam | users, auth | `crypto.randomInt` + `padStart`. **Phase 1 hissasi:** `generatedPasswordSchema` testlangan **Phase 5:** `generatePassword` (create va reset), client parol yubora olmaydi. | AC-04; `password-hasher.spec.ts` (10 000), `users.db-spec.ts` | **TESTED** |
| REQ-025 | Parol hash qilinadi, plaintext saqlanmaydi | auth | argon2id + pepper (`v1$`). **Phase 2:** DB CHECK `users_password_hash_format` — ochiq parol DB darajasida rad etiladi **Phase 4:** `PasswordHasher` — `v1$` + argon2id(HMAC-SHA256(pepper, parol)); login, bootstrap CLI shu orqali. | AC-01 (DB tekshiruvi); `constraints.db-spec.ts`; `password-hasher.spec.ts`, `auth.db-spec.ts` (DB'da ochiq parol yo‘q), `bootstrap-admin.db-spec.ts` | **TESTED** |
| REQ-026 | Parol faqat yaratish javobida; log qilinmaydi | users, infra | `generatedPassword` bir marta, `no-store`, pino redact. **Phase 1 hissasi:** redaction testlangan **Phase 4:** bootstrap CLI paroli faqat terminalga bir marta; audit metadata'sidan maxfiy kalitlar tozalanadi. `POST /users` — Phase 5. **Phase 5:** `POST /users` va reset javobida bir marta, `no-store`; ro‘yxat/detal/audit'da yo‘q. | AC-01; `logger.options.spec.ts`; `bootstrap-admin.db-spec.ts`, `auth.db-spec.ts` (audit); `users.db-spec.ts` | **TESTED** |
| REQ-027 | Xavfsiz login/session/token va authorization middleware | auth | JWT + rotatsiyali refresh, `JwtAuthGuard`, `PermissionsGuard` **Phase 4:** login, rotatsiyali refresh + reuse detection, logout, `me`, progressive lockout, CSRF, `JwtAuthGuard`, `PermissionsGuard`, auth rate limit, audit. | AC-26, AC-27; `auth.db-spec.ts` (37), `rbac.spec.ts`, `api-client.auth.test.ts`, `LoginPage.test.tsx` | **TESTED** |
| REQ-030 | Dashboard: bugun va jami sotilgan miqdor va summa, ombordagi miqdor, kam qoldiq, faol userlar | dashboard | `GET /dashboard/summary` **Phase 12:** `modules/dashboard` — `summary` (bugun/kecha/jami, ombor birlik bo‘yicha, kam qoldiq, userlar), `sales-trend`, `top-products`; sotuvchi — `my-summary` (OWN-08) | `dashboard.db-spec.ts`, `DashboardPage.test.tsx`, `mock-api.test.ts`, real backend E2E | **TESTED** |
| REQ-031 | Dashboard tranzaksion manbadan hisoblanadi va inventar bilan mos | dashboard | Kesh yo‘q, so‘rov paytida `sales`/`warehouse_stock`dan **Phase 12:** har bir so‘rovda `sales`/`warehouse_stock`dan, bitta `REPEATABLE READ` snapshot; kesh yo‘q | AC-24; `dashboard.db-spec.ts` (mustaqil SQL bilan), real backend E2E (API = DB) | **TESTED** |
| REQ-040 | Bir nechta omborni yaratish va boshqarish | warehouses | Ombor CRUD + status. **Phase 2:** `warehouses` jadvali (status, case-insensitive unique nom). **Phase 7:** `modules/warehouses` — yaratish, tahrirlash, faollashtirish/nofaol qilish (o‘chirish yo‘q), qidiruv/filtr/saralash, audit | `warehouses.db-spec.ts`; `constraints.db-spec.ts` | **TESTED** |
| REQ-041 | "Ombor" → omborlar ro‘yxati | web, warehouses | `/warehouses` sahifasi. **Phase 1 hissasi:** navigatsiya va marshrut. **Phase 7:** haqiqiy backend, qidiruv, holat filtri, nofaol qilish/faollashtirish | `WarehousesPage.test.tsx`; real backend brauzer E2E | **TESTED** |
| REQ-042 | Ombor detali: mahsulotlar, qoldiq, kirim/chiqim harakatlari, tarix | warehouses, inventory | `/:id`, `/:id/stock`, `/:id/movements` (**Phase 7**) | `warehouses.db-spec.ts` — ko‘rsatkichlar, qoldiq, harakatlar, hujjat raqamlari | **TESTED** |
| REQ-043 | Stock (ombor, mahsulot) bo‘yicha | inventory | `warehouse_stock` PK(warehouse_id, product_id). **Phase 2:** PK `(warehouse_id, product_id)` + `quantity >= 0` + ledger moslik trigger'lari | AC-09, AC-11; `constraints.db-spec.ts`, `inventory.db-spec.ts` | **TESTED** |
| REQ-050 | Product maydonlari: id, name, groupId, barcode, costPrice, salePrice, status, timestamps | products | `products` jadvali (+ unit, allow_decimal, min_stock). **Phase 2:** `products` jadvali va CHECK'lari **Phase 6:** `POST/PATCH /products`, shared `productCreateSchema`/`productUpdateSchema`, DTO. | AC-05; `constraints.db-spec.ts`, `relationships.db-spec.ts`; `products.db-spec.ts` | **TESTED** |
| REQ-051 | Barcode unique | products | DB UNIQUE + `409 BARCODE_TAKEN`. **Phase 2:** `products_barcode_key` (D-05, D-09: arxivlanganlar ham) **Phase 6:** pre-check + DB unique → `409 BARCODE_TAKEN` (arxivdagilar ham, parallel holatda ham). | AC-06; `constraints.db-spec.ts`, `historical-integrity.db-spec.ts`; `products.db-spec.ts` | **TESTED** |
| REQ-052 | Mahsulot guruhlarini admin boshqaradi | product-groups | Guruh CRUD **Phase 6:** guruh CRUD + arxivlash (D-14), `ENTITY_IN_USE`. | P6 testlari; `products.db-spec.ts` | **TESTED** |
| REQ-053 | Product detali: jami kirim, jami sotilgan, qoldiq, sotuv tarixi | products | `/:id/summary`, `/:id/sales` **Phase 6:** `ProductDto.received/sold/stock` + `GET /products/:id/summary` (tushum, foyda, oxirgi 8 sotuv). **Phase 7:** omborlar bo‘yicha qoldiq — `ProductDto.warehouses` va `GET /warehouses/:id/stock` (alohida `/products/:id/stock` kerak bo‘lmadi). **Phase 10:** to‘liq sotuv tarixi — `GET /sales?productId=` (pagination, filtrlar, OWN-04); detaldagi “Barcha sotuvlar” havolasi shu filtr bilan sotuvlar tarixini ochadi (alohida `/products/:id/sales` kerak bo‘lmadi). | `products.db-spec.ts`; `sales.db-spec.ts` (`productId` filtri, AC-19); `ProductsPage.test.tsx` “Barcha sotuvlar” | **TESTED** |
| REQ-054 | Nom (to‘liq yoki qisman) va barcode bo‘yicha qidiruv | products | GIN trgm + barcode unique, `search`, `lookup`. **Phase 2:** GIN `products_name_trgm_idx` + `products_barcode_key` **Phase 6:** `search` (nom ILIKE yoki shtrix-kod aniq), `GET /products/lookup`, serverda pagination. | P6 testlari; `migrations.db-spec.ts`; `products.db-spec.ts` | **TESTED** |
| REQ-060 | Kirim header: date, warehouseId, notes, createdBy | incoming | `incoming` jadvali. **Phase 2:** `incoming` jadvali **Phase 8:** `modules/incoming` — header (sana, ombor, izoh, yaratgan/tasdiqlagan/bekor qilgan user). | `incoming.db-spec.ts`; `relationships.db-spec.ts` | **TESTED** |
| REQ-061 | Kirim item: productId, quantity, costPrice; bir nechta item | incoming | `incoming_items`. **Phase 2:** `incoming_items` (+ D-08 snapshot) **Phase 8:** `modules/incoming` — 1–500 qator, bitta mahsulot bir marta, nom/shtrix-kod snapshot. | AC-07; `incoming.db-spec.ts`, shared `incoming.test.ts` | **TESTED** |
| REQ-062 | UI'da jami miqdor = SUM, darhol yangilanadi | web | `useFieldArray` + `useWatch`, decimal-safe **Phase 8:** UI darhol qayta hisoblaydi, server totallari bilan mos. | AC-07, AC-08; `IncomingEditorPage.test.tsx`, real backend E2E | **TESTED** |
| REQ-063 | Ixtiyoriy: jami summa = SUM(qty × cost) | incoming, web | `total_amount`, `line_total` GENERATED. **Phase 2:** `line_total` GENERATED — DB hisoblaydi **Phase 8:** `totalAmount = Σ line_total` serverda. | AC-07; `incoming.db-spec.ts` | **TESTED** |
| REQ-064 | Tasdiqlashda movement + stock ↑ atomic | incoming, inventory | Bitta tranzaksiya (ARCHITECTURE §12.2). **Phase 2:** DB: tasdiqlashda totallar (`incoming_guard`) va har bir qator uchun ledger (`incoming_confirmed_ledger`) **Phase 8:** `IncomingService.confirm` → `InventoryService.increase`, bitta tranzaksiya; nosozlikda to‘liq rollback. | AC-09, AC-10; `incoming.db-spec.ts`, `inventory.db-spec.ts` | **TESTED** |
| REQ-065 | Backend totalni qayta hisoblaydi, frontendga ishonmaydi | incoming | Server-side `Σ`; client total qabul qilinmaydi. **Phase 2:** DB tasdiqlash paytida totallarni qatorlar yig‘indisi bilan solishtiradi **Phase 8:** client totallari — noma’lum maydon (400); totallar DB qatorlaridan. | AC-08; `incoming.db-spec.ts` | **TESTED** |
| REQ-070 | Sotuvni ruxsatli USER yaratadi | sales | `sales.create` + ombor ownership **Phase 10:** `POST /sales` — `sales.create` + `assertOperationalWarehouse`. | AC-11, AC-18; `sales.db-spec.ts`, real backend E2E | **TESTED** |
| REQ-071 | Mahsulot barcode yoki nom bo‘yicha qidiriladi va tanlanadi | sales, products, web | `lookup` (skaner), `search` **Phase 10:** kassa real `GET /products` (qidiruv) va `lookup` (skaner) dan. | `PosView.test.tsx`, real backend E2E | **TESTED** |
| REQ-072 | Joriy qoldiq va sotuv narxi ko‘rsatiladi | products, web | `ProductDto.stock`, `salePrice` **Phase 10:** kassa kartochkasida ombor bo‘yicha qoldiq va sotuv narxi (serverdan). | `PosView.test.tsx`, real backend E2E | **TESTED** |
| REQ-073 | Miqdor musbat, butun/kasr siyosati, qoldiqdan oshmaydi | sales, shared | `quantitySchema`, `isWholeQuantity`, atomic UPDATE. **Phase 1 hissasi:** sxema va helper testlangan **Phase 10:** `allowDecimal` siyosati (422), qoldiqdan oshmaydi (409, shartli UPDATE). | AC-12; `primitives.test.ts`, `sales.db-spec.ts` | **TESTED** |
| REQ-074 | Mijoz ismi majburiy, telefon ixtiyoriy | sales, customers, shared | `customerNameSchema`, `optionalPhoneSchema`, DB CHECK. **Phase 1 hissasi:** sxemalar testlangan. **Phase 2:** CHECK `customers_name_not_blank`, `customers_phone_format`, `sales_customer_name_not_blank` **Phase 9:** mijoz yaratish/tahrirlash — ism majburiy (trim, ≤150), telefon ixtiyoriy va normallashtiriladi. **Phase 10:** sotuvda ism majburiy (`customer.name` → 400), telefon ixtiyoriy. | AC-15, AC-16; `constraints.db-spec.ts`, `customers.db-spec.ts`, `sales.db-spec.ts`, shared `sales.test.ts` | **TESTED** |
| REQ-075 | Atomic: sale + items + stock ↓ + movement (+ audit) | sales, inventory | Bitta tranzaksiya (ARCHITECTURE §12.1) **Phase 10:** bitta tranzaksiya: sotuv + qatorlar + stock ↓ + ledger + mijoz yig‘malari + audit; nosozlikda to‘liq rollback. | AC-11; `sales.db-spec.ts` (atomiklik testi) | **TESTED** |
| REQ-076 | Saqlanadi: vaqt, userId, mijoz, warehouseId, itemlar, miqdorlar, narxlar, total | sales | `sales` + `sale_items` (snapshot). **Phase 2:** `sales` + `sale_items`: narx, tannarx, mahsulot nomi, shtrix-kod, mijoz snapshot'lari **Phase 10:** vaqt, user, ombor, mijoz snapshot’i, qatorlar, narx/tannarx snapshot’i, totallar. | AC-11; `sales.db-spec.ts`, `historical-integrity.db-spec.ts` | **TESTED** |
| REQ-077 | Parallel so‘rovlarda overselling yo‘q | sales, inventory | Shartli UPDATE + row lock + CHECK. **Phase 2:** DB darajasida 20 ta parallel sotuv (namunaviy algoritm) — aynan 10 tasi o‘tadi **Phase 10:** API darajasida 20 ta parallel sotuv (qoldiq 10) → aniq 10 tasi. | **AC-13**; `inventory.db-spec.ts`, `sales.db-spec.ts` | **TESTED** |
| REQ-080 | Mijoz xarid tarixi va yig‘malari | customers | `/:id/purchases`, yig‘ma ustunlar. **Phase 2:** Yig‘ma ustunlar + `reconcile_customer_aggregates` **Phase 9:** `GET /customers/:id/purchases` — haqiqiy `sales` dan, snapshot qatorlar, `summary` cache ustunlardan; tannarx faqat `products.read_cost`. **Phase 10:** yig‘malar sotuv tranzaksiyasida yangilanadi; reconciliation toza. | `customers.db-spec.ts`, `sales.db-spec.ts`, `inventory.db-spec.ts` | **TESTED** |
| REQ-081 | Mijoz qidiruvi | customers | `GET /customers?search=` (trgm + telefon) **Phase 9:** ism (ILIKE, trgm) yoki telefon raqamlari (≥ 3, qisman), LIKE ekranlangan; saralash, pagination. | `customers.db-spec.ts`, `CustomersPage.test.tsx`, real backend E2E | **TESTED** |
| REQ-090 | Filtrlar: sana oralig‘i, mahsulot, user, sotilgan/sotilmagan; birgalikda | sales, reports, shared | Query sxemalari, AND kombinatsiya. **Phase 1 hissasi:** `dateRangeSchema` testlangan. **Phase 3:** `createListQuerySchema` + `listFilters` (search, oneOf, id, dateRange) — barcha filtrlar AND; biznes filtrlari P6+ **Phase 12:** hisobot filtrlari `ReportDefinition`dan (AND), sana — Toshkent kunlari, majburiy, ≤ 366 kun (D-21) | **AC-17**; `reports.db-spec.ts`; `foundation.e2e-spec.ts`, `query.spec.ts` | **TESTED** |
| REQ-091 | Filter va pagination server-side | barcha ro‘yxatlar, shared | `paginationQuerySchema`, `createSortSchema`, `Paginated<T>`. **Phase 1 hissasi:** tayyor va testlangan. **Phase 3:** Backend foundation: `ZodQuery` + `createListQuerySchema`, `toPrismaPagination`, `toPaginated` (`{ data, meta }`); har bir ro‘yxat endpointi P5+ da shundan foydalanadi | `pagination.test.ts`; AC-17; `foundation.e2e-spec.ts` (pagination), `query.spec.ts` | **IMPLEMENTED** |
| REQ-092 | Indexlar: barcode, login, sanalar, FK, filtr maydonlari | database | DATABASE §7. **Phase 2:** DATABASE §7.1 index katalogi (har biri sababi bilan) **Phase 12:** 1 mln sotuvli benchmark (`bench:reports`) — DATABASE §7.2 | P2 testlari; `migrations.db-spec.ts`; `reports.bench-spec.ts` (EXPLAIN ANALYZE) | **TESTED** |
| REQ-100 | Xarajat maydonlari: date, amount, category, note, createdBy | expenses | `expenses` + `expense_categories`. **Phase 2:** `expenses` + `expense_categories` (+ `status`, A-27). **D-11 (2026-10-22):** `status` olib tashlandi (Phase 11'da yangi migration). **D-19 (tasdiqlangan, 2026-10-23):** `category` majburiy (sotuvchi ham tanlaydi, ro‘yxatni ADMIN boshqaradi), sana kelajakda bo‘lmaydi — TZ bilan conflict yo‘q. **Phase 11:** `modules/expenses` (API §12), migratsiya `20261023100000_expenses_drop_status` | `expenses.db-spec.ts`, `migrations.db-spec.ts`, `constraints.db-spec.ts`, `relationships.db-spec.ts`, shared `expenses.test.ts`, `ExpensesPage.test.tsx` | **TESTED** |
| REQ-101 | Admin sotuv, kirim va xarajatlarni ko‘radi | sales, incoming, expenses | `*.read` / `*.read_all` permissionlari. Sotuvlar — Phase 10 (`sales.read_all`, AC-19), kirimlar — Phase 8 (`incoming.read`), xarajatlar — Phase 11 (`expenses.read`; USER — `403`) | `sales.db-spec.ts` (AC-19), `incoming.db-spec.ts`, `expenses.db-spec.ts` (ruxsatlar) | **TESTED** |
| REQ-102 | Foyda = (salePrice − costPrice) × soldQuantity | reports | `Σ (line_total − line_cost)`, snapshot (D-02). **Phase 2:** `sale_items.unit_cost` snapshot, `line_cost` GENERATED. **D-16 (tasdiqlangan):** `costPrice` — mahsulot kartochkasidagi `cost_price`; kirim narxi uni o‘zgartirmaydi (mahsulot `summary`dagi foyda bilan testlangan) **Phase 12:** hisobotlar va `finance-summary`da foyda = `Σ (line_total − line_cost)` (sotuv paytidagi snapshot) | P10/P12; `inventory.db-spec.ts`, `historical-integrity.db-spec.ts`, `incoming.db-spec.ts` (D-16), `reports.db-spec.ts` (qo‘lda hisoblangan qiymatlar) | **TESTED** |
| REQ-103 | Tushum, xarajat, inventar tannarxi va foyda aniq ajratiladi | reports | `finance-summary` (BUSINESS-RULES §4) **Phase 12:** `GET /reports/finance-summary` — tushum, tannarx, yalpi foyda, xarajat, sof foyda, kirim (xarajat emas), ombor qiymati; ombor tanlansa xarajat va sof foyda `null` (D-21) | `reports.db-spec.ts` (mustaqil SQL), `reports.spec.ts`, `ReportsPage.test.tsx`, real backend E2E | **TESTED** |
| REQ-110 | Hisobotlar: sotuv, mahsulot, ombor qoldig‘i, kirim, xarajat, user sotuvi, mahsulot sotuvi, mijoz xaridlari | reports | 8 ta + `finance-summary` **Phase 12:** 8 ta hisobot + `finance-summary` (API §13) | `reports.db-spec.ts` (18), `reports.spec.ts` (11), `mock-api.test.ts`, `ReportsPage.test.tsx`, real backend E2E | **TESTED** |
| REQ-111 | Hisobotlarda sana filtri, pagination, export arxitekturasi | reports | `ReportDefinition`, kelajakda CSV/XLSX exporter **Phase 12:** sana filtri (majburiy, ≤ 366 kun, UI standarti — joriy oy), server-side pagination va saralash; export arxitekturasi — `REPORT_DEFINITIONS` (exporter hali yo‘q) | `reports.db-spec.ts`, `ReportsPage.test.tsx`, `mock-api.test.ts` | **TESTED** (sana, pagination); export — faqat arxitektura |
| REQ-120 | Kritik mutatsiyalar auditi | audit + barcha modullar | `AuditService.record(tx, …)`, `AuditAction` katalogi. **Phase 1 hissasi:** amal katalogi (`AuditAction`) **Phase 13:** 31 ta mutatsiya endpointi va reconciliation audit yozadi — ro‘yxat Nest metadata’sidan avtomatik tekshiriladi (API §15 jadvali); audit amal bilan bitta tranzaksiyada | **AC-21**; `audit-coverage.db-spec.ts`, modul `*.db-spec.ts` audit tekshiruvlari | **TESTED** |
| REQ-121 | Audit maydonlari: actor, timestamp, action, entity, entityId, metadata | audit | `audit_logs` jadvali. **Phase 2:** `audit_logs` jadvali (actor, occurred_at, action, entity, metadata, request_id) **Phase 13:** `GET /audit-logs` (actor, vaqt, amal, obyekt, ID, metadata, IP, so‘rov ID; filtrlar, keyset cursor), `GET /audit-logs/:id`; Sozlamalar ichidagi "Audit jurnali" (D-22) | AC-21; `audit.db-spec.ts`, `relationships.db-spec.ts`, `AuditLogView.test.tsx`, `mock-api.test.ts`, real backend E2E | **TESTED** |
| REQ-122 | Audit yozuvlarini oddiy userlar o‘zgartira olmaydi | audit, database | Endpoint yo‘q + trigger + DB huquqlari (D-06: hech kim). **Phase 2:** Trigger (`DV001`) + `divine_app` faqat SELECT/INSERT — SQL bilan ham o‘zgarmaydi; API — P13 **Phase 13:** API’da yozish/o‘zgartirish/o‘chirish endpointi yo‘q (`404`, ADMIN uchun ham) | **AC-22**; `immutability.db-spec.ts`, `audit.db-spec.ts` | **TESTED** |
| REQ-130 | Minimal 14 jadval | database | 20 jadval (DATABASE §4). **Phase 2:** 20 ta jadval, 5 ta migratsiya | `migrations.db-spec.ts` | **TESTED** |
| REQ-131 | PK, FK, unique va indexlar | database | DATABASE §4, §7. **Phase 2:** PK, FK (delete strategiyasi qotirilgan), UNIQUE, CHECK, indexlar | `migrations.db-spec.ts`, `constraints.db-spec.ts` | **TESTED** |
| REQ-132 | O‘zgarmas ledger + joriy stock + reconciliation | inventory, database | DATABASE §5. **Phase 2:** Ledger + stock + DB invariant trigger'lari + 4 ta reconciliation view. **Phase 7:** `InventoryService.increase/decrease`, `GET /inventory/movements`, `GET /inventory/reconciliation` (audit), kunlik job (03:00, Redis qulfi) | AC-23; `inventory.db-spec.ts`, `warehouses.db-spec.ts`, `test/unit/inventory/inventory.spec.ts` | **TESTED** |
| REQ-133 | Pul — decimal, float emas | database, shared, web | `NUMERIC(18,2)`, `moneySchema`, string formatlash. **Phase 1 hissasi:** `moneySchema`, `formatMoney` testlangan. **Phase 2:** `NUMERIC(18,2)` / `NUMERIC(14,3)` + `NaN` CHECK'lari; API string serializatsiyasi — P3 | `primitives.test.ts`, `format.test.ts`; `constraints.db-spec.ts` | **IMPLEMENTED** |
| REQ-140 | Izchil REST contract | api | `/api/v1`, API.md, OpenAPI. **Phase 1 hissasi:** prefix, Swagger, `/health`. **Phase 3:** `/api/v1` prefiksi, yagona xato va ro‘yxat shakli, OpenAPI sxemalari (`ApiErrorBodyDto`, `PaginationMetaDto`, global 429/500/503) | `health.e2e-spec.ts`; `foundation.e2e-spec.ts` (Swagger) | PLANNED |
| REQ-141 | Controller / service / data access qatlamlari | api | Modul anatomiyasi (ARCHITECTURE §4). **Phase 1 hissasi:** `health` moduli namunasi. **Phase 3:** `TransactionRunner` (service tranzaksiya chegarasi), repository uchun `Tx` tipi va Prisma query helper'lari | `health.service.spec.ts`; `transaction-runner.spec.ts` | PLANNED |
| REQ-142 | Barcha input serverda validatsiya qilinadi | api, shared | `ZodValidationPipe` (P3) + shared sxemalar. **Phase 3:** `ZodValidationPipe` — `@ZodBody/@ZodQuery/@ZodParam`, shared sxemalar, body `strictObject`; har bir yangi endpoint (P4+) shu orqali | P3 testlari; `foundation.e2e-spec.ts` (body, query, params) | **IMPLEMENTED** |
| REQ-143 | Yagona error strukturasi, o‘zbekcha xabarlar | api, shared | `ErrorFilter` (P3), `ApiErrorBody`, `ERROR_MESSAGES_UZ`. **Phase 1 hissasi:** kodlar, xabarlar, struktura va web `ApiError` tayyor. **Phase 3:** `AppError` + `GlobalExceptionFilter` + kod → status jadvali + DB xato mapping (DATABASE §12) + `requestId` | `errors.test.ts`, `api-client.test.ts`; `foundation.e2e-spec.ts`, `database-errors.spec.ts`, `error-mapping.db-spec.ts` | **TESTED** |
| REQ-144 | Authorization service/API darajasida | api | Guard'lar + service ownership **Phase 4:** API darajasi (guard'lar) va ownership helper'lari (`assertWarehouseAccess`, `warehouseScope`, `ownerScope`) tayyor; har bir service — modul phase'ida (5–13). **Phase 15:** endpoint × rol matritsasi. **Phase 16:** RBAC fuzz — yo‘l variantlari, method-override, `role: ADMIN` yozilgan to‘g‘ri imzoli sotuvchi tokeni ham `403` (ruxsat DB’dan); brauzer E2E (admin sahifalari va devtools so‘rovlari) | AC-18, AC-19; `auth.db-spec.ts`, `rbac.spec.ts`, `rbac-matrix.db-spec.ts`, `security-fuzz.db-spec.ts`, Playwright `main-flows.spec.ts` | **TESTED** (Phase 16) |
| REQ-145 | Kritik operatsiyalar idempotent | sales, incoming | `Idempotency-Key` + `request_hash`; confirm shartli UPDATE; ledger UNIQUE. **Phase 2:** `sales.idempotency_key` UNIQUE + `request_hash`; ledger `UNIQUE(reference_type, reference_item_id)` **Phase 10:** `Idempotency-Key` (UUID) UNIQUE + kanonik `request_hash`; boshqa payload/user → 409; parallel bir xil kalit → bitta sotuv. | AC-14, AC-09; `sales.db-spec.ts`, `incoming.db-spec.ts`, `constraints.db-spec.ts` | **TESTED** |
| REQ-150 | Responsive, professional dashboard | web | Tailwind + shadcn, sidebar/drawer. **Phase 1 hissasi:** layout tayyor **Phase 14:** 5 kenglik (1440/1280/1024/768/390) × 2 mavzu brauzer QA | `qa:ui` — 17 sahifa × 5 kenglik × 2 mavzu (overflow, jadval scroll, nomsiz tugma, label’siz input); `qa:interactions` (mobil drawer, sidebar) | TESTED |
| REQ-151 | Navigatsiya: 11 ta bo‘lim (TZ §16) | web | `NAV_ITEMS`. **Phase 1 hissasi:** 11 ta bo‘lim TZ tartibida, testlangan | `navigation.test.ts`, `AppLayout.test.tsx` | TESTED |
| REQ-152 | Client va server validatsiya | web, api, shared | Bitta Zod sxemasi ikkala tomonda. **Phase 3:** Server tomonida bir xil shared Zod sxemalari (`ZodValidationPipe`) **Phase 14:** client'da zod faqat `@/shared/forms/zod` orqali (o‘zbekcha xabarlar har bir chunk'da) | P3 `foundation.e2e-spec.ts`; `shared/forms/zod.test.ts`; forma testlari (`ExpensesPage`, `PosView`, `qa:interactions` "bo‘sh forma o‘zbekcha xatolar") | TESTED |
| REQ-153 | Destructive amallarda tasdiqlash | web | `ConfirmDialog` **Phase 14:** BR-33 dagi barcha amallar; guruhni arxivlash va kategoriyani nofaol qilish tasdiqsiz edi — qo‘shildi | `app/confirm-dialogs.test.tsx` (6), `ProductGroupsPage.test.tsx`, `ExpensesPage.test.tsx`, `UsersPage.test.tsx`, `WarehousesPage.test.tsx`; `qa:interactions` | TESTED |
| REQ-154 | Loading, empty, success, error holatlari | web | `Skeleton`, `EmptyState`, `ErrorState`, toast. **Phase 1 hissasi:** komponentlar va server holati ko‘rsatkichi **Phase 14:** bosh sahifa panellari, POS (omborlar, mahsulotlar, mijoz tavsiyalari), mahsulot tanlovi va forma ro‘yxatlarida xato holati; yuklanmagan ma’lumot "bo‘sh" deb ko‘rsatilmaydi | `AppLayout.test.tsx`; `DashboardPage.test.tsx` (xato + bo‘sh), `PosView.test.tsx`, `IncomingEditorPage.test.tsx`, `ExpensesPage.test.tsx` (`test/fail-routes.ts`) | TESTED |
| REQ-155 | Jadvallarda search, filter, pagination, sorting | web | `DataTable` (server-side) **Phase 14:** omborlar kartochkalari ham server-side pagination (avval 100 tada kesilardi) | `ProductsPage.test.tsx` (jadval = server javobi: sahifa, saralash, qidiruv), `WarehousesPage.test.tsx` (pagination), `qa:interactions` (URL va refresh) | TESTED |

## 2. Nofunksional talablar

| REQ ID | Talab | Modul | Rejalashtirilgan implementatsiya | Test | Status |
|---|---|---|---|---|---|
| REQ-160 | Sotuv va kirim DB tranzaksiyasida | sales, incoming | `TransactionRunner`. **Phase 2:** DB: deferred to‘liqlik trigger'lari — yarim yozilgan sotuv/kirim COMMIT bo‘lmaydi. **Phase 3:** `TransactionRunner`: COMMIT/ROLLBACK, timeout, deadlock retry, READ COMMITTED strategiyasi (ARCHITECTURE §12.3) **Phase 10:** sotuv `TransactionRunner` ichida, deferred trigger’lar COMMIT’da tekshiradi. | AC-10, AC-11; `sales.db-spec.ts`, `incoming.db-spec.ts`, `transaction-runner.db-spec.ts` | **TESTED** |
| REQ-161 | Manfiy stock yo‘q | inventory, database | Shartli UPDATE + CHECK. **Phase 2:** CHECK `warehouse_stock_quantity_non_negative` + ledger trigger'lari. **Phase 7:** `InventoryService.decrease` — shartli UPDATE, yetmasa `409 INSUFFICIENT_STOCK` va to‘liq rollback; parallel 10 ta → aniq 5 tasi. API (`POST /sales`) — P10 **Phase 10:** API darajasida ham (AC-12, AC-13). | AC-12, AC-13; `constraints.db-spec.ts`, `inventory.db-spec.ts`, `warehouses.db-spec.ts` | **TESTED** |
| REQ-162 | Takroriy login va barcode yo‘q | users, products, database | DB UNIQUE + mapping. **Phase 2:** UNIQUE `users_login_lower_key`, `products_barcode_key`; `409` mapping — P3/P5/P6 | AC-03, AC-06; `constraints.db-spec.ts` | **IMPLEMENTED** |
| REQ-163 | Sensitive ma’lumot log va javoblarda chiqmaydi | infra, api | Redact, DTO mapper, config xatolarida qiymat yo‘q. **Phase 1 hissasi:** redaction va config xabarlari testlangan. **Phase 3:** Log: query string'siz URL, kengaytirilgan redaction, xavfsiz xato serializatsiyasi (Prisma argumentlari va DB qatorlari yozilmaydi); javob: stack/SQL/constraint yo‘q. Rolga qarab DTO mapperlar — P5+ **Phase 4:** audit metadata sanitizatsiyasi (`pass|hash|token|secret|pepper|cookie|authorization`), auth javoblari `no-store`. **Phase 16:** SEC-01 yopildi (noma’lum login audit va Redis'da xom emas); to‘liq oqimdan keyin log, audit va Redis grep testi; har bir GET javobi (ADMIN/USER) maxfiy maydonlar skaneri; barcha API javoblari `no-store`. | `logger.options.spec.ts`, `env.schema.spec.ts`; `foundation.e2e-spec.ts`, `database-errors.spec.ts`; `auth.db-spec.ts` ("SEC-01"), `security-leaks.db-spec.ts`, `security-hardening.db-spec.ts`, `login-fingerprint.spec.ts` | **TESTED** (Phase 16) |
| REQ-164 | AuthN, AuthZ, rate limiting, secure headers, sanitization, DB constraint'lar | api, infra | helmet, CORS, throttler, guard'lar, Zod, CHECK. **Phase 1 hissasi:** helmet, CORS, Nginx header'lari e2e va smoke testlangan. **Phase 2:** DB constraint'lar va trigger'lar. **Phase 3:** Rate limiting (Redis, anonim 60/daq/IP), body ≤ 1 MB, input validatsiyasi, xavfsiz xato javoblari **Phase 4:** AuthN/AuthZ guard'lari, login 10/daq va refresh 30/daq IP limiti, user bo‘yicha read/write limitlari. **Phase 16:** production header'lari (HSTS bilan) muvaffaqiyatli va xato javoblarida; refresh 30/daq testi; enumeration (javob va vaqt); input fuzz (har bir yozuvchi endpoint — 5xx, stack, prototype pollution yo‘q); Nginx header'lari ishlayotgan image'da; `pnpm audit --prod` — 0. | `health.e2e-spec.ts`; `constraints.db-spec.ts`; `foundation.e2e-spec.ts`, `redis-throttler.db-spec.ts`; `auth.db-spec.ts`; `security-hardening.db-spec.ts`, `security-fuzz.db-spec.ts` | **TESTED** (Phase 16; web HSTS — TLS bilan Phase 17) |
| REQ-165 | Ichkarida UTC, ko‘rinishda Toshkent vaqti | database, api, web | `timestamptz`, `APP_TIMEZONE`, `formatDateTime`. **Phase 1 hissasi:** web formatlash testlangan. **Phase 2:** `timestamptz(3)`; DB standarti va ulanish `timezone=UTC`. **Phase 3:** Backend: `tashkentDayRange`, `tashkentToday`, `tashkentDateRangeToUtc` (IANA, DST va yarim tunsiz kunlar); DB UTC (P2); web formatlash (P1) | `format.test.ts`; AC-24; `migrations.db-spec.ts`; `tashkent-time.spec.ts`, `foundation.e2e-spec.ts` (sana filtri) | **IMPLEMENTED** |
| REQ-166 | SQL injection, XSS, CSRF himoyasi; secure cookie; secretlar env'da | api, web, infra | SECURITY §9–§13. **Phase 1 hissasi:** XSS lint qoidasi, CSP, env secret validatsiyasi, sort whitelist. **Phase 3:** SQL injection: `$queryRawUnsafe`/`$executeRawUnsafe` ESLint taqiqi, sort mapping, `toSqlOrderBy` **Phase 4:** CSRF (refresh/logout: `Origin` + `X-Requested-With`), refresh cookie `HttpOnly; Secure; SameSite=Strict; Path=/api/v1/auth`, access token faqat xotirada. **Phase 16:** SQL — `Prisma.raw` ishlatilgan joylar qo‘lda ko‘rib chiqildi (faqat statik ustun nomlari va whitelist'dan o‘tgan saralash), path/query injection fuzz; XSS — xavfli naqshlar yo‘q (`innerHTML`, `eval`, `target=_blank`, dinamik `href`), CSP ishlayotgan image'da; cookie atributlari (prod); brauzerda token `localStorage`/`sessionStorage`da yo‘q, refresh cookie JS'ga ko‘rinmaydi; production build mock API bilan yig‘ilmaydi. | lint probe, `env.schema.spec.ts`, `pagination.test.ts`; `foundation.e2e-spec.ts`; `auth.db-spec.ts` (CSRF, cookie), `api-client.auth.test.ts`; `security-fuzz.db-spec.ts`, `security-hardening.db-spec.ts`, `build-api-mode.test.ts`, Playwright `main-flows.spec.ts` | **TESTED** (Phase 16) |
| REQ-167 | Performance: API p95 < 300 ms; hisobotlar 1 mln qatorda < 2 s | api, database | Indexlar, EXPLAIN, yuklama testi **Phase 12:** `bench:reports` — 1 mln sotuv, barcha hisobotlar SQL va HTTP < 2 s (eng sekini 1,26 s), DATABASE §7.2 **Phase 15:** `bench:load` — 1 mln sotuvli seed, 32 virtual foydalanuvchi (normal ~112, peak ~194 RPS), har bir endpoint p95 ≤ 212 ms, 0 xato; `bench:reports` qayta — eng sekini 1,25 s; natijalar JSON'da saqlanadi va `bench:compare` bilan solishtiriladi (TESTING §5, DATABASE §7.3) | `reports.bench-spec.ts`, `load.bench-spec.ts` (alohida, CI’siz) | **TESTED** (Phase 15; o‘lchov muhiti — bitta noutbuk, TESTING §5.2) |
| REQ-168 | Kuzatuvchanlik: structured log, requestId, health | infra | pino, `X-Request-Id`, `/health`. **Phase 1 hissasi:** hammasi tayyor; monitoring/alerting — P17. **Phase 3:** requestId birinchi middleware'da (header = error.requestId = log), so‘rov logi: method, route, status, responseTime; daraja 4xx warn / 5xx error. Monitoring/alerting — P17 | `health.e2e-spec.ts`; `foundation.e2e-spec.ts`, real API smoke | **IMPLEMENTED** |
| REQ-169 | Kengayuvchanlik: stateless API, mobilga tayyor REST | api | JWT, Redis storage, `/api/v1`. **Phase 3:** Rate limit holati Redis'da (bir nechta API instance) | P17; `redis-throttler.db-spec.ts` | PLANNED |

## 3. Jarayon talablari

| REQ ID | Talab | Modul | Rejalashtirilgan implementatsiya | Test | Status |
|---|---|---|---|---|---|
| REQ-170 | Kod yozishdan oldin: arxitektura, papka tuzilmasi, ERD, API contract, RBAC matritsa, reja | docs | `docs/ARCHITECTURE.md`, `DATABASE.md`, `API.md`, `RBAC.md`, `DEVELOPMENT-PLAN.md` | Hujjatlar ko‘rib chiqildi | **IMPLEMENTED** |
| REQ-171 | Oxirida: setup, env, migration/seed, test yo‘riqnomasi, bajarilgan funksiyalar ro‘yxati, README | docs | `README.md` (Phase 1 foundation → P17 yakuniy). **Phase 2:** README: DB setup (migratsiya, seed, test) | — | PLANNED |
| REQ-172 | §19 acceptance testlari + unit/integration/API + concurrency | barcha | AC-01…AC-27 (P4–P15). **Phase 2:** `pnpm test:db` — real PG 18 ga qarshi DB testlari **Phase 15:** TZ §19 ning 13 ta testi va 17 ta kritik ssenariy avtomatik testlarga bog‘landi (TESTING §2–§3), RBAC matritsasi (74 endpoint), Playwright E2E (7 qadam), coverage chegaralari (domain ≥ 90%, service ≥ 80%) | `test/db/*`, `test/unit/*`, frontend `*.test.tsx`, `frontend/e2e/*` | **TESTED** (Phase 15) |
| REQ-173 | Non-negotiable talablar jimgina olib tashlanmaydi | docs | BUSINESS-RULES §1 (BR-01…BR-12), shu matritsa | Har bir phase ko‘rib chiqiladi | PLANNED |

---

## 4. Non-negotiable biznes qoidalari (TZ §18) → REQ

| BR | Qoida | REQ | Test | Status |
|---|---|---|---|---|
| BR-01 | Faqat Admin user yaratadi | REQ-020 | AC-01, AC-18 | **TESTED** (`users.db-spec.ts`) |
| BR-02 | Admin login beradi, server parol yaratadi | REQ-021, REQ-024 | AC-01, AC-04 | **TESTED** (`users.db-spec.ts`) |
| BR-03 | Login = harflar + raqamlar | REQ-022, REQ-023 | AC-02, AC-03 | **TESTED** (sxema, DB CHECK, `users.db-spec.ts`) |
| BR-04 | Parol = aynan 6 raqam | REQ-024 | AC-04 | **TESTED** (sxema, DB CHECK, `users.db-spec.ts`) |
| BR-05 | Mijoz ismi har sotuvda majburiy | REQ-074 | AC-15 | **TESTED** (mijoz moduli va sotuv) |
| BR-06 | Mijoz telefoni ixtiyoriy | REQ-074 | AC-16 | **TESTED** (mijoz moduli va sotuv) |
| BR-07 | Qoldiqdan ko‘p sotib bo‘lmaydi | REQ-073, REQ-077, REQ-161 | AC-12, AC-13 | **TESTED** (DB, service va API) |
| BR-08 | Tasdiqlangan kirim stockni oshiradi | REQ-064 | AC-09 | **TESTED** (Phase 8) |
| BR-09 | Tasdiqlangan sotuv stockni kamaytiradi | REQ-075 | AC-11 | **TESTED** (Phase 10) |
| BR-10 | Barcode unique | REQ-051, REQ-162 | AC-06 | **TESTED** (`products.db-spec.ts`, DB UNIQUE) |
| BR-11 | Kirim jami miqdori dinamik hisoblanadi | REQ-062, REQ-065 | AC-07, AC-08 | **TESTED** (Phase 8) |
| BR-12 | Barcha UI va xabarlar o‘zbekcha | REQ-002 | AC-25 | TESTED (Phase 14) |

## 5. Acceptance criteria → REQ

| AC | Ssenariy (TZ §19 + kritik ssenariylar) | REQ | Phase | Status |
|---|---|---|---|---|
| AC-01 | To‘g‘ri login bilan user yaratish; 6 xonali parol javobda; DB'da faqat hash; log'da parol yo‘q | REQ-020, 021, 024, 025, 026 | 5 | **TESTED** |
| AC-02 | Noto‘g‘ri login formatlari rad etiladi | REQ-022 | 5 | **TESTED** |
| AC-03 | Takroriy login (case-insensitive) → 409 | REQ-023 | 5 | **TESTED** |
| AC-04 | 10 000 ta generatsiya: barchasi `/^\d{6}$/` | REQ-024 | 5 | **TESTED** |
| AC-05 | Mahsulot yaratish + audit | REQ-050 | 6 | **TESTED** (`products.db-spec.ts`) |
| AC-06 | Takroriy barcode → 409 (parallel holatda ham) | REQ-051 | 6 | **TESTED** (`products.db-spec.ts`) |
| AC-07 | Kirim 50+30+100+20 → 200 (UI va server) | REQ-062, 065 | 8 | **TESTED** (`incoming.db-spec.ts`, `IncomingEditorPage.test.tsx`) |
| AC-08 | Item miqdori o‘zgaradi → total darhol qayta hisoblanadi; server o‘zi hisoblaydi | REQ-062, 065 | 8 | **TESTED** (UI testi, server testi, real backend E2E) |
| AC-09 | Kirimni tasdiqlash → stock ↑, movement'lar, audit; takroriy confirm stockni ikki marta oshirmaydi | REQ-064, 145 | 8 | **TESTED** (takroriy va 5 ta parallel so‘rov) |
| AC-10 | Tasdiqlash o‘rtasidagi xato → to‘liq rollback | REQ-064, 160 | 8 | **TESTED** (ledger yozish o‘rtasida sun’iy nosozlik; noto‘g‘ri qator) |
| AC-11 | To‘g‘ri sotuv → stock ↓, total, tarix, audit | REQ-075, 076 | 10 | **TESTED** (`sales.db-spec.ts`, real backend E2E) |
| AC-12 | Qoldiqdan ko‘p sotish → 409, hech narsa o‘zgarmaydi | REQ-073, 161 | 10 | **TESTED** (barcha yetmayotgan qatorlar xabarda, hech narsa o‘zgarmaydi) |
| AC-13 | Concurrency: qoldiq 10, 20 ta parallel sotuv → aniq 10 tasi o‘tadi, stock 0 | REQ-077 | 2, 10 | **TESTED** (DB va API darajasida: 20 parallel → aniq 10) |
| AC-14 | Bir xil Idempotency-Key → bitta sotuv | REQ-145 | 10 | **TESTED** (takroriy, ekvivalent payload, 5 ta parallel; boshqa payload/user → 409) |
| AC-15 | Mijoz ismisiz sotuv → 400 | REQ-074 | 10 | **TESTED** |
| AC-16 | Telefonsiz sotuv → 201 | REQ-074 | 10 | **TESTED** |
| AC-17 | Sana + mahsulot + user + sotilgan/sotilmagan kombinatsiyasi | REQ-090, 091 | 12 | **TESTED** (`reports.db-spec.ts`) |
| AC-18 | USER admin endpointlariga → 403 (matritsa) | REQ-011, 012, 144 | 4–15 | **TESTED** (Phase 15: `rbac-matrix.db-spec.ts` — 74 ta endpoint Nest metadata'sidan; anonim → 401, USER ruxsatsiz → 403 FORBIDDEN, ruxsatlilar va ADMIN guard'dan o‘tadi; USER ro‘yxati RBAC.md bilan aniq solishtiriladi; E2E — sotuvchi admin UI/API → "Ruxsat yo‘q"/403) |
| AC-19 | USER boshqa user'ning sotuvini ko‘ra olmaydi → 404 | REQ-011, 144 | 10 | **TESTED** (begona sotuv → 404, `userId` filtri chetlab o‘tolmaydi) |
| AC-20 | USER javobida costPrice yo‘q | REQ-011 | 6 | **TESTED** (`products.db-spec.ts`) |
| AC-21 | Har bir kritik mutatsiya audit yozadi | REQ-120, 121 | 5–13 | **TESTED** (`audit-coverage.db-spec.ts`: barcha mutatsiya endpointlari + katalogdagi har bir amal) |
| AC-22 | Auditni o‘zgartirib yoki o‘chirib bo‘lmaydi (SQL bilan ham) | REQ-122 | 2, 13 | **TESTED** (SQL — `immutability.db-spec.ts`, `audit.db-spec.ts`; API — endpoint yo‘q, `404`) |
| AC-23 | Reconciliation: Σ movements = warehouse_stock | REQ-132 | 2, 7, 10 | **TESTED** (Phase 7: endpoint ataylab yaratilgan farqni topadi, tuzatilgach yo‘qoladi, audit; Phase 10 da sotuvlardan keyin qayta) |
| AC-24 | Dashboard = manba ma’lumotlari; Toshkent kun chegarasi | REQ-030, 031, 165 | 12 | **TESTED** (`dashboard.db-spec.ts`: 23:59:59 va 00:00 Toshkent; mustaqil SQL; real backend E2E) |
| AC-25 | Barcha UI matnlari o‘zbekcha | REQ-002 | 1 → 14 | TESTED (Phase 14: lint qoidasi + `qa:ui` 170 holat + `qa:interactions` qatlamlari) |
| AC-26 | Brute-force → progressive lockout | REQ-027 | 4 | **TESTED** (`auth.db-spec.ts`) |
| AC-27 | Bloklangan user → keyingi so‘rovda 401 | REQ-027 | 4 | **TESTED** (`auth.db-spec.ts`) |

## 6. TZ bo‘limlari qamrovi

| TZ § | REQ / BR |
|---|---|
| 1 Product | REQ-001…003 |
| 2 Roles & access | REQ-010…012 · D-06, D-07 |
| 3 Auth / user creation | REQ-020…027 · BR-01…04 |
| 4 Dashboard | REQ-030, 031 |
| 5 Warehouses | REQ-040…043 |
| 6 Products & groups | REQ-050…054 · BR-10 |
| 7 Incoming | REQ-060…065 · BR-08, BR-11 |
| 8 Sales | REQ-070…077 · BR-05…07, BR-09 |
| 9 Customers | REQ-074, 080, 081 |
| 10 Search / filtering | REQ-054, 090…092 |
| 11 Expenses / finance | REQ-100…103 · D-01, D-02 |
| 12 Reports | REQ-110, 111 |
| 13 Audit | REQ-120…122 |
| 14 Database | REQ-130…133 |
| 15 API / backend | REQ-140…145 |
| 16 Frontend | REQ-150…155 |
| 17 Data integrity / security | REQ-160…166 |
| 18 Business rules | BR-01…BR-12 |
| 19 Acceptance tests | AC-01…AC-27 |
| 20 Output expectation | REQ-170…173 |

## 7. Phase 1 xulosasi

- **IMPLEMENTED:** REQ-170.
- **Phase 1 hissasi bor (status PLANNED):** REQ-002, 010, 011, 012, 022, 024, 026, 041, 073, 074, 090, 091, 120, 133, 140, 141, 143, 150, 151, 154, 163, 164, 165, 166, 168.
- Qolganlari — PLANNED (tegishli phase'larda).

## 7.1. Phase 4 (Authentication + RBAC) xulosasi

- **TESTED:** REQ-025, REQ-027; AC-26, AC-27.
- **Phase 4 qismi TESTED (status PLANNED — modul phase'lari qoldi):** REQ-010, REQ-011, REQ-012, REQ-144, REQ-164; AC-18 (probe skeleti).
- **Phase 4 hissasi qo‘shildi:** REQ-026, REQ-163, REQ-166.
- **Biznes egasi qarorlari (TZ bilan farq):** D-11 (xarajat: kategoriya va holat yo‘q, "Xarajatlar" nomi), D-12 (USER `expenses.create`).

## 7.2. Phase 5 (Users) xulosasi

- **TESTED:** REQ-020, REQ-021, REQ-022, REQ-023, REQ-024, REQ-026; BR-01…BR-04; AC-01…AC-04. BR-27, BR-28, BR-29 — `users.db-spec.ts` va `users.service.spec.ts`.
- **Yangi qaror:** D-13 (holat = ACTIVE/BLOCKED, lockout alohida; nofaol ombor qoidasi; `warehouse-options`). Migratsiya yo‘q.
- **AC-18:** users endpointlari bo‘yicha anonim/USER/ADMIN matritsasi TESTED; boshqa modullar — o‘z phase'larida.

## 7.3. Phase 6 (Products + Groups) xulosasi

- **TESTED:** REQ-050, REQ-051, REQ-052, REQ-054; BR-10; AC-05, AC-06 (parallel), AC-20 (kelgan narxi sotuvchiga yo‘q — ro‘yxat, detal, lookup, summary, saralash).
- **Qisman (Phase 6 holati):** REQ-053 (summary bor; to‘liq sotuv tarixi — Phase 10 da yopildi, §7.7).
- **Yangi qaror:** D-14 (guruh arxivi, `PRODUCT_GROUP_INACTIVE`). Migratsiya yo‘q.

## 7.4. Phase 7 (Warehouses + Inventory) xulosasi

- **TESTED:** REQ-040, REQ-041, REQ-042, REQ-132, AC-23; REQ-161 (DB + service). OWN-01 va OWN-02 (`assertOperationalWarehouse`), BR-21 (nofaol omborga kirim/sotuv → 422, service darajasida), BR-26 (ledger o‘zgarmaydi, nofaol qilish tarixga tegmaydi).
- **Qisman (Phase 7 holati):** REQ-053 — to‘liq sotuv tarixi Phase 10 da yopildi (§7.7).
- **Bog‘liqlik:** `InventoryService` tayyor, lekin uni HTTP orqali chaqiradigan kirim tasdiqlash (Phase 8) va sotuv (Phase 10) hali yo‘q — real dev bazada qoldiq shu phase'lardan keyin paydo bo‘ladi.
- Migratsiya yo‘q (Phase 2 sxemasi yetarli).

## 7.5. Phase 8 (Incoming) xulosasi

- **TESTED:** REQ-060…REQ-065; BR-08, BR-11; AC-07…AC-10. BUSINESS-RULES: BR-13 (kirimda butun/kasr siyosati), BR-14, BR-16, BR-17, BR-18, BR-21 (kirim).
- **Qisman:** REQ-145 va REQ-160 — kirim qismi TESTED (shartli UPDATE + ledger UNIQUE; bitta tranzaksiya), sotuv qismi — Phase 10.
- **Qaror:** D-16 — biznes egasi tomonidan **tasdiqlangan** (2026-10-22): nol kelgan narxi, kirim mahsulot `cost_price`ini o‘zgartirmaydi (foyda — kartochka tannarxidan), nofaol ombor qoralamasi tahrirlanmaydi/tasdiqlanmaydi, o‘chirish yo‘q, sana cheklovi yo‘q. Har bir band testlangan (`incoming.db-spec.ts`, `IncomingPage.test.tsx`). Migratsiya yo‘q.

## 7.6. Phase 9 (Customers) xulosasi

- **TESTED:** REQ-081; OWN-07. Qisman TESTED: REQ-074 (mijozlar moduli), REQ-080 (xarid tarixi va yig‘malarni o‘qish), BR-05/BR-06 (mijoz yaratish) — sotuvdagi qismlari Phase 10 da.
- **Qoidalar:** takroriy ism/telefon ruxsat (A-23); o‘chirish/arxiv yo‘q (BR-30); izoh faqat `customers.manage`; audit'da shaxsiy qiymatlar yo‘q. Qaror: D-17 — biznes egasi tomonidan **tasdiqlangan** (2026-10-22), har bir band testlangan. Migratsiya yo‘q.

## 7.7. Phase 10 (Sales) xulosasi

- **TESTED:** REQ-053 (to‘liq sotuv tarixi — `GET /sales?productId=`), REQ-070…REQ-077, REQ-080, REQ-145, REQ-160, REQ-161; AC-11…AC-16, AC-19; BR-05, BR-06, BR-07, BR-09; BUSINESS-RULES: BR-15 (narx/tannarx serverda, D-16), BR-19…BR-23; OWN-02, OWN-04, OWN-05.
- **Qaror:** D-18 (ism bilan kelgan mijoz — har doim yangi; `Idempotency-Key` — UUID va user’ga bog‘liq; barcha yetmayotgan qatorlar bitta xabarda; sotuvni tahrirlash/bekor qilish/qaytarish yo‘q — D-03; ADMIN istalgan faol ombordan) — biznes egasi tomonidan **tasdiqlangan** (2026-10-22), har bir band testlangan (BUSINESS-RULES D-18 "Tekshiruv" ustuni). Migratsiya yo‘q.

## 7.8. Phase 11 (Expenses) xulosasi

- **TESTED:** REQ-100, REQ-101; BUSINESS-RULES: BR-31 (xarajat kategoriyasi — soft-delete qilingan xarajat ham band qiladi), BR-32, BR-33 (o‘chirish tasdiqlash bilan); D-11 (holat yo‘q), D-12 (sotuvchi faqat qo‘shadi), D-19 (1)–(5).
- **Migratsiya:** `20261023100000_expenses_drop_status` — `expenses.status` va `expense_status` olib tashlandi, `category_id` NOT NULL saqlandi; eski migratsiyalar o‘zgarmadi.
- **Doiradan tashqari:** `/reports/expenses`, `finance-summary`, dashboard — Phase 12.

## 7.9. Phase 12 (Reports + Dashboard + Settings) xulosasi

- **TESTED:** REQ-030, REQ-031, REQ-090, REQ-092, REQ-102, REQ-103, REQ-110, REQ-111 (sana filtri, pagination); AC-17, AC-24; OWN-06 (hisobotlarda tannarx), OWN-08 (sotuvchi dashboard'i); D-20; D-21 (1)–(6).
- **REQ-167:** hisobotlar qismi 1 mln sotuvli benchmark bilan o‘lchandi (DATABASE §7.2); API p95 < 300 ms — yuklama testi Phase 15 da.
- **Qarorlar:** D-20, D-21 — biznes egasi tomonidan **tasdiqlangan**. D-13, D-14, D-15 hali **tasdiqlanmagan**.
- **Migratsiya yo‘q.** Sozlamalar mavjud `settings` jadvalidagi 3 ta kalitda.
- **Doiradan tashqari:** CSV/XLSX export (faqat arxitektura), audit jurnali (Phase 13).

## 7.10. Phase 13 (Audit) xulosasi

- **TESTED:** REQ-120, REQ-121, REQ-122; AC-21, AC-22; BUSINESS-RULES: BR-24 (audit amal bilan bitta tranzaksiyada — muvaffaqiyatsiz mutatsiya audit qoldirmaydi), BR-25 (endpoint yo‘q + trigger + DB huquqlari); D-06; D-22 (1)–(4).
- **Qarorlar:** D-22 — biznes egasi tomonidan **tasdiqlangan** (2026-10-28). D-13, D-14, D-15 hali **tasdiqlanmagan**.
- **Migratsiya yo‘q** (Phase 2 `audit_logs` jadvali va indekslari yetarli).
- **Doiradan tashqari:** audit eksporti va saqlash muddati (retention) — rejada yo‘q; `pendingBackend` tozalash — Phase 14 da bajarildi.

## 7.11. Phase 14 (Frontend integration) xulosasi

- **TESTED:** REQ-002, REQ-150…REQ-155; BR-12, BR-33 (barcha sanalgan amallar, BUSINESS-RULES §2); AC-25.
- **Topilgan va tuzatilgan:** guruhni arxivlash va xarajat kategoriyasini nofaol qilish tasdiqsiz edi (BR-33); omborlar sahifasi 100 tadan keyingisini jimgina kesardi; bosh sahifa panellari, POS va mahsulot tanlovida yuklash xatosi "bo‘sh"/"topilmadi"/"ombor biriktirilmagan" bo‘lib ko‘rinardi (kam qoldiq paneli xatoda "hammasi yetarli" derdi); 4 ta forma xabari lug‘atdan tashqarida edi.
- **Bundle:** boshlang‘ich yuklama ~216 → ~190 KB gzip (zod boshlang‘ich chunk'dan chiqdi; recharts bosh sahifada alohida chunk).
- **Olib tashlandi:** `pendingBackend` (biznes egasi roziligi bilan, 2026-10-29) — xatti-harakat o‘zgarmadi.
- **Ochiq xavfsizlik masalasi:** SEC-01 (SECURITY §15.1) — login maydoniga yozilgan parol noma’lum login sifatida auditda qolishi mumkin; backend audit siyosati, Phase 14 doirasidan tashqari, qaror kerak.
- **Cheklov (hujjatlashtirildi):** filtr va forma tanlov ro‘yxatlari (`useWarehouses`, `useGroupOptions`, `useUserOptions`) birinchi 100 ta yozuvni oladi (API `pageSize` ≤ 100); filtr ro‘yxati yuklanmasa, filtrda faqat "Barchasi" qoladi (forma ro‘yxatlarida — xato ko‘rsatiladi).
- **Migratsiya yo‘q.** D-13, D-14, D-15 hali **tasdiqlanmagan** (Phase 14 ga bevosita ta’sir qilmaydi).
- **Doiradan tashqari:** eksport, mijoz filtri — rejada yo‘q.

## 7.12. Phase 15 (Testing + Performance) xulosasi

- **TESTED:** REQ-172, REQ-167 (API p95 < 300 ms yuklama ostida + hisobotlar < 2 s), AC-18 (RBAC matritsasi). Barcha AC-01…AC-27 — TESTED.
- **Testlar (2026-10-30):** unit — shared 193, backend 177, frontend 162; `test:db` — 357; coverage to‘plami (backend unit + DB) — 534; Playwright E2E — 7/7; `qa:ui` — muammo yo‘q; `qa:interactions` — 39/39; `bench:reports` — 22/22; `bench:load` — 2/2.
- **Coverage:** domain — shared 98,67 / 96,49 / 98,78 / 99,25, backend 99,41 / 96,91 / 100 / 100, frontend 98,22 / 93,10 / 100 / 100; service 98,63 / 90,14 / 100 / 99,88 (statements / branches / functions / lines; TESTING §4).
- **Topilgan va tuzatilgan:** (1) shtrix-kod ketma-ket tez skanerlansa kirimda qator ustidan yozilardi, kassada savatga faqat oxirgisi tushardi (E2E topdi; navbat + regressiya testlari); (2) `GET /sales` — 1 mln sotuvda p95 ~2,5 s (`count(*) OVER ()` LIMIT’dan oldin to‘liq hisob) → 0,18 s; (3) `GET /products` — p95 ~1,6 s (yig‘malar barcha mahsulotlar bo‘yicha) → 0,15 s. Javob shakllari o‘zgarmadi, migratsiya yo‘q.
- **Benchmark tarixi:** `backend/test/bench/results/*.json` (muhit, ma’lumot hajmi, usul, raqamlar); Phase 12 hisobotlar baseline’i hujjatdan ko‘chirilgan; bitta oraliq yuklama o‘lchovi yaroqsiz deb belgilangan (`note`), o‘chirilmagan.
- **Ochiq xavfsizlik masalasi:** SEC-01 (SECURITY §15.1) Phase 15 rejasiga kirmaydi → DEVELOPMENT-PLAN Phase 16 da majburiy band sifatida bog‘landi.
- **Qoldirildi:** D-13, D-14, D-15 Phase 15 ga bevosita ta’sir qilmaydi — tasdiqlanmagan holda qoladi.
- **Ma’lum chegara:** sotuvchining kassa katalogi (`sort=sold:desc`) ombordagi barcha sotuv qatorlarini yig‘adi — ko‘p yillik tarixli omborda o‘lchanmagan (TESTING §5.2).

## 7.13. Phase 16 (Security review) xulosasi

- **TESTED:** REQ-144, REQ-163, REQ-164, REQ-166; SEC-01 — **yopildi** (SECURITY §15.1).
- **SECURITY §18 checklist'i:** 10/11 band bajarildi; backup va tiklash — rejaga ko‘ra Phase 17. Har bir band va talab → test: SECURITY §17 "Phase 16" jadvali.
- **Topilgan va tuzatilgan:** (1) SEC-01; (2) production web image `VITE_API_MODE`siz — brauzer ichidagi mock API bilan yig‘ilardi (A05); (3) biznes javoblarida `Cache-Control: no-store` yo‘q edi; (4) `pnpm audit --prod` — 3 high, 2 moderate, 2 low → 0. Har biri uchun test avval eski kodda yiqildi.
- **Testlar (2026-10-30):** unit — shared 193, backend 182, frontend 164; `test:db` — 379 (+22: SEC-01 4, leaks 4, hardening 7, fuzz 7); Playwright E2E — 8; `qa:ui` — muammo yo‘q; `qa:interactions` — 39.
- **Eski audit yozuvlari o‘zgarmadi** (migratsiya yo‘q; test DB qatorni o‘qib, o‘zgarmaganini tekshiradi).
- **Qolgan xavflar:** SECURITY §19 (deepmerge-ts dev-only high; eski qatorlarda xom qiymat DB darajasida; dev compose — superuser, read_only yo‘q, web HSTS yo‘q → Phase 17).
- **Qoldirildi:** D-13, D-14, D-15 Phase 16 ga ta’sir qilmaydi — tasdiqlanmagan holda qoladi.

## 8. Phase 2 (Database) traceability: REQ → jadval → maydon / constraint / index → test

Testlar `backend/test/db/` da (`pnpm test:db`, real PostgreSQL 18).

| REQ / BR | Jadval | Maydon / constraint / index / trigger | Test |
|---|---|---|---|
| REQ-010, 011, A-01 | `roles`, `permissions`, `role_permissions` | `roles.code` UNIQUE, `permissions_code_format`, seed sinxronizatsiyasi | `seed.db-spec.ts` |
| REQ-022, BR-03 | `users` | `users_login_format` CHECK `^[A-Za-z0-9]{3,32}$` | `constraints.db-spec.ts` — "login qoidasiga zid" (6 holat) |
| REQ-023, REQ-162 | `users` | `users_login_lower_key` UNIQUE `lower(login)` | `constraints.db-spec.ts` — "takroriy login" |
| REQ-025 | `users` | `password_hash` NN + `users_password_hash_format` | `constraints.db-spec.ts` — "ochiq parol rad etiladi" |
| REQ-027 | `user_sessions` | `token_hash` UNIQUE, `family_id`, `replaced_by_id` UNIQUE (SET NULL), revoked CHECK'lari | `constraints.db-spec.ts`, `migrations.db-spec.ts` |
| D-04 | `user_warehouses` | PK `(user_id, warehouse_id)`, FK RESTRICT | `constraints.db-spec.ts`, `relationships.db-spec.ts` |
| REQ-040 | `warehouses` | `warehouses_name_lower_key`, `(status)` | `constraints.db-spec.ts` |
| REQ-043 | `warehouse_stock` | PK `(warehouse_id, product_id)`, `(product_id)` | `constraints.db-spec.ts`, `relationships.db-spec.ts` |
| REQ-050, A-13 | `products` | CHECK'lar (nom, narxlar, NaN, `products_unit_decimal_policy`), `group_id` FK RESTRICT | `constraints.db-spec.ts`, `relationships.db-spec.ts` |
| REQ-051, BR-10, D-05, D-09 | `products` | `products_barcode_key` UNIQUE (NULL ko‘p), `products_barcode_format` | `constraints.db-spec.ts`, `historical-integrity.db-spec.ts` |
| REQ-052 | `product_groups` | `product_groups_name_lower_key`; mahsulotli guruh o‘chmaydi (RESTRICT) | `constraints.db-spec.ts`, `historical-integrity.db-spec.ts` |
| REQ-054, REQ-081 | `products`, `customers` | GIN trgm `products_name_trgm_idx`, `customers_name_trgm_idx`, `customers_phone_idx` | `migrations.db-spec.ts` |
| REQ-060, 061, A-09 | `incoming`, `incoming_items` | `(incoming_id, product_id)` UNIQUE, `quantity > 0`, snapshot (D-08) | `constraints.db-spec.ts`, `relationships.db-spec.ts` |
| REQ-062, 065, BR-11, AC-07 | `incoming` | `incoming_guard`: tasdiqlashda totallar = Σ qatorlar (50+30+100+20 = 200) | `inventory.db-spec.ts` — "TZ §7 misoli", "totallar … mos bo‘lmasa" |
| REQ-063 | `incoming_items` | `line_total` GENERATED `round(quantity * cost_price, 2)` | `relationships.db-spec.ts`, `migrations.db-spec.ts` |
| REQ-064, BR-08 | `incoming`, `warehouse_stock`, `inventory_movements` | `incoming_confirmed_ledger` (DEFERRED), `inventory_movements_validate` | `inventory.db-spec.ts` |
| A-24, D-07 | `incoming`, `incoming_items` | `incoming_guard`, `incoming_items_guard` (`DV002`), CONFIRMED/CANCELLED juft CHECK'lari | `immutability.db-spec.ts` |
| REQ-074, BR-05, BR-06, A-23 | `customers`, `sales` | `customers_name_not_blank`, `customers_phone_format`, `sales_customer_name_not_blank` | `constraints.db-spec.ts` |
| REQ-075, 076, BR-09 | `sales`, `sale_items` | Snapshot'lar, `line_total`/`line_cost` GENERATED, `sales_consistency`/`sale_items_consistency` (DEFERRED) | `inventory.db-spec.ts`, `historical-integrity.db-spec.ts`, `relationships.db-spec.ts` |
| REQ-077, REQ-161, BR-07, AC-13 | `warehouse_stock` | `warehouse_stock_quantity_non_negative` CHECK + shartli UPDATE + row lock | `inventory.db-spec.ts` — "20 ta parallel sotuv", "qoldiqdan ko‘p sotib bo‘lmaydi" |
| REQ-080 | `customers` | `purchase_count`, `total_spent`, `last_purchase_at` + `reconcile_customer_aggregates` | `inventory.db-spec.ts` — reconciliation |
| REQ-090, 092 | barcha | DATABASE §7.1 index katalogi | `migrations.db-spec.ts` — "asosiy so‘rov indexlari" |
| REQ-100, A-10, A-27 | `expenses`, `expense_categories` | `expenses_amount_positive`, `expenses_deleted_consistency`, `status` DEFAULT `PAID`, partial `expenses_expense_date_active_idx` | `constraints.db-spec.ts`, `relationships.db-spec.ts` |
| REQ-102, D-02 | `sale_items` | `unit_cost` snapshot, `line_cost` GENERATED; foyda = `line_total − line_cost` | `inventory.db-spec.ts`, `historical-integrity.db-spec.ts` |
| REQ-120, 121 | `audit_logs` | actor FK (NULL = tizim), `action`/`entity_type` format, `metadata` obyekt, 4 ta index | `relationships.db-spec.ts`, `constraints.db-spec.ts` |
| REQ-122, D-06, AC-22 | `audit_logs` | `audit_logs_immutable`, `audit_logs_no_truncate` (`DV001`), `divine_app`: faqat SELECT/INSERT | `immutability.db-spec.ts` |
| REQ-130 | 20 jadval | `20261008100000_init` … `20261008100400_app_role_and_grants` | `migrations.db-spec.ts` — "20 ta jadval", drift, takroriy deploy |
| REQ-131 | barcha | PK/FK/UNIQUE/CHECK; CASCADE/SET NULL ro‘yxati qotirilgan | `migrations.db-spec.ts` — "FK delete strategiyasi" |
| REQ-132, INV-1…7, AC-23 | `inventory_movements`, `warehouse_stock` | Immutable ledger, `inventory_movements_validate`, `warehouse_stock_matches_ledger`, 4 ta `reconcile_*` view | `inventory.db-spec.ts`, `immutability.db-spec.ts` |
| REQ-133 | pul/miqdor ustunlari | `NUMERIC(18,2)`, `NUMERIC(14,3)`, `<> 'NaN'` CHECK'lari | `constraints.db-spec.ts` — "noto‘g‘ri pul qiymati" |
| REQ-145 | `sales`, `inventory_movements` | `sales_idempotency_key_key`, `UNIQUE(reference_type, reference_item_id)` | `constraints.db-spec.ts`, `inventory.db-spec.ts` |
| REQ-160 | `sales`, `incoming` | Deferred to‘liqlik trigger'lari | `inventory.db-spec.ts` |
| REQ-165 | DB | `ALTER DATABASE … SET timezone = 'UTC'`, ulanish `timezone=UTC`, `timestamptz(3)` | `migrations.db-spec.ts` |
| D-03 | `inventory_movements`, `sales` | Zaxira `movement_type`lar (trigger hozircha rad etadi), `sale_status` kengayadigan enum | `inventory.db-spec.ts` — "zaxira harakat turlari" |
| D-08 | `sale_items`, `incoming_items` | `product_name`, `barcode` snapshot | `historical-integrity.db-spec.ts` |

## 9. Phase 2 xulosasi

- **TESTED:** REQ-043, REQ-130, REQ-131.
- **IMPLEMENTED** (DB qatlami testlangan, API/service qismi keyingi phase'larda): REQ-092, REQ-122, REQ-132, REQ-133, REQ-161, REQ-162.
- **Phase 2 hissasi bor (status PLANNED):** REQ-010, 011, 022, 023, 025, 040, 050, 051, 054, 060, 061, 063, 064, 065, 074, 076, 077, 080, 100, 102, 121, 145, 160, 164, 165, 171, 172.
- DB testlari: 7 fayl, 99 ta test (`pnpm test:db`).

## 10. Phase 3 (Backend foundation) traceability

| REQ | Implementatsiya (`backend/src/…`) | Test |
|---|---|---|
| REQ-143, REQ-002 | `common/errors/app-error.ts`, `error-status.ts`, `common/filters/global-exception.filter.ts` | `foundation.e2e-spec.ts` — "yagona xato strukturasi", "noma’lum xato" |
| REQ-143, REQ-131 | `common/errors/database-errors.ts` (DATABASE §12) | `database-errors.spec.ts` (jadval), `error-mapping.db-spec.ts` (real PG), e2e "DB xatolari mapping" |
| REQ-142, REQ-152 | `common/validation/zod-validation.pipe.ts` | e2e "Zod validatsiyasi" — body, query, params |
| REQ-091, REQ-090 | `common/query/list-query.ts`, `prisma-query.ts` | e2e "pagination", "saralash", "filtrlar"; `query.spec.ts` |
| REQ-165 | `common/time/tashkent-time.ts` | `tashkent-time.spec.ts` (Toshkent, Berlin DST, Santiago, tarixiy offset) |
| REQ-160, REQ-141 | `infrastructure/prisma/transaction-runner.ts` | `transaction-runner.spec.ts`, `transaction-runner.db-spec.ts` (commit, rollback, timeout, DEFERRED, deadlock) |
| REQ-168, REQ-163 | `common/http/request-id.ts`, `infrastructure/logger/logger.options.ts`, `common/errors/error-log.ts` | e2e "request ID", "xavfsizlik" |
| REQ-164, REQ-169 | `common/throttling/*`, `bootstrap/configure-app.ts` (body 1 MB) | e2e "rate limit", 413; `redis-throttler.db-spec.ts` |
| REQ-166 | `eslint.config.js` (`no-restricted-properties`) | lint probe |
| REQ-140 | `common/swagger/api-schemas.ts`, `bootstrap/swagger.ts` | e2e "Swagger" |

## 11. Phase 3 xulosasi

- **TESTED:** REQ-143.
- **IMPLEMENTED** (foundation tayyor; har bir endpoint keyingi phase'larda undan foydalanadi): REQ-091, REQ-142, REQ-163, REQ-165, REQ-168.
- **Phase 3 hissasi bor (status o‘zgarmadi):** REQ-002, 090, 140, 141, 152, 160, 164, 166, 169.
- Biznes endpointlari (auth, users, products, …) implement qilinmagan — ular bilan bog‘liq talablar PLANNED.

