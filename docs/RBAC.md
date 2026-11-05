# Divine.uz — RBAC (Role-Based Access Control)

> **Holat:** Phase 16 — endpoint × rol matritsasi (Phase 15) va RBAC fuzz (soxta JWT, yo‘l variantlari, method-override), brauzerdagi ruxsatsiz urinishlar testlangan (§7). Phase 5 — Users endpointlari (`users.read` / `users.manage`) va self-protection implement qilingan va testlangan. Phase 4 — guard'lar, dekoratorlar, `AccessContext`, ownership helper'lari, "himoyasiz endpoint yo‘q" auditori va frontend navigatsiya/route guard'i **implement qilingan va testlangan**. Har bir biznes endpoint'ining permission'i, ownership va maydon himoyasi — o‘z modul phase'ida (5+). Biznes egasi qarori D-12: USER'ga `expenses.create`.
> Kodda yagona manba: `shared/src/permissions/index.ts` (`Permission`, `ROLE_PERMISSIONS`).
> TZ: §2, §3, §15, §18. REQ: REQ-010, REQ-011, REQ-012, REQ-020, REQ-144.

---

## 1. Model

```
users ──*:1── roles ──*:*── permissions       (role_permissions)
users ──*:*── warehouses                      (user_warehouses — ownership, D-04)
```

- Har bir user'da **bitta rol** bo‘ladi: `ADMIN` yoki `USER`.
- Ruxsat **permission** darajasida tekshiriladi. Kodda rol nomi bo‘yicha `if (role === 'ADMIN')` tekshiruvi qilinmaydi.
- `roles`, `permissions`, `role_permissions` faqat seed va migratsiya orqali o‘zgaradi (UI orqali emas). Manba: `ROLE_PERMISSIONS`.
- **Deny by default:** permission berilmagan har qanday amal taqiqlangan.

### 1.1. Rollar

| Rol | Kim | TZ ta’rifi |
|---|---|---|
| `ADMIN` | Biznes egasi yoki menejer | Users, groups, products, warehouses, incoming, inventory, sales, customers, expenses, reports, settings va audit'ga to‘liq kirish |
| `USER` | Sotuvchi yoki kassir | Sotuv jarayoni va faqat **aniq ruxsat berilgan** o‘qish operatsiyalari |

**Muhim istisnolar (ADMIN uchun ham):**
- **Audit jurnali o‘zgarmaydi** (D-06): ADMIN faqat o‘qiydi.
- **Tasdiqlangan kirim va sotuv o‘zgarmaydi** (D-07): "full CRUD" faqat DRAFT kirimga taalluqli.
- ADMIN **o‘zini** bloklay olmaydi va o‘z rolini o‘zgartira olmaydi (`CANNOT_MODIFY_SELF`). Tizimda kamida bitta ACTIVE ADMIN qolishi shart.

---

## 2. Permission katalogi

| Permission | Tavsif (UI, o‘zbekcha) | ADMIN | USER |
|---|---|:-:|:-:|
| `users.read` | Userlar ro‘yxatini ko‘rish | ✅ | ❌ |
| `users.manage` | User yaratish, tahrirlash, bloklash, parolni yangilash, omborga biriktirish | ✅ | ❌ |
| `product_groups.read` | Mahsulot guruhlari ro‘yxati (filtr uchun) | ✅ | ✅ |
| `product_groups.manage` | Guruh yaratish, tahrirlash, o‘chirish | ✅ | ❌ |
| `products.read` | Mahsulotlarni qidirish va ko‘rish (sotuv narxi, qoldiq) | ✅ | ✅ ⚠️ |
| `products.read_cost` | Kelgan narxi (`costPrice`), mahsulot tushumi va foydasi (`/summary`) | ✅ | ❌ |
| `products.manage` | Mahsulot yaratish, tahrirlash, arxivlash | ✅ | ❌ |
| `warehouses.read` | Biriktirilgan omborlar ro‘yxati | ✅ | ✅ ⚠️ |
| `warehouses.read_all` | Barcha omborlar, ombor detali, harakatlar | ✅ | ❌ |
| `warehouses.manage` | Ombor yaratish, tahrirlash, faolsizlantirish | ✅ | ❌ |
| `inventory.read` | Inventar harakatlari (ledger) | ✅ | ❌ |
| `inventory.reconcile` | Qoldiq va ledger solishtiruvi | ✅ | ❌ |
| `incoming.read` | Kirimlarni ko‘rish | ✅ | ❌ |
| `incoming.manage` | Kirim yaratish, tahrirlash (DRAFT), bekor qilish | ✅ | ❌ |
| `incoming.confirm` | Kirimni tasdiqlash (stock ↑) | ✅ | ❌ |
| `sales.create` | Sotuv yaratish | ✅ | ✅ |
| `sales.read_own` | O‘z sotuvlarini ko‘rish | ✅ | ✅ |
| `sales.read_all` | Barcha sotuvlarni ko‘rish | ✅ | ❌ |
| `customers.read` | Mijozlarni qidirish (sotuv uchun) | ✅ | ✅ ⚠️ |
| `customers.create` | Mijoz yaratish (sotuv vaqtida) | ✅ | ✅ |
| `customers.manage` | Mijozni tahrirlash | ✅ | ❌ |
| `customers.read_history` | Mijoz xarid tarixi va yig‘ma ma’lumotlari | ✅ | ❌ |
| `expenses.read` | Xarajatlarni ko‘rish | ✅ | ❌ |
| `credits.manage` | Nasiya: ko‘rish, qo‘shish va to‘lov yozish (D-24) | ✅ | ❌ |
| `expenses.create` | Xarajat qo‘shish; **o‘zi qo‘shgan** xarajatlarni ko‘rish va o‘ziga kategoriya qo‘shish/o‘qish (`id, name`) — D-23 | ✅ | ✅ |
| `expenses.manage` | Xarajat va kategoriyalarni boshqarish | ✅ | ❌ |
| `reports.read` | Barcha hisobotlar | ✅ | ❌ |
| `dashboard.admin` | Admin dashboard KPI'lari | ✅ | ❌ |
| `dashboard.own` | O‘zining bugungi sotuv ko‘rsatkichlari | ✅ | ✅ |
| `audit.read` | Audit jurnalini ko‘rish | ✅ | ❌ |
| `settings.read` | Sozlamalarni ko‘rish | ✅ | ❌ |
| `settings.manage` | Sozlamalarni o‘zgartirish | ✅ | ❌ |

⚠️ — ownership yoki maydon cheklovi bilan (§6).

---

## 3. Endpoint × permission matritsasi

Barcha yo‘llar `/api/v1` prefiksi bilan. To‘liq contract: [API.md](API.md).

| Modul | Method + yo‘l | Permission | ADMIN | USER |
|---|---|---|:-:|:-:|
| Health | `GET /health` | public | ✅ | ✅ |
| Auth | `POST /auth/login` | public (rate limit) | ✅ | ✅ |
| Auth | `POST /auth/refresh` | public (refresh cookie) | ✅ | ✅ |
| Auth | `POST /auth/logout`, `GET /auth/me` | autentifikatsiya | ✅ | ✅ |
| Users | `GET /users`, `GET /users/:id` | `users.read` | ✅ | ❌ |
| Users | `GET /users/warehouse-options` | `users.manage` | ✅ | ❌ |
| Users | `POST /users`, `PATCH /users/:id`, `PATCH /users/:id/status`, `POST /users/:id/reset-password`, `PUT /users/:id/warehouses` | `users.manage` | ✅ | ❌ |
| Product groups | `GET /product-groups` | `product_groups.read` | ✅ | ✅ |
| Product groups | `GET /product-groups/:id`, `POST`, `PATCH /:id`, `DELETE /:id` | `product_groups.manage` | ✅ | ❌ |
| Products | `GET /products`, `GET /products/lookup`, `GET /products/:id` | `products.read` | ✅ | ✅ ⚠️ (faqat ACTIVE, biriktirilgan omborlar bo‘yicha miqdor, `costPrice` kalitisiz; `sort=costPrice` → 400) |
| Products | `GET /products/:id/summary` (Phase 6); `GET /products/:id/sales` (Phase 10) | `products.read_cost` | ✅ | ❌ |
| Products | `POST /products`, `PATCH /products/:id`, `PATCH /products/:id/status` | `products.manage` | ✅ | ❌ |
| Warehouses | `GET /warehouses` | `warehouses.read` | ✅ (hammasi, ko‘rsatkichlar bilan; `stockValue` — `products.read_cost`) | ✅ ⚠️ (faqat biriktirilgan ACTIVE, ko‘rsatkichlarsiz — OWN-01) |
| Warehouses | `GET /warehouses/:id`, `GET /warehouses/:id/stock`, `GET /warehouses/:id/movements` | `warehouses.read_all` (narx maydonlari va `sort=stockValue` — qo‘shimcha `products.read_cost`) | ✅ | ❌ (o‘z ombori ham) |
| Warehouses | `POST /warehouses`, `PATCH /warehouses/:id`, `PATCH /warehouses/:id/status` | `warehouses.manage` | ✅ | ❌ |
| Inventory | `GET /inventory/movements` | `inventory.read` | ✅ | ❌ |
| Inventory | `GET /inventory/reconciliation` | `inventory.reconcile` | ✅ | ❌ |
| Incoming | `GET /incoming`, `GET /incoming/:id` | `incoming.read` (ombor doirasi — `warehouseScope`; narx maydonlari va `sort=totalAmount` — qo‘shimcha `products.read_cost`) | ✅ | ❌ |
| Incoming | `POST /incoming`, `PATCH /incoming/:id`, `POST /incoming/:id/cancel` | `incoming.manage` (+ ombor ruxsati va ACTIVE — `assertOperationalWarehouse`) | ✅ | ❌ |
| Incoming | `POST /incoming/:id/confirm` | `incoming.confirm` (+ ombor ruxsati va ACTIVE) | ✅ | ❌ |
| Sales | `POST /sales` | `sales.create` (+ ombor ruxsati va ACTIVE — `assertOperationalWarehouse`) | ✅ (istalgan faol ombor) | ✅ ⚠️ (faqat biriktirilgan ombor; javobda tannarx yo‘q) |
| Sales | `GET /sales`, `GET /sales/:id` | `sales.read_all` **yoki** `sales.read_own` (tannarx/foyda — qo‘shimcha `products.read_cost`) | ✅ (hammasi) | ✅ ⚠️ (o‘ziniki; begona → 404; `userId` filtri e’tiborsiz) |
| Customers | `GET /customers` | `customers.read` | ✅ (to‘liq) | ✅ ⚠️ (faqat `id, name, phone`; `sort=totalSpent/purchaseCount` → 400) |
| Customers | `POST /customers` | `customers.create` (`notes` — qo‘shimcha `customers.manage`) | ✅ | ✅ ⚠️ (izohsiz; javob minimal) |
| Customers | `GET /customers/:id`, `GET /customers/:id/purchases` | `customers.read_history` (tannarx/foyda — qo‘shimcha `products.read_cost`) | ✅ | ❌ |
| Customers | `PATCH /customers/:id` | `customers.manage` | ✅ | ❌ |
| Expenses | `GET /expenses`, `GET /expenses/:id` | `expenses.read` | ✅ | ❌ |
| Expenses | `GET /expense-categories` | `expenses.read`, `expenses.create` yoki `expenses.manage` (`@RequireAnyPermission`, D-19) | ✅ (hammasi, holat va xarajatlar soni bilan) | ✅ (faqat faollari, `{ id, name }`) |
| Expenses | `POST /expenses` | `expenses.create` yoki `expenses.manage` (`@RequireAnyPermission`, D-12) | ✅ | ✅ (javobda faqat o‘zi yaratgan yozuv) |
| Expenses | `PATCH /expenses/:id`, `DELETE /expenses/:id`, `POST /expense-categories`, `PATCH /expense-categories/:id`, `DELETE /expense-categories/:id` | `expenses.manage` | ✅ | ❌ |
| Reports | `GET /reports/*` (9 ta) | `reports.read` | ✅ | ❌ |
| Dashboard | `GET /dashboard/summary` | `dashboard.admin` | ✅ | ❌ |
| Dashboard | `GET /dashboard/my-summary` | `dashboard.own` | ✅ | ✅ |
| Audit | `GET /audit-logs`, `GET /audit-logs/:id` | `audit.read` | ✅ | ❌ |
| Audit | o‘zgartirish / o‘chirish | **endpoint yo‘q** | ❌ | ❌ |
| Settings | `GET /settings` | `settings.read` | ✅ | ❌ |
| Settings | `PATCH /settings` | `settings.manage` | ✅ | ❌ |

### 3.1. UI navigatsiyasi (TZ §16) × rol

| Bo‘lim | Yo‘l | Ko‘rinish sharti (`anyOf`) | ADMIN | USER |
|---|---|---|:-:|:-:|
| Bosh sahifa | `/` | `dashboard.admin`, `dashboard.own` | ✅ (admin KPI) | ✅ (o‘z ko‘rsatkichlari) |
| Userlar | `/users` | `users.read` | ✅ | ❌ |
| Mahsulotlar | `/products` | `products.read` | ✅ | ✅ (faqat o‘qish, kelgan narxisiz: ustun, tafsilot va qo‘shish/amallar yo‘q) |
| Mahsulot guruhlari | `/product-groups` | `product_groups.manage` | ✅ | ❌ |
| Ombor | `/warehouses` | `warehouses.read_all` | ✅ | ❌ |
| Sotuvlar | `/sales` | `sales.create`, `sales.read_own`, `sales.read_all` | ✅ | ✅ |
| Mijozlar | `/customers` | `customers.read_history` | ✅ | ❌ |
| Kirim | `/incoming` | `incoming.read` | ✅ | ❌ |
| Xarajatlar (D-01, D-11, D-12, D-19) | `/expenses` | `expenses.read`, `expenses.create` | ✅ (tahrirlash, o‘chirish, "Kategoriyalar" — `expenses.manage`) | ✅ (faqat "Xarajat qo‘shish" faol kategoriya bilan: ro‘yxat, summa, tahrirlash yo‘q) |
| Hisobotlar | `/reports` | `reports.read` | ✅ | ❌ |
| Sozlamalar (+ Audit jurnali bo‘limi) | `/settings` | `settings.read` | ✅ | ❌ |

Manba: `frontend/src/app/navigation.ts` (test: `navigation.test.ts` — ADMIN 11 ta bo‘lim, USER 4 ta: Bosh sahifa, Sotuvlar, Mahsulotlar, Xarajatlar).

---

## 4. Backend permission tekshiruvi

Backend — **yagona xavfsizlik chegarasi**. Frontend tekshiruvi faqat UX uchun.

### 4.1. Qatlamlar

```
So‘rov
  │
  ├─ 0. AccessTokenMiddleware (barcha route'lar)
  │     • Bearer token imzosi/exp/iss/aud tekshiriladi (DB'siz) → req.authToken = { sub, role, iat }
  │     • faqat throttler user bo‘yicha hisoblashi uchun; ruxsat bermaydi
  │
  ├─ 1. AppThrottlerGuard (GLOBAL, 1-guard) — API §1.5
  │
  ├─ 2. JwtAuthGuard (GLOBAL, 2-guard)
  │     • @Public() bo‘lmagan har bir endpoint token talab qiladi (deny by default)
  │     • JWT: imzo, exp, iss, aud; iat >= users.password_changed_at
  │     • user DB'dan PK bo‘yicha olinadi: status ACTIVE bo‘lishi shart (bloklash darhol ishlaydi)
  │     • AccessContext hosil qilinadi va so‘rovga biriktiriladi:
  │         { userId, login, role, permissions: Set<Permission>, warehouseIds: Set<string>, issuedAt }
  │       permissions — role_permissions'dan (rol bo‘yicha 60 s keshlanadi)
  │       warehouseIds — user_warehouses'dan (har so‘rovda, PK index)
  │     ✗ → 401 UNAUTHENTICATED / SESSION_EXPIRED / ACCOUNT_BLOCKED
  │
  ├─ 3. PermissionsGuard (GLOBAL, 3-guard)
  │     • @Authenticated()             → faqat login talab qilinadi (masalan, GET /auth/me)
  │     • @RequirePermissions(a, b)    → AND
  │     • @RequireAnyPermission(a, b)  → OR (masalan, sales.read_all | sales.read_own)
  │     • decorator'siz endpoint → RouteSecurityAuditor ilova ishga tushishida xato beradi
  │     ✗ → 403 FORBIDDEN
  │
  ├─ 4. Service (ownership va biznes darajasidagi ruxsat)
  │     • ctx har bir service metodiga parametr sifatida uzatiladi (@Ctx())
  │     • helper'lar: canAccessWarehouse, assertWarehouseAccess, warehouseScope, ownerScope (§6)
  │     ✗ → 404 NOT_FOUND (begona resurs) yoki 403 WAREHOUSE_ACCESS_DENIED
  │
  ├─ 5. Repository
  │     • USER uchun so‘rov filtrlari majburan qo‘yiladi (WHERE user_id = :ctx.userId)
  │
  └─ 6. Response mapper
        • maydonlar permission bo‘yicha: products.read_cost bo‘lmasa costPrice, totalCost,
          profit maydonlari javobda UMUMAN bo‘lmaydi (null emas — yo‘q)
```

Guard tartibi `AuthModule`da aniq ro‘yxat bilan belgilangan (throttler → JWT → permission). Kod: `backend/src/common/auth/` (dekoratorlar, `AccessContext`, `PermissionsGuard`, `RouteSecurityAuditor`), `backend/src/modules/auth/` (`JwtAuthGuard`, `AccessTokenMiddleware`).

### 4.2. Kod namunasi

```ts
@Controller('sales')
export class SalesController {
  @Post()
  @RequirePermissions(Permission.SALES_CREATE)
  create(@Ctx() ctx: AccessContext, @ZodBody(createSaleSchema) dto: CreateSaleDto) {
    return this.sales.create(ctx, dto);               // assertWarehouseAccess(ctx, dto.warehouseId)
  }

  @Get()
  @RequireAnyPermission(Permission.SALES_READ_ALL, Permission.SALES_READ_OWN)
  list(@Ctx() ctx: AccessContext, @ZodQuery(listSalesQuerySchema) q: ListSalesQuery) {
    return this.sales.list(ctx, q);                    // ownerScope(ctx, …) — USER bo‘lsa userId majburan
  }
}
```

### 4.3. Javob kodlari siyosati

| Holat | Kod |
|---|---|
| Token yo‘q yoki yaroqsiz | `401 UNAUTHENTICATED` |
| Refresh muddati tugagan yoki bekor qilingan | `401 SESSION_EXPIRED` |
| User bloklangan | `401 ACCOUNT_BLOCKED` (login'da `403`) |
| Permission yo‘q | `403 FORBIDDEN` |
| Begona resurs (masalan, boshqa user'ning sotuvi) | `404 NOT_FOUND` — resurs mavjudligi oshkor qilinmaydi |
| Biriktirilmagan omborga sotuv | `403 WAREHOUSE_ACCESS_DENIED` |

---

## 5. Frontend permission tekshiruvi

Frontend tekshiruvi — **faqat UX**: foydalanuvchi qila olmaydigan narsani ko‘rmaydi. U xavfsizlik chegarasi emas. Har bir amal backendda qayta tekshiriladi.

| Mexanizm | Tavsif | Phase |
|---|---|---|
| `GET /auth/me` | `CurrentUser { role, permissions[], warehouseIds[] }` — ilova ochilganda va refresh'dan keyin | 4 |
| `usePermissions()` / `useHasAnyPermission([...])` | Komponentlarda tugma, ustun va sahifa ko‘rinishini tanlash (masalan, Xarajatlar: `expenses.read` bo‘lmasa — faqat "Xarajat qo‘shish", D-12) | **4 ✔** |
| Navigatsiya filtri | `NAV_ITEMS[].anyOf` bo‘yicha (Sidebar) | **4 ✔** |
| Route guard | `RequireAuth` (sessiya yo‘q → `/login?redirect=…`; o‘zi chiqqan bo‘lsa — redirect'siz `/login`) + `AppLayout` dagi `SectionGate` (bo‘lim permission'i yo‘q → "Ruxsat yo‘q" sahifasi) | **4 ✔** |
| 401 bilan ishlash | Access token muddati tugasa — bitta (single-flight) refresh va so‘rovni bir marta qayta yuborish. Refresh ham yaroqsiz bo‘lsa — `/login` ("Sessiya muddati tugadi"). Tarmoq xatosi sessiya tugashi deb hisoblanmaydi | **4 ✔** |
| 403 bilan ishlash | Xato xabari ko‘rsatiladi; permission kesh eskirgan bo‘lishi mumkin, shuning uchun `/auth/me` qayta yuklanadi | **4 ✔** |
| Maydon darajasi | Javobda `costPrice` bo‘lmasa, ustun ko‘rsatilmaydi (tip: `costPrice?: MoneyString`) | 6 |

Frontendda rol nomi bo‘yicha shart yozilmaydi, faqat permission kodlari (`@divine/shared`) ishlatiladi.

---

## 6. USER ownership qoidalari

USER **faqat o‘ziga biriktirilgan omborlar** va **o‘z sotuvlari** ma’lumotlarini ko‘ra oladi.

| # | Resurs | Qoida | Amalga oshirish | Buzilganda |
|---|---|---|---|---|
| OWN-01 | Omborlar ro‘yxati | `GET /warehouses` faqat `user_warehouses` dagi va ACTIVE omborlarni, ko‘rsatkichlarsiz qaytaradi; `status`/`search` filtri doirani kengaytirmaydi | Service + repository: `WHERE id = ANY(ctx.warehouseIds) AND status = 'ACTIVE'` (**Phase 7 ✔**) | — (filtr) |
| OWN-02 | Sotuv ombori | `POST /sales` da `warehouseId ∈ ctx.warehouseIds` va ombor ACTIVE bo‘lishi shart | `InventoryService.assertOperationalWarehouse` (tranzaksiya ichida, ombor `FOR SHARE`) — **Phase 7 ✔**, `POST /sales` uni Phase 10 da chaqiradi | `403 WAREHOUSE_ACCESS_DENIED` / `422 WAREHOUSE_INACTIVE` |
| OWN-03 | Qoldiq ko‘rinishi | Mahsulot qidiruvida qoldiq faqat biriktirilgan omborlar bo‘yicha | Repository: `warehouse_stock` JOIN filtri | — (filtr) |
| OWN-04 | Sotuvlar ro‘yxati | `GET /sales` USER uchun majburan `userId = ctx.userId`; query'dagi `userId` e’tiborga olinmaydi | Service (`ownerScope`, **Phase 10 ✔**) | — (filtr) |
| OWN-05 | Sotuv detali | `GET /sales/:id` — `sale.user_id = ctx.userId` bo‘lishi shart | Service (**Phase 10 ✔**) | `404 NOT_FOUND` |
| OWN-06 | Mahsulot maydonlari | USER javobida `costPrice` yo‘q (kalit ham); `summary` yopiq; kelgan narxi bo‘yicha saralab bo‘lmaydi; arxivdagi mahsulot ko‘rinmaydi | `toProductDto` serializer + permission (**Phase 6 ✔**) | `403` / `400` / `404` |
| OWN-07 | Mijozlar | USER qidiruvda faqat `id, name, phone` ni ko‘radi; xarid tarixi, izoh va yig‘ma ma’lumotlar yopiq; yig‘ma bo‘yicha saralab bo‘lmaydi; izoh yoza olmaydi | `toCustomerDto` serializer + permission (**Phase 9 ✔**) | `403 FORBIDDEN` / `400` |
| OWN-08 | Dashboard | USER faqat `GET /dashboard/my-summary` (o‘z sotuvlari, bugun) | Permission + `WHERE user_id = ctx.userId` | `403 FORBIDDEN` |
| OWN-09 | Omborsiz USER | Biriktirilgan ombori yo‘q USER sotuv qila olmaydi; UI ogohlantiradi (kassa: "Sizga sotuv uchun faol ombor biriktirilmagan" — Phase 7) | Service | `403 WAREHOUSE_ACCESS_DENIED` |

ADMIN uchun ownership cheklovi yo‘q: `warehouses.read_all`, `sales.read_all`. ADMIN sotuv qilganda istalgan ACTIVE ombordan sotishi mumkin.

### 6.1. Self-protection (BR-27, Phase 5)

| Amal o‘z hisobi ustida | Natija | Sabab |
|---|---|---|
| Ismni o‘zgartirish | ✅ ruxsat | Xavfsiz maydon |
| O‘z omborlarini o‘zgartirish | ✅ ruxsat | ADMIN'da `warehouses.read_all` bor — kirish huquqini kengaytirmaydi |
| O‘z rolini o‘zgartirish | `403 CANNOT_MODIFY_SELF` | O‘zini oshirish/tushirish yo‘q |
| O‘zini bloklash | `403 CANNOT_MODIFY_SELF` | Tasodifiy lockout |
| O‘z parolini admin endpointi orqali tiklash | `403 CANNOT_MODIFY_SELF` | Boshqa admin tiklaydi; o‘z parolini o‘zgartirish (self-service) TZ'da yo‘q |
| Oxirgi faol ADMIN'ni USER qilish yoki bloklash (boshqa admin tomonidan, parallel holat) | `409 LAST_ACTIVE_ADMIN` | Tizim administrator'siz qolmasin |

Kim bajarayotgani faqat tasdiqlangan tokendan va DB'dan (`@Ctx()`), hech qachon body/query'dagi ID'dan aniqlanmaydi. Self-service endpoint (o‘z profili) Phase 5'da **yo‘q**.

---

## 7. RBAC testlari (Phase 4 + har bir modul)

**Phase 4'da bajarilgan (✔):**
- `backend/test/db/auth.db-spec.ts` (real PG + Redis), test probe controller orqali: anonim → `401`; USER — ruxsat etilgan permission → `200`, admin permission → `403`; ADMIN — barcha permission endpointlari → `200`; ombor ownership (OWN-02: USER faqat biriktirilgan omborga, ADMIN istalganiga); "himoyasiz endpoint yo‘q".
- AND (`@RequirePermissions(reports.read, audit.read)` — USER'da bittasi ham yo‘q → `403`), OR (`@RequireAnyPermission(sales.read_all, sales.read_own)` — USER → `200`), `@Authenticated` — o‘sha real PG + Redis testida.
- `backend/test/unit/auth/rbac.spec.ts`: `RouteSecurityAuditor` (dekoratorsiz endpoint → ilova ishga tushmaydi), ownership helper'lari (`canAccessWarehouse`, `assertWarehouseAccess`, `warehouseScope`, `ownerScope`).
- Shared: `ROLE_PERMISSIONS` — ADMIN hamma narsaga ega, USER hech bir admin permission'iga ega emas; USER'da `expenses.create` bor, `expenses.read`/`manage` yo‘q (D-12).
- Frontend: navigatsiya × rol (`navigation.test.ts`), USER admin sahifasini URL bilan ochsa "Ruxsat yo‘q" (`LoginPage.test.tsx` + brauzer QA), Xarajatlar — USER uchun faqat qo‘shish (`ExpensesPage.test.tsx`).

**Phase 5'da bajarilgan (✔):** `backend/test/db/users.db-spec.ts` (real PG + Redis) — anonim → `401`, USER → `403` barcha 8 ta users endpointida (o'zining ID'si bilan rol oshirish ham); ADMIN — barchasi; self-protection (o'z roli, holati, paroli → `403 CANNOT_MODIFY_SELF`); oxirgi faol ADMIN (parallel ikki admin — bittasi o'tadi; `users.service.spec.ts` — aniq holatlar `409 LAST_ACTIVE_ADMIN`); ombor ownership: biriktirilmagan omborga ID bilan ham `403`, biriktirish olib tashlansa o'sha token bilan keyingi so'rov darhol `403`. Frontend: o'z qatorida faqat "Tahrirlash", o'z roli tanlovi o'chirilgan (`UsersPage.test.tsx`).

**Phase 6'da bajarilgan (✔):** `backend/test/db/products.db-spec.ts` — sotuvchi: ro‘yxat, detal, lookup (ombor bilan ham), ombor filtri bilan qidiruv — `costPrice` kaliti va qiymati yo‘q; `summary` → 403; `sort=costPrice` → 400; yaratish/tahrirlash → 403; begona ombor → `403 WAREHOUSE_ACCESS_DENIED`; miqdorlar faqat biriktirilgan ombor bo‘yicha. ADMIN — hammasida `costPrice` bor. Guruhlar: sotuvchi o‘qiydi (faqat faollar), boshqara olmaydi. Frontend: `ProductsPage.test.tsx` (ustun, tafsilot, mock API pariteti) va real backend bilan brauzer E2E.

**Phase 7'da bajarilgan (✔):** `backend/test/db/warehouses.db-spec.ts` (22 test, real PG + Redis) — anonim → `401`; sotuvchi: boshqaruv, detal, qoldiq, harakatlar, inventar endpointlarida → `403` (o‘z ombori bilan ham); ro‘yxatda faqat biriktirilgan ACTIVE ombor, ko‘rsatkichlarsiz (`?status=INACTIVE`, `?search=<begona nom>` bilan ham); begona ombor `?warehouseId=` → `403 WAREHOUSE_ACCESS_DENIED`; ombor nofaol qilinsa yoki nomi o‘zgarsa — o‘sha token bilan keyingi so‘rovda kuchga kiradi; `products.read_cost`siz kontekstda `stockValue`/`costPrice`/`unitCost` kaliti yo‘q, `sort=stockValue` → 400. Frontend: `WarehousesPage.test.tsx` (mock API pariteti — OWN-01, detal 403) va real backend bilan brauzer E2E (admin va sotuvchi).

**Phase 8'da bajarilgan (✔):** `backend/test/db/incoming.db-spec.ts` (25 test, real PG + Redis) — anonim → `401`; sotuvchi (o‘z ombori ID'si bilan ham) ro‘yxat, detal, yaratish, tahrirlash, tasdiqlash, bekor qilish → `403`, javobda narx yo‘q; `warehouses.read_all`siz, faqat A omborga biriktirilgan `incoming.*` kontekstida: B omborda yaratish → `403 WAREHOUSE_ACCESS_DENIED`, B hujjati detali/tasdiqlash → `404`, ro‘yxat faqat A; `products.read_cost`siz kontekstda `costPrice`/`lineTotal`/`totalAmount` kaliti yo‘q, `sort=totalAmount` → 400. Frontend: kirim sahifasida "Kirim qo‘shish" faqat `incoming.manage`, "Tasdiqlash" faqat `incoming.confirm`; mock API pariteti (`IncomingPage.test.tsx`) va real backend brauzer E2E.

**Phase 9'da bajarilgan (✔):** `backend/test/db/customers.db-spec.ts` (16 test, real PG + Redis) — anonim → `401`; sotuvchi: qidiruv javobida faqat `id, name, phone` (izoh va yig‘malar matnda ham yo‘q), detal / xarid tarixi / tahrirlash → `403`, `sort=totalSpent|purchaseCount` → `400`, mijoz yaratish → `201` (minimal javob), izoh bilan → `403` va hech narsa yaratilmaydi; `products.read_cost`siz kontekstda xarid tarixida tannarx/foyda kaliti yo‘q. Frontend: "Mijoz qo‘shish" faqat `customers.create`, "Tahrirlash" va izoh maydoni faqat `customers.manage`; mock pariteti (`CustomersPage.test.tsx`) va real backend brauzer E2E.

**Phase 10'da bajarilgan (✔):** `backend/test/db/sales.db-spec.ts` (17 test, real PG + Redis) — anonim → `401`; biriktirilmagan ombor → `403 WAREHOUSE_ACCESS_DENIED` va hech narsa o‘zgarmaydi (ADMIN — istalgan faol ombordan); AC-19: sotuvchi begona sotuvni → `404`, ro‘yxatda faqat o‘ziniki (`?userId=` bilan ham); sotuvchi javobida (yaratish, ro‘yxat, summary) `totalCost`, `grossProfit`, `unitCost` yo‘q; kalit boshqa user bilan → `409 IDEMPOTENCY_KEY_REUSED`. Frontend: sotuvlar tarixida foyda ustuni/yig‘masi faqat `products.read_cost`, user filtri faqat `sales.read_all` + `users.read`; sotuv tafsilotida tannarx bloki kalit bo‘lsagina; mock pariteti (`SalesHistoryView.test.tsx`, `mock-api.test.ts`) va real backend brauzer E2E.

**Phase 11'da bajarilgan (✔):** `backend/test/db/expenses.db-spec.ts` (17 test, real PG + Redis) — anonim → `401` (9 ta endpoint); sotuvchi: kategoriyalar faqat faol va `{ id, name }` (`?isActive=false` bilan ham), xarajat qo‘shadi (`201`, o‘z nomidan), ro‘yxat, detal, tahrirlash, o‘chirish va kategoriya boshqaruvi → `403` va yozuv o‘zgarmaydi; ADMIN — kategoriyalar to‘liq. Frontend: tahrirlash/o‘chirish va "Kategoriyalar" faqat `expenses.manage`; sotuvchi sahifasida jadval va yig‘ma yo‘q, faol kategoriya bo‘lmasa qo‘shish tugmasi o‘chiq; mock pariteti (`ExpensesPage.test.tsx`, `mock-api.test.ts` — mock'da avval xarajat route'larida ruxsat tekshiruvi yo‘q edi) va real backend brauzer E2E (24 tekshiruv).

**Phase 12'da bajarilgan (✔):** `backend/test/db/reports.db-spec.ts` (18), `dashboard.db-spec.ts` (6), `settings.db-spec.ts` (4) — real PG + Redis: anonim → `401` (barcha hisobot, dashboard va sozlamalar endpointlari); sotuvchi: 9 ta hisobot endpointi, `dashboard/summary`, `sales-trend`, `top-products`, `GET/PATCH /settings` → `403`; `dashboard/my-summary` → `200` va faqat o‘zining bugungi sotuvlari hamda unga ruxsat etilgan **faol** omborlar (OWN-08). Tannarx (OWN-06): `products.read_cost`siz kontekstda (unit, `reports.spec.ts`) tannarx/foyda/ombor tannarxi/kirim summasi ustunlari, qiymatlari va yig‘malari yo‘q, shu ustun bo‘yicha saralash → `400`, `finance-summary`da tannarxga oid kalitlar yo‘q. Frontend: "Bosh sahifa" `dashboard.admin`siz sotuvchi ko‘rinishini ochadi (admin grafik, top va kam qoldiq so‘ralmaydi); mock pariteti — mock'da avval hisobot, dashboard va sozlamalar route'larida ruxsat tekshiruvi yo‘q edi (sotuvchi mock rejimda admin dashboard'ini ko‘rardi) — `mock-api.test.ts`, `DashboardPage.test.tsx`.

**Phase 13'da bajarilgan (✔):** `backend/test/db/audit.db-spec.ts` (7) — anonim → `401`, sotuvchi (`audit.read` yo‘q) → `403` (ro‘yxat va detal); `POST/PUT/PATCH/DELETE /audit-logs…` → `404` (ADMIN uchun ham — endpoint yo‘q, D-06) va yozuv o‘zgarmaydi; SQL bilan `UPDATE`/`DELETE` — trigger rad etadi. `audit-coverage.db-spec.ts` (4) — barcha 31 ta mutatsiya endpointi audit yozadi, actor — so‘rov egasi (xato login — `null`). Frontend: "Audit jurnali" bo‘limi faqat `audit.read` bilan ko‘rinadi va so‘raladi; mock'da ham `403` (`mock-api.test.ts`).

**Phase 15'da bajarilgan (✔):** `backend/test/db/rbac-matrix.db-spec.ts` (AC-18) — endpointlar Nest metadata'sidan (74 ta, qo‘lda ro‘yxat emas); kutilgan natija `ROLE_PERMISSIONS` dan: anonim → `401` (Public'dan tashqari), USER — ruxsatsizlari `403 FORBIDDEN`, ruxsatlilari guard'dan o‘tadi; ADMIN — hech biri rad etilmaydi; USER kira oladigan 14 ta endpoint ro‘yxati aniq yozilgan (§3 bilan kelishilgan).

**Phase 16'da bajarilgan (✔):** `backend/test/db/security-fuzz.db-spec.ts` — sotuvchi ruxsatsiz har bir endpointga yo‘l variantlari (katta harf, oxirgi `/`, kodlangan belgi, query'da `role`/`permissions`/`userId`), HEAD va method-override header'lari bilan ham kira olmaydi (hech qachon 2xx emas); **to‘g‘ri imzolangan, lekin `role: ADMIN` deb yozilgan sotuvchi tokeni** ham barcha admin endpointlarida `403` — rol va permissionlar har so‘rovda DB'dan (§4.1), tokendagi `role` claim'iga ishonilmaydi; o‘zgartirilgan payload, begona kalit, mavjud bo‘lmagan user, iss/aud xato → `401`. `security-leaks.db-spec.ts` — har bir GET javobida (ADMIN va USER) maxfiy maydon yo‘q. Playwright (`frontend/e2e/main-flows.spec.ts`): sotuvchi 9 ta admin sahifasini URL bilan ochsa "Ruxsat yo‘q" va admin API'si chaqirilmaydi; devtools'dan o‘z sessiyasi tokeni bilan 9 ta admin so‘rovi → `403`; kelgan narxi UI va javobda yo‘q. Regressiya yo‘q (`rbac-matrix` qayta o‘tdi).

**Har bir modul phase'ida (rejali):**
- **Matritsa asosidagi e2e test:** §3 jadvali test ma’lumoti sifatida kodlashtiriladi. Har bir endpoint × {anonim, USER, ADMIN} uchun kutilgan status (401/403/2xx) tekshiriladi (AC-18).
- **Ownership testlari:** USER A boshqa USER B ning sotuvini ko‘ra olmaydi (AC-19). Biriktirilmagan omborga sotuv rad etiladi.
- **Maydon testlari:** USER javobida `costPrice` kaliti umuman yo‘q (AC-20).
