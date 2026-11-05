# Divine.uz — API contract

> **Holat:** tasdiqlangan contract (Phase 1). Umumiy qoidalar (§1: xato strukturasi, request ID, validatsiya, pagination, saralash, filtrlar, rate limit, body limiti) **Phase 3'da implement qilingan** — [§1.6](#16-foundation-implementatsiyasi-phase-3). Biznes endpointlari tegishli phase'larda implement qilinadi.
> Ishlab turgan OpenAPI: `GET /api/docs` (UI), `GET /api/docs/openapi.json` (prod'da standart holatda o‘chiq).
> Ruxsatlar: [RBAC.md](RBAC.md) · Qoidalar: [BUSINESS-RULES.md](BUSINESS-RULES.md)

---

## 1. Umumiy qoidalar

### 1.1. Asosiy parametrlar

| Mavzu | Qoida |
|---|---|
| Base URL | `/api/v1` (prod'da Nginx orqali SPA bilan bir origin) |
| Format | `application/json; charset=utf-8` |
| Nomlash | Yo‘llar: kebab-case, ko‘plik (`/product-groups`). JSON maydonlari: camelCase |
| Autentifikatsiya | `Authorization: Bearer <accessToken>` (public endpointlardan tashqari hammasida) |
| Refresh | `dv_refresh` httpOnly cookie (`Path=/api/v1/auth`) |
| CSRF | Cookie ishlatiladigan endpointlarda (`/auth/refresh`, `/auth/logout`) `X-Requested-With: XMLHttpRequest` header majburiy va `Origin` tekshiriladi |
| Idempotency | `POST /sales` uchun `Idempotency-Key: <UUID>` majburiy |
| So‘rov ID | `X-Request-Id` (ixtiyoriy kiruvchi: faqat `^[A-Za-z0-9-]{8,64}$`, aks holda server yangi UUID beradi; javobda **doim** bor, xato javobida `error.requestId` bilan bir xil) |
| Pul | **string**, `NUMERIC(18,2)`: `"1250000.00"` |
| Miqdor | **string**, `NUMERIC(14,3)`: `"2.500"` |
| Vaqt belgisi | ISO 8601 UTC: `"2026-10-06T10:25:00.000Z"` |
| Biznes sanasi | `"YYYY-MM-DD"` (Toshkent kalendari) |
| Sana filtri | `dateFrom`/`dateTo` — Toshkent kunlari, **ikkala chegara ham kiradi**. Server `[dateFrom 00:00, dateTo+1 00:00) Asia/Tashkent` oralig‘iga o‘giradi |
| Noma’lum maydonlar | Body'da rad etiladi (`400 VALIDATION_ERROR`, "Ruxsat etilmagan maydonlar yuborildi"). Query'da e’tiborga olinmaydi |
| Javob shakli | Ro‘yxat — `{ data, meta }` (§1.2); **bitta resurs (detail, create, update) — DTO'ning o‘zi**, `data` o‘ramisiz (masalan `GET /customers/:id` → `CustomerDto`); 204 — body'siz; xato — §1.3 |
| Matnlar | Barcha `message` maydonlari o‘zbek tilida (lotin) |

### 1.2. Pagination, saralash, filtr

```
GET /api/v1/sales?page=2&pageSize=20&sort=soldAt:desc&dateFrom=2026-10-01&dateTo=2026-10-06&productId=…&userId=…
```

| Parametr | Qoida |
|---|---|
| `page` | ≥ 1, standart 1 |
| `pageSize` | 1–100, standart 20 |
| `sort` | `field:asc` yoki `field:desc`; faqat endpoint whitelist'idagi maydonlar |
| `search` | ≤ 100 belgi; bo‘sh qiymat e’tiborga olinmaydi |
| Bo‘sh filtr | `?status=` — filtr yo‘q (barcha filtrlar uchun) |
| `dateFrom` / `dateTo` | `YYYY-MM-DD`; `dateFrom > dateTo` → `400` (`details[].field = "dateTo"`) |
| Filtrlar | Barchasi **birgalikda** (AND) ishlaydi (REQ-090) |

**Ro‘yxat javobi:**
```json
{ "data": [ … ], "meta": { "page": 2, "pageSize": 20, "total": 134, "totalPages": 7 } }
```

### 1.3. Xato javobi (yagona struktura)

```json
{
  "error": {
    "code": "VALIDATION_ERROR",
    "message": "Kiritilgan ma’lumotlarda xatolik bor",
    "details": [
      { "field": "items[0].quantity", "message": "Miqdor noldan katta bo‘lishi kerak" },
      { "field": "customerName", "message": "Mijoz ismi majburiy" }
    ],
    "requestId": "bd7d8535ae83d59f032539cde15b31a0"
  }
}
```

- `details` ixtiyoriy (asosan validatsiyada). Body, query va params xatolari bir xil: `field` — maydon yo‘li (`items[0].quantity`, `pageSize`, `id`); body darajasidagi xato (noma’lum maydonlar) uchun `field: ""`.
- Unique buzilishida (`LOGIN_TAKEN`, `BARCODE_TAKEN`, `NAME_TAKEN`) `details` formadagi maydonni ko‘rsatadi (`login`, `barcode`, `name`) — frontend xatoni shu maydon ostida ko‘rsatadi.
- `requestId` — `X-Request-Id` header bilan bir xil; server log'ida shu ID bo‘yicha topiladi.
- Stack trace, SQL, constraint nomlari, framework'ning inglizcha xabarlari va ichki identifikatorlar **hech qachon** qaytarilmaydi. Xato javoblarida `Cache-Control: no-store`.

### 1.4. HTTP status kodlari va umumiy xatolar

| Status | Kod(lar) | Qachon |
|---|---|---|
| 200 / 201 / 204 | — | Muvaffaqiyat (201 — yaratildi, 204 — body'siz) |
| 400 | `VALIDATION_ERROR`, `BAD_REQUEST`, `IDEMPOTENCY_KEY_REQUIRED` | Noto‘g‘ri input |
| 401 | `UNAUTHENTICATED`, `INVALID_CREDENTIALS`, `SESSION_EXPIRED`, `ACCOUNT_BLOCKED` | Autentifikatsiya |
| 403 | `FORBIDDEN`, `WAREHOUSE_ACCESS_DENIED`, `ACCOUNT_BLOCKED` (login), `CANNOT_MODIFY_SELF` | Ruxsat yo‘q |
| 404 | `NOT_FOUND` | Topilmadi yoki begona resurs |
| 409 | `CONFLICT`, `LOGIN_TAKEN`, `BARCODE_TAKEN`, `NAME_TAKEN`, `ENTITY_IN_USE`, `INSUFFICIENT_STOCK`, `INCOMING_NOT_DRAFT`, `IDEMPOTENCY_KEY_REUSED`, `LAST_ACTIVE_ADMIN` | Holat yoki ma’lumot ziddiyati |
| 413 | `PAYLOAD_TOO_LARGE` | Body > 1 MB |
| 422 | `INVALID_QUANTITY`, `PRODUCT_INACTIVE`, `WAREHOUSE_INACTIVE`, `PRODUCT_GROUP_INACTIVE`, `EXPENSE_CATEGORY_INACTIVE`, `INCOMING_EMPTY`, `SALE_EMPTY`, `CUSTOMER_NAME_REQUIRED` | Biznes qoida buzildi |
| 423 | `ACCOUNT_LOCKED` | Ko‘p xato urinishdan keyin vaqtincha lock |
| 429 | `RATE_LIMITED` | Rate limit (`Retry-After` header bilan) |
| 500 | `INTERNAL_ERROR` | Kutilmagan xato |
| 503 | `SERVICE_UNAVAILABLE` | DB ishlamayapti, tranzaksiya timeout'i yoki statement timeout |

Har bir endpoint quyida faqat **o‘ziga xos** xatolarni ko‘rsatadi. 401/403/429/500 va 400 VALIDATION_ERROR barcha himoyalangan endpointlarda bo‘lishi mumkin.

**Framework va DB darajasidagi xatolar** (service tekshiruvidan o‘tib ketgan holatlar uchun oxirgi himoya, [DATABASE §12](DATABASE.md#12-db-xato-kodlari-phase-3-mapping-uchun)):

| Holat | Javob |
|---|---|
| Mavjud bo‘lmagan route yoki metod | `404 NOT_FOUND` |
| Noto‘g‘ri JSON | `400 BAD_REQUEST` |
| Body > 1 MB | `413 PAYLOAD_TOO_LARGE` |
| Unique (`23505`) | `409 LOGIN_TAKEN` / `BARCODE_TAKEN` / `NAME_TAKEN` (constraint bo‘yicha), qolganlari `409 CONFLICT` |
| FK: bog‘langan yozuv yo‘q (`23503`) | `404 NOT_FOUND` |
| FK RESTRICT: tarixi bor yozuvni o‘chirish (`23001`) | `409 ENTITY_IN_USE` |
| CHECK (`23514`) | `409 INSUFFICIENT_STOCK` (manfiy qoldiq), qolganlari `400 VALIDATION_ERROR` |
| NOT NULL (`23502`), data exception (`22xxx`) | `400 VALIDATION_ERROR` |
| Serialization / deadlock (`40001`, `40P01`) — 3 ta qayta urinishdan keyin | `409 CONFLICT` |
| Kirim DRAFT emas (trigger `DV002`) | `409 INCOMING_NOT_DRAFT` |
| Ulanish, resurs, timeout (`08xxx`, `53xxx`, `57xxx`, Prisma `P1xxx`, `P2028`) | `503 SERVICE_UNAVAILABLE` |
| O‘zgarmaslik/ledger invarianti (`DV001`, `DV003`, `DV004`), huquq (`42501`) va boshqa kutilmagan xatolar | `500 INTERNAL_ERROR` (server log'ida `error` darajasida) |

### 1.5. Rate limit

| Guruh | Limit | Kalit | Holat |
|---|---|---|---|
| Autentifikatsiyasiz so‘rovlar | 60 / daqiqa | IP | **Faol** (Phase 3) |
| `POST /auth/login` | 10 / daqiqa (+ login bo‘yicha progressive lockout, §3) | IP | **Faol** (Phase 4, `@RateLimitGroup('login')`) |
| `POST /auth/refresh` | 30 / daqiqa | IP | **Faol** (Phase 4, `@RateLimitGroup('refresh')`) |
| Yozish amallari (`POST`/`PUT`/`PATCH`/`DELETE`) | 120 / daqiqa | user ID | **Faol** (Phase 4) |
| O‘qish amallari | 600 / daqiqa | user ID | **Faol** (Phase 4) |
| `GET /health` | cheklanmaydi (`@SkipAllThrottles`) | — | Faol |

User kaliti access token imzosidan olinadi (`AccessTokenMiddleware`, DB'siz) — throttler guard'lardan oldin ishlaydi. IP — `req.ip` (`TRUST_PROXY` hop soni bo‘yicha, proxy ortida to‘g‘ri sozlanishi shart). Login/refresh limitlari umumiy limitlarga **qo‘shimcha** amal qiladi.

Oshib ketsa: `429 RATE_LIMITED` + `Retry-After: <soniya>` header (CORS orqali o‘qiladi).

### 1.6. Foundation implementatsiyasi (Phase 3)

| Mavzu | Implementatsiya (`backend/src/…`) |
|---|---|
| Xato strukturasi | `common/errors/app-error.ts` (`AppError(code, { details, message, status })`), `common/errors/error-status.ts` (kod → HTTP status, `Record<ErrorCode, …>`), `common/filters/global-exception.filter.ts` |
| DB xatolari | `common/errors/database-errors.ts` — Prisma 7 / adapter-pg va raw `pg` xatolari, COMMIT paytidagi `DriverAdapterError` ham |
| Validatsiya | `common/validation/zod-validation.pipe.ts` — `@ZodBody(schema)`, `@ZodQuery(schema)`, `@ZodParam('id', uuidSchema)`; sxemalar va o‘zbekcha xabarlar `@divine/shared` dan |
| Ro‘yxat so‘rovi | `common/query/list-query.ts` — `createListQuerySchema({ sortFields, defaultSort, filters })`, `listFilters.search()/oneOf()/id()/dateRange()` |
| Prisma tarjimasi | `common/query/prisma-query.ts` — `toPrismaPagination`, `toPrismaOrderBy` (whitelist mapping + tie-breaker), `toSqlOrderBy` (raw SQL), `toPrismaDateRange`, `toPaginated` |
| Sana | `common/time/tashkent-time.ts` — `tashkentDayRange`, `tashkentToday`, `tashkentDateRangeToUtc` (IANA, DST'ga chidamli) |
| Request ID | `common/http/request-id.ts` — birinchi middleware, pino-http bilan umumiy, `@RequestId()` dekoratori |
| Rate limit | `common/throttling/` — Redis storage (atomik Lua), `AppThrottlerGuard` |
| OpenAPI | `common/swagger/api-schemas.ts` — `ApiErrorBodyDto`, `PaginationMetaDto`, `@ApiErrorResponses(...)`, `@ApiPaginatedResponse(Dto)`; global 429/500/503 |
| Tranzaksiya | `infrastructure/prisma/transaction-runner.ts` — `TransactionRunner.run(fn, options)` |

---

## 2. Umumiy DTO'lar

```ts
type Money = string;        // "1250000.00"
type Quantity = string;     // "2.500"
type IsoDateTime = string;  // "2026-10-06T10:25:00.000Z"
type DateOnly = string;     // "2026-10-06"

interface UserDto {
  id: string; login: string; fullName: string | null;
  role: 'ADMIN' | 'USER'; status: 'ACTIVE' | 'BLOCKED';
  warehouseIds: string[]; lastLoginAt: IsoDateTime | null;
  createdAt: IsoDateTime; updatedAt: IsoDateTime;
}

interface CurrentUser {               // GET /auth/me
  id: string; login: string; fullName: string | null;
  role: 'ADMIN' | 'USER'; status: 'ACTIVE' | 'BLOCKED';
  permissions: string[]; warehouseIds: string[];
}

interface ProductGroupDto { id: string; name: string; description: string | null;
  isActive: boolean; productCount: number; createdAt: IsoDateTime; updatedAt: IsoDateTime; }

interface ProductDto {
  id: string; name: string; groupId: string; groupName: string;
  barcode: string | null; salePrice: Money;
  costPrice?: Money;                  // FAQAT products.read_cost bo‘lsa (USER'da kalit umuman yo‘q)
  unit: 'DONA' | 'KG' | 'LITR' | 'METR'; allowDecimal: boolean;
  minStock: Quantity | null; status: 'ACTIVE' | 'INACTIVE';
  stock: Quantity;                    // ADMIN: barcha omborlar; USER: biriktirilgan omborlar yig‘indisi
  createdAt: IsoDateTime; updatedAt: IsoDateTime;
}

interface WarehouseDto { id: string; name: string; address: string | null;
  status: 'ACTIVE' | 'INACTIVE'; createdAt: IsoDateTime; updatedAt: IsoDateTime; }
// Ombor ko'rsatkichlari va qoldiq qatori — §7 (Phase 7).

interface MovementDto {
  id: string;                         // BIGINT string sifatida
  warehouseId: string; warehouseName: string; productId: string; productName: string;
  movementType: 'INCOMING' | 'SALE'; quantity: Quantity /* ishorali */; balanceAfter: Quantity;
  unit: string; unitCost?: Money | null /* FAQAT products.read_cost */;
  referenceType: 'INCOMING' | 'SALE'; referenceId: string;
  referenceNumber: string;            // "K-000123" / "S-000456"
  createdBy: { id: string; login: string; fullName: string | null }; createdAt: IsoDateTime;
}

interface IncomingDto {
  id: string; number: string /* "K-000123" */; date: DateOnly; warehouseId: string;
  warehouseName: string; notes: string | null; status: 'DRAFT' | 'CONFIRMED' | 'CANCELLED';
  totalQuantity: Quantity; totalAmount: Money;
  items: IncomingItemDto[];           // ro‘yxatda yo‘q, detalda bor
  createdBy: { id: string; login: string }; confirmedBy: { id: string; login: string } | null;
  confirmedAt: IsoDateTime | null; createdAt: IsoDateTime; updatedAt: IsoDateTime;
}
interface IncomingItemDto { id: string; productId: string; productName: string; barcode: string | null;
  unit: string; quantity: Quantity; costPrice: Money; lineTotal: Money; }

interface SaleDto {
  id: string; number: string /* "S-000456" */; soldAt: IsoDateTime;
  user: { id: string; login: string; fullName: string | null };
  warehouse: { id: string; name: string };
  customer: { id: string; name: string; phone: string | null };   // snapshot qiymatlar
  totalQuantity: Quantity; totalAmount: Money;
  totalCost?: Money; grossProfit?: Money;                          // FAQAT products.read_cost
  status: 'COMPLETED'; items: SaleItemDto[];                       // ro‘yxatda yo‘q, detalda bor
}
interface SaleItemDto { productId: string; productName: string; barcode: string | null; unit: string;
  quantity: Quantity; unitPrice: Money; lineTotal: Money; unitCost?: Money; lineProfit?: Money; }

interface CustomerDto {               // USER (customers.read): faqat id, name, phone
  id: string; name: string; phone: string | null;
  notes?: string | null; purchaseCount?: number; totalSpent?: Money;
  lastPurchaseAt?: IsoDateTime | null; createdAt?: IsoDateTime;
}

// expenses.read/manage'siz (sotuvchi) — faqat { id, name } (D-19)
interface ExpenseCategoryDto { id: string; name: string; isActive?: boolean; expenseCount?: number;
  createdAt?: IsoDateTime; updatedAt?: IsoDateTime; }
interface ExpenseDto { id: string; date: DateOnly; amount: Money;
  category: { id: string; name: string }; note: string | null;   // kategoriya majburiy (D-19), holat yo'q (D-11)
  createdBy: { id: string; login: string; fullName: string | null }; createdAt: IsoDateTime; updatedAt: IsoDateTime; }

interface AuditLogDto { id: string; occurredAt: IsoDateTime;
  actor: { id: string; login: string; fullName: string | null } | null;   // null — tizim / noma’lum (xato login)
  action: AuditAction; entityType: AuditEntityType;                     // @divine/shared kataloglari
  entityId: string | null; metadata: Record<string, unknown>; ip: string | null; requestId: string | null; }
interface AuditLogPage { data: AuditLogDto[]; nextCursor: string | null; }  // cursor pagination (§15)
```

---

## 3. Auth

**Holat:** Phase 4 — implement qilingan va real PostgreSQL + Redis bilan testlangan (`backend/test/db/auth.db-spec.ts`). Kod: `backend/src/modules/auth/`.

Barcha auth javoblari: `Cache-Control: no-store`. Access token — HS256 JWT (`iss=divine.uz`, `aud=divine.uz/api`, `sub`, `role`; 900 s, ±30 s soat farqi), faqat `Authorization: Bearer` header orqali. Refresh token — tasodifiy 32 bayt (base64url), DB'da faqat SHA-256 hash'i (`user_sessions.token_hash`).

### `POST /auth/login`
- **Ruxsat:** public · rate limit: 10/daq/IP
- **Body:** `{ "login": "ali2024", "password": "483920" }` (boshqa maydon — `400`)
- **Validatsiya:** `login` — `loginSchema` (3–32, `[A-Za-z0-9]`); `password` — aynan 6 raqam. Bo‘sh maydonlar: "Loginni kiriting" / "Parolni kiriting". Login case-insensitive qidiriladi.
- **200:**
  ```json
  { "accessToken": "eyJ…", "expiresIn": 900, "user": { /* CurrentUser */ } }
  ```
  `Set-Cookie: dv_refresh=<opaque>; HttpOnly; Secure; SameSite=Strict; Path=/api/v1/auth; Max-Age=604800`
- **Xatolar:**
  - `401 INVALID_CREDENTIALS` — login yo‘q yoki parol noto‘g‘ri: bir xil xabar; login yo‘q bo‘lsa ham dummy argon2 tekshiruvi bajariladi (javob vaqti bir xil);
  - `423 ACCOUNT_LOCKED` + `Retry-After: <soniya>` — 5 ta ketma-ket xato → 15 daq lock, har keyingi lock 2 baravar (30, 60 … maks. 24 soat). Mavjud bo‘lmagan login ham xuddi shunday lock oladi (Redis), shuning uchun lock login mavjudligini oshkor qilmaydi. Lock paytidagi urinishlar hisoblanmaydi;
  - `403 ACCOUNT_BLOCKED` — faqat **to‘g‘ri** parol bilan, user BLOCKED bo‘lsa;
  - `400 VALIDATION_ERROR` · `429 RATE_LIMITED`.
- Muvaffaqiyatli kirish xato hisoblagichini va lock darajasini nollaydi, `last_login_at` yangilanadi.
- **Audit:** `AUTH_LOGIN_SUCCEEDED` / `AUTH_LOGIN_FAILED` (sabab: `INVALID_CREDENTIALS`, `ACCOUNT_LOCKED`, `ACCOUNT_BLOCKED`) / `AUTH_ACCOUNT_LOCKED`. Metadata'da parol, hash, token yo‘q.

### `POST /auth/refresh`
- **Ruxsat:** public (`dv_refresh` cookie) · rate limit: 30/daq/IP
- **CSRF:** header `X-Requested-With: XMLHttpRequest` **va** `Origin` ∈ `CORS_ORIGINS` — aks holda `403 FORBIDDEN`
- **Body:** yo‘q
- **200:** login bilan bir xil (yangi `accessToken` + yangi cookie). **Rotation:** eski sessiya `ROTATED` bo‘ladi (`FOR UPDATE` bilan — parallel so‘rovda bitta g‘olib).
- **Xatolar:**
  - `401 SESSION_EXPIRED` — cookie yo‘q, noto‘g‘ri formatda, muddati o‘tgan yoki revoke qilingan (cookie tozalanadi);
  - **reuse:** allaqachon `ROTATED` token qayta yuborilsa — butun family revoke (`REUSE_DETECTED`) + audit `AUTH_REFRESH_REUSE_DETECTED`, javob `401 SESSION_EXPIRED`;
  - `401 ACCOUNT_BLOCKED` — user bloklangan (sessiya revoke qilinadi);
  - `403 FORBIDDEN` (CSRF) · `429 RATE_LIMITED`.

### `POST /auth/logout`
- **Ruxsat:** public — **cookie bo‘yicha** (access token talab qilinmaydi, shuning uchun token muddati o‘tgandan keyin ham ishlaydi) · CSRF: refresh bilan bir xil
- **204** — joriy sessiya revoke (`LOGOUT`), cookie tozalanadi (`Max-Age=0`). Cookie yo‘q yoki eskirgan bo‘lsa ham 204 (idempotent). Audit: `AUTH_LOGOUT`
- **Xatolar:** `403 FORBIDDEN` (CSRF)

### `GET /auth/me`
- **Ruxsat:** `@Authenticated()` (istalgan faol user)
- **200:** `CurrentUser` — `{ id, login, fullName, role, status, permissions[], warehouses[] }`
- **Xatolar:** `401 UNAUTHENTICATED` (token yo‘q/yaroqsiz) · `401 SESSION_EXPIRED` (parol o‘zgargandan oldin berilgan token) · `401 ACCOUNT_BLOCKED`

### Har bir himoyalangan so‘rovda (`JwtAuthGuard`)
Token imzosi, `iss`/`aud`/`exp` tekshiriladi, keyin user DB'dan olinadi: ACTIVE bo‘lmasa `401 ACCOUNT_BLOCKED`; token `password_changed_at`dan oldin berilgan bo‘lsa `401 SESSION_EXPIRED`. Permissionlar rol bo‘yicha 60 s keshlanadi. Ruxsat yetmasa `403 FORBIDDEN` (RBAC §4).

---

## 4. Users (Phase 5)

**Holat:** Phase 5 — implement qilingan va real PostgreSQL + Redis bilan testlangan (`backend/test/db/users.db-spec.ts`, `test/unit/users/users.service.spec.ts`). Kod: `backend/src/modules/users/`. Sxemalar: `@divine/shared` (`createUserSchema`, `updateUserSchema`, `updateUserStatusSchema`, `replaceUserWarehousesSchema`) — backend va frontend mock bir xil sxemadan foydalanadi.

**`UserDto`** — javoblardagi yagona user shakli (parol, hash, sessiya va lockout hisoblagichlari **hech qachon** qaytmaydi):

```json
{ "id": "0199…", "login": "aziz", "fullName": "Aziz Karimov", "role": "USER", "status": "ACTIVE",
  "lockedUntil": null, "warehouses": [{ "id": "0199…", "name": "Asosiy ombor" }],
  "lastLoginAt": "2026-10-22T05:12:00.000Z", "createdAt": "…", "updatedAt": "…" }
```

`status` — admin boshqaradigan holat (`ACTIVE`/`BLOCKED`). `lockedUntil` — ko‘p xato urinish sababli vaqtinchalik login cheklovi (SECURITY §4), holatdan **alohida**: bloklash/blokdan chiqarish uni o‘zgartirmaydi; muddati o‘tgan bo‘lsa `null`.

### `GET /users`
- **Ruxsat:** `users.read`
- **Query:** `page`, `pageSize`, `search` (login yoki ism, qisman, katta-kichik harf farqsiz; `%`/`_` oddiy belgi), `role`, `status`, `sort` ∈ {`login`, `createdAt`, `lastLoginAt`} (standart `createdAt:desc`). Qidiruv va filtrlar serverda — barcha yozuvlar bo‘yicha.
- **200:** `Paginated<UserDto>`

### `GET /users/warehouse-options`
- **Ruxsat:** `users.manage` · **200:** `WarehouseOption[]` — `{ id, name, address }`, faqat ACTIVE omborlar, nom bo‘yicha.
- User formasidagi ombor tanlovi uchun (warehouses moduli — Phase 7 — tayyor bo‘lmaguncha ham ishlaydi).

### `POST /users` — user yaratish (BR-01, BR-02, BR-03, BR-04)
- **Ruxsat:** `users.manage`
- **Body:**
  ```json
  { "login": "ali2024", "fullName": "Ali Valiyev", "role": "USER", "warehouseIds": ["0199…"] }
  ```
- **Validatsiya:** `login` — `loginSchema`; `fullName` ixtiyoriy (≤ 150, boshqaruv belgilarisiz, bo‘sh → `null`); `role` ∈ {ADMIN, USER}; `warehouseIds` — UUID, takrorlanmaydi, ≤ 100, mavjud va ACTIVE omborlar (bo‘sh bo‘lishi mumkin — USER sotuv qila olmaydi, OWN-09). **`password`, `passwordHash`, `status`, `permissions` va boshqa noma’lum maydonlar — `400 VALIDATION_ERROR`.**
- **201:**
  ```json
  { "user": { /* UserDto */ }, "generatedPassword": "048213" }
  ```
  Header: `Cache-Control: no-store`. Parol CSPRNG (`crypto.randomInt`), DB'ga faqat argon2id + pepper hash'i. `generatedPassword` faqat **shu javobda bir marta** qaytadi, hech qayerda saqlanmaydi, log va audit'ga yozilmaydi (REQ-026). Yo‘qolsa — tiklash yo‘li: `POST /users/:id/reset-password`.
- **Xatolar:** `409 LOGIN_TAKEN` (case-insensitive, `details[].field = "login"`) · `404 NOT_FOUND` (ombor, `field = "warehouseIds"`) · `422 WAREHOUSE_INACTIVE`
- **Audit:** `USER_CREATED` (metadata: `login`, `role`, `warehouseIds` — parolsiz)

### `GET /users/:id`
- **Ruxsat:** `users.read` · **200:** `UserDto` · **404** · noto‘g‘ri UUID → **400**

### `PATCH /users/:id`
- **Ruxsat:** `users.manage`
- **Body:** `{ "fullName"?: string | null, "role"?: "ADMIN" | "USER", "warehouseIds"?: string[] }` — kamida bitta maydon; login o‘zgartirilmaydi [A-26]. Ism, rol va omborlar **bitta tranzaksiyada**: istalgan xatoda hech narsa saqlanmaydi.
- **Omborlar:** yangi qo‘shilayotgani ACTIVE bo‘lishi shart; avval biriktirilgan va keyin nofaol bo‘lgan ombor saqlanib qolishi mumkin.
- **Xatolar:** `403 CANNOT_MODIFY_SELF` (o‘z rolini o‘zgartirish) · `409 LAST_ACTIVE_ADMIN` (oxirgi faol ADMIN'ni USER qilish) · `404` · `422 WAREHOUSE_INACTIVE`
- **Audit:** `USER_UPDATED` (`changes: { field: { from, to } }`), omborlar o‘zgarsa `USER_WAREHOUSES_CHANGED`
- Rol o‘zgarishi keyingi so‘rovdan kuchga kiradi (guard rolni har so‘rovda DB'dan oladi).

### `PATCH /users/:id/status`
- **Ruxsat:** `users.manage` · **Body:** `{ "status": "ACTIVE" | "BLOCKED" }`
- BLOCKED bo‘lganda: barcha refresh sessiyalar revoke (`USER_BLOCKED`), access token bilan keyingi so‘rov — darhol `401 ACCOUNT_BLOCKED` (token muddatini kutmasdan). Login lockout (`lockedUntil`) o‘zgarmaydi. Holat o‘zgarmasa — 200, audit yozilmaydi.
- **Xatolar:** `403 CANNOT_MODIFY_SELF` · `409 LAST_ACTIVE_ADMIN` · `404` · **Audit:** `USER_STATUS_CHANGED` (`from`, `to`, `revokedSessions`)

### `POST /users/:id/reset-password`
- **Ruxsat:** `users.manage` · **Body:** yo‘q
- **200:** `{ "generatedPassword": "731904" }` · `Cache-Control: no-store`
- Yangi 6 xonali parol (CSPRNG) → argon2id hash; `password_changed_at = now` (eski access tokenlar `401 SESSION_EXPIRED`), barcha refresh sessiyalar revoke (`PASSWORD_RESET`), login lockout tozalanadi. Holat (`BLOCKED`) o‘zgarmaydi.
- **Xatolar:** `403 CANNOT_MODIFY_SELF` (o‘z parolini bu endpoint orqali tiklash — boshqa admin tiklaydi) · `404`
- **Audit:** `USER_PASSWORD_RESET` (`revokedSessions`, `lockCleared` — parolsiz)

### `PUT /users/:id/warehouses`
- **Ruxsat:** `users.manage` · **Body:** `{ "warehouseIds": ["…", "…"] }` (to‘liq almashtirish; `[]` — hammasini olib tashlash)
- Olib tashlangan omborga keyingi so‘rovdan boshlab ruxsat yo‘q (ownership har so‘rovda DB'dan).
- **Xatolar:** `404 NOT_FOUND` (ombor) · `422 WAREHOUSE_INACTIVE` · **Audit:** `USER_WAREHOUSES_CHANGED` (`added`, `removed`, `warehouseIds`)

**Bir vaqtdagi o‘zgarishlar:** har bir mutatsiya user qatorini `FOR UPDATE` bilan qulflaydi; faol ADMIN'lar sonini kamaytirishi mumkin bo‘lgan amallar (rol, holat) qo‘shimcha `pg_advisory_xact_lock` bilan ketma-ketlashtiriladi — ikki admin bir-birini bir vaqtda USER qilsa ham kamida bittasi qoladi (test bilan tekshirilgan).

---

## 5. Product groups (Phase 6)

**Holat:** Phase 6 — implement qilingan va real PostgreSQL + Redis bilan testlangan (`backend/test/db/products.db-spec.ts`). Kod: `backend/src/modules/product-groups/`. Sxemalar: `@divine/shared` (`productGroupCreateSchema`, `productGroupUpdateSchema`).

| Endpoint | Ruxsat | Request | Javob | Xatolar |
|---|---|---|---|---|
| `GET /product-groups` | `product_groups.read` | `page`, `pageSize`, `search` (nom yoki tavsif, qisman), `isActive` (`true`/`false`), `sort` ∈ {`name`, `productCount`, `createdAt`} (standart `name:asc`) | `Paginated<ProductGroupDto>` | `400` |
| `GET /product-groups/:id` | `product_groups.manage` | — | `ProductGroupDto` | 404 |
| `POST /product-groups` | `product_groups.manage` | `{ name, description? }` | 201 `ProductGroupDto` | `409 NAME_TAKEN` (case-insensitive, `details.field = name`) |
| `PATCH /product-groups/:id` | `product_groups.manage` | `{ name?, description?, isActive? }` (kamida bittasi; `description: ""` → `null`) | `ProductGroupDto` | 404, `409 NAME_TAKEN` |
| `DELETE /product-groups/:id` | `product_groups.manage` | — (UI'da tasdiqlash dialogi) | 204 | 404, `409 ENTITY_IN_USE` (mahsulot bog‘langan) |

- `ProductGroupDto`: `{ id, name, description, isActive, productCount, createdAt, updatedAt }` — `productCount` guruhdagi barcha mahsulotlar (arxivlanganlar ham).
- **Arxivlash** (`isActive: false`, D-14): guruhga yangi mahsulot qo‘shilmaydi (`422 PRODUCT_GROUP_INACTIVE`), mavjud mahsulotlar va tarix saqlanadi; qayta faollashtirish mumkin. Mahsulotli guruhni **o‘chirib bo‘lmaydi** — arxivlanadi.
- `products.manage` bo‘lmagan user (sotuvchi) ro‘yxatda faqat faol guruhlarni ko‘radi (`isActive` filtri e’tiborsiz).

**Validatsiya:** `name` — `entityNameSchema` (trim, 1–200); `description` ≤ 1000. **Audit:** `PRODUCT_GROUP_CREATED/UPDATED/DELETED` (`UPDATED` — `changes: { field: { from, to } }`).

---

## 6. Products (Phase 6)

**Holat:** Phase 6 — implement qilingan va real PostgreSQL + Redis bilan testlangan (`products.db-spec.ts`, 28 ta). Kod: `backend/src/modules/products/`. Sxemalar: `@divine/shared` (`productCreateSchema`, `productUpdateSchema`, `productStatusSchema`).

**`ProductDto`:**
```json
{ "id": "…", "name": "Telefon Redmi 13", "groupId": "…", "groupName": "Smartfonlar",
  "barcode": "4780000000017", "salePrice": "2150000.00", "costPrice": "1800000.00",
  "unit": "DONA", "allowDecimal": false, "minStock": "5.000", "status": "ACTIVE",
  "stock": "17.000", "received": "20.000", "sold": "3.000", "isLowStock": false,
  "warehouses": [{ "warehouseId": "…", "warehouseName": "Asosiy ombor", "quantity": "10.000" }],
  "createdAt": "…", "updatedAt": "…" }
```
- **`costPrice` (kelgan narxi) — FAQAT `products.read_cost` bilan.** Ruxsatsiz userga (sotuvchi) kalit **umuman** yuborilmaydi — ro‘yxat, detal, lookup, yaratish/tahrirlash javoblari, ombor filtri bilan qidiruv — hammasi bitta serializer (`toProductDto`) orqali (OWN-06, AC-20).
- `stock` — joriy qoldiq; `received` — tasdiqlangan kirimlar; `sold` — sotuvlar; hammasi userning ombor doirasida (USER — biriktirilgan omborlar, OWN-03) yoki `warehouseId` filtri bo‘yicha. `warehouses` — userning doirasidagi omborlar bo‘yicha qoldiq.
- `isLowStock` — `status = ACTIVE` va `stock ≤ minStock` (yo‘q bo‘lsa — `settings.low_stock_default_threshold`).

### `GET /products` — qidiruv va ro‘yxat (REQ-054)
- **Ruxsat:** `products.read`
- **Query:** `page`, `pageSize`, `search` (nom bo‘yicha qisman `ILIKE` — `%`/`_` oddiy belgi, **yoki** shtrix-kod bo‘yicha aniq), `groupId`, `status` (`products.manage` bo‘lmasa majburan `ACTIVE`), `warehouseId` (faqat shu omborda qoldiq qatori bor mahsulotlar, miqdorlar shu ombor bo‘yicha; USER uchun ∈ biriktirilganlar, aks holda `403 WAREHOUSE_ACCESS_DENIED`), `stock` ∈ {`low`, `out`}, `sort` ∈ {`name`, `group`, `stock`, `received`, `sold`, `costPrice`, `salePrice`, `createdAt`} (standart `name:asc`). `costPrice` bo‘yicha saralash `products.read_cost`siz — `400` (tartib orqali ham oshkor bo‘lmasin).
- **200:** `Paginated<ProductDto>` — barcha filtrlar, qidiruv va saralash serverda (birinchi sahifa cheklovi yo‘q).

### `GET /products/lookup?barcode=4780000000017`
- **Ruxsat:** `products.read` · sotuv/kirim ekranida skaner uchun
- **Query:** `barcode` (majburiy), `warehouseId` (ixtiyoriy — qoldiq shu ombor bo‘yicha; USER uchun ∈ biriktirilganlar)
- **200:** `ProductDto` — faqat **ACTIVE** mahsulot · **404 NOT_FOUND** ("Bu shtrix-kod bo‘yicha mahsulot topilmadi") — topilmasa yoki arxivda

### `POST /products`
- **Ruxsat:** `products.manage`
- **Body:**
  ```json
  { "name": "Telefon Redmi 13", "groupId": "…", "barcode": "4780000000017",
    "costPrice": "1800000.00", "salePrice": "2150000.00",
    "unit": "DONA", "allowDecimal": false, "minStock": "5", "status": "ACTIVE" }
  ```
- **Validatsiya:** `name` 1–200 (trim); `groupId` — UUID, mavjud va **faol** guruh; `barcode` ixtiyoriy (`""`/`null` → yo‘q), probelsiz, ≤ 64 (D-05), barcha mahsulotlar (arxivdagilar ham) orasida unique (D-09); `costPrice`, `salePrice` — `moneySchema` (≥ 0, ≤ 2 kasr); `unit` ∈ {DONA, KG, LITR, METR}; `allowDecimal` — `unit = DONA` bo‘lsa `false`; `minStock` ixtiyoriy, > 0; `status` standart `ACTIVE`. Noma’lum maydon (masalan, `stock`) — `400`.
- **201:** `ProductDto`
- **Xatolar:** `409 BARCODE_TAKEN` (`details.field = barcode`; parallel so‘rovlarda ham — DB unique) · `404 NOT_FOUND` (guruh, `field = groupId`) · `422 PRODUCT_GROUP_INACTIVE` · **Audit:** `PRODUCT_CREATED`

### `GET /products/:id`
- **Ruxsat:** `products.read` · **200:** `ProductDto` · **404** (USER uchun arxivdagi mahsulot ham 404)

### `PATCH /products/:id`
- **Ruxsat:** `products.manage` · **Body:** `POST` maydonlarining istalgan qismi (kamida bittasi; forma hammasini yuboradi, `status` ham qabul qilinadi). Bitta tranzaksiyada: istalgan xatoda hech narsa saqlanmaydi.
- `unit`/`allowDecimal` mosligi joriy qiymatlar bilan birga tekshiriladi. Guruh almashtirilsa — yangi guruh faol bo‘lishi shart; arxivdagi joriy guruhida qolishi mumkin.
- Narx, nom, shtrix-kod o‘zgarishi o‘tgan sotuv va kirimlarga ta’sir qilmaydi — `sale_items`, `incoming_items` da snapshot (D-02, D-08; test bilan tasdiqlangan).
- **Xatolar:** `409 BARCODE_TAKEN` · `404` · `422 PRODUCT_GROUP_INACTIVE` · **Audit:** `PRODUCT_UPDATED` (`changes: { field: { from, to } }`, qiymat bo‘yicha — `"5"` = `"5.00"`), holat o‘zgarsa qo‘shimcha `PRODUCT_STATUS_CHANGED`

### `PATCH /products/:id/status`
- **Ruxsat:** `products.manage` · **Body:** `{ "status": "ACTIVE" | "INACTIVE" }` (UI'da tasdiqlash dialogi)
- INACTIVE (arxiv) mahsulotni sotib ham, kirim qilib ham bo‘lmaydi (BR-20, Phase 8/10). Qoldig‘i, sotuv/kirim tarixi va shtrix-kodi saqlanadi (shtrix-kod qayta ishlatilmaydi). **Audit:** `PRODUCT_STATUS_CHANGED`

### `GET /products/:id/summary` — mahsulot detali (REQ-053)
- **Ruxsat:** `products.read_cost` (sotuvchi — `403`)
- **200:**
  ```json
  { "product": { /* ProductDto */ }, "totalRevenue": "688000000.00", "totalCost": "576000000.00",
    "grossProfit": "112000000.00",
    "recentSales": [ { "saleId": "…", "saleNumber": "S-000123", "soldAt": "…", "customerName": "…",
                       "warehouseName": "Asosiy ombor", "quantity": "2.000", "unitPrice": "2150000.00",
                       "lineTotal": "4300000.00" } ] }
  ```
  `recentSales` — oxirgi 8 ta sotuv qatori; summalar sotuv paytidagi snapshot narxlaridan (D-02).

### Keyinga qoldirilgan
- `GET /products/:id/sales` alohida endpoint sifatida qo‘shilmadi: mahsulotning to‘liq sotuv tarixi — `GET /sales?productId=` (§11; pagination, filtrlar, OWN-04), detaldagi “Barcha sotuvlar” havolasi shuni ochadi (Phase 10). `GET /products/:id/stock` alohida endpoint sifatida qo‘shilmadi: mahsulotning omborlar bo‘yicha qoldig‘i `ProductDto.warehouses` (OWN-03 doirasida), ombor kesimi — `GET /warehouses/:id/stock` (Phase 7).

---

## 7. Warehouses (Phase 7) ✅

Modul: `backend/src/modules/warehouses`. Sxemalar — `@divine/shared` (`warehouseCreateSchema`, `warehouseUpdateSchema`, `warehouseStatusSchema`); body `strictObject` (noma’lum maydon → 400). O‘chirish endpointi **yo‘q**: ombor faqat nofaol qilinadi (tarix FK RESTRICT bilan ham himoyalangan).

| Endpoint | Ruxsat | Request | Javob | Xatolar |
|---|---|---|---|---|
| `GET /warehouses` | `warehouses.read` | `page`, `pageSize`, `search` (nom/manzil), `status`, `sort` ∈ {`name`, `createdAt`} (standart `createdAt:asc`) | `Paginated<WarehouseListItemDto>` | 400 |
| `GET /warehouses/:id` | `warehouses.read_all` | — | `WarehouseDetailDto` | 404 |
| `GET /warehouses/:id/stock` | `warehouses.read_all` | `page`, `pageSize`, `search` (nom qisman / shtrix-kod aniq), `groupId`, `stock` ∈ {`low`, `out`}, `sort` ∈ {`productName`, `quantity`, `stockValue`, `updatedAt`} | `Paginated<StockRowDto>` | 400, 404 |
| `GET /warehouses/:id/movements` | `warehouses.read_all` | `page`, `pageSize`, `search`, `productId`, `userId`, `movementType`, `referenceType`, `dateFrom`, `dateTo`, `sort=createdAt:desc` | `Paginated<MovementDto>` | 400, 404 |
| `POST /warehouses` | `warehouses.manage` | `{ name, address? }` | 201 `WarehouseDto` | 400, `409 NAME_TAKEN` |
| `PATCH /warehouses/:id` | `warehouses.manage` | `{ name?, address? }` (kamida bittasi; `address: ""`/`null` — tozalash) | `WarehouseDto` | 400, 404, `409 NAME_TAKEN` |
| `PATCH /warehouses/:id/status` | `warehouses.manage` | `{ status: "ACTIVE" \| "INACTIVE" }` | `WarehouseDto` (bir xil holat — o‘zgarishsiz, audit yo‘q) | 400, 404 |

**DTO’lar** (`@divine/shared`):

```ts
interface WarehouseDto { id; name; address: string | null; status: 'ACTIVE' | 'INACTIVE'; createdAt; updatedAt }
interface WarehouseStats { productCount: number; totalQuantity: Quantity; stockValue?: Money; lowStockCount: number }
type WarehouseListItemDto = WarehouseDto & Partial<WarehouseStats>;
interface WarehouseDetailDto extends WarehouseDto, WarehouseStats { incoming30: Quantity; outgoing30: Quantity }
interface StockRowDto { productId; productName; groupName; barcode; unit; quantity; minStock;
  costPrice?: Money; salePrice: Money; stockValue?: Money; isLowStock: boolean; updatedAt }
```

**Qoidalar:**
- **USER (OWN-01):** `GET /warehouses` faqat biriktirilgan **va** ACTIVE omborlarni, faqat `WarehouseDto` maydonlari bilan qaytaradi (ko‘rsatkichlarsiz). `status`/`search` filtri bu doirani kengaytirmaydi. Detal, qoldiq, harakatlar — `403 FORBIDDEN` (o‘z ombori bo‘lsa ham).
- **Ko‘rsatkichlar:** `productCount` — qoldig‘i > 0 mahsulotlar; `lowStockCount` — faol mahsulot va qoldiq ≤ `min_stock` (yo‘q bo‘lsa global chegara); `incoming30`/`outgoing30` — ledger bo‘yicha bugun bilan 30 Toshkent kuni.
- **Kelgan narxi (OWN-06):** `stockValue`, `costPrice`, `unitCost` — faqat `products.read_cost`; aks holda kalit yo‘q, `sort=stockValue` → 400.
- **Nofaol ombor (BR-21, D-13):** yangi kirim ham, sotuv ham → `422 WAREHOUSE_INACTIVE` (`InventoryService`). Qoldiq, ledger, hujjatlar va `user_warehouses` qatorlari saqlanadi; yangi biriktirish (`POST /users`, `PUT /users/:id/warehouses`) → `422 WAREHOUSE_INACTIVE`; `GET /users/warehouse-options`da ko‘rinmaydi. Holat o‘zgarishi ombor qatorini `FOR UPDATE` qulflaydi — davom etayotgan operatsiya (`FOR SHARE`) tugashini kutadi.
- **Audit:** `WAREHOUSE_CREATED` (`{ name, address }`), `WAREHOUSE_UPDATED` (`{ name, changes: { field: { from, to } } }`), `WAREHOUSE_STATUS_CHANGED` (`{ name, from, to, assignedUsers, productsInStock }`) — o‘sha tranzaksiyada.

---

## 8. Inventory (Phase 7) ✅

Modul: `backend/src/modules/inventory`. Qoldiq **faqat** `InventoryService` orqali o‘zgaradi (HTTP endpointi yo‘q — Phase 8 kirim tasdiqlash va Phase 10 sotuv o‘z tranzaksiyasida chaqiradi):

- `assertOperationalWarehouse(tx, ctx, warehouseId)` — OWN-02 (`403 WAREHOUSE_ACCESS_DENIED`) + ombor ACTIVE (`422 WAREHOUSE_INACTIVE`), ombor qatori `FOR SHARE`.
- `increase(tx, entries)` / `decrease(tx, entries)` — omborlar ID tartibida, qatorlar `product_id` tartibida (deadlock yo‘q); stock UPSERT yoki shartli UPDATE (`quantity >= q`) → shu balans bilan ledger yozuvi. Yetmasa — `409 INSUFFICIENT_STOCK`, butun tranzaksiya bekor. DB trigger’lari hujjat ↔ ledger ↔ stock mosligini yana tekshiradi.

### `GET /inventory/movements`
- **Ruxsat:** `inventory.read`
- **Query:** `page`, `pageSize`, `dateFrom`, `dateTo`, `warehouseId`, `productId`, `movementType`, `userId`, `referenceType`, `search`, `sort` ∈ {`createdAt`} (standart `desc`)
- **200:** `Paginated<MovementDto>` — `referenceNumber` `K-000123` / `S-000456`; `unitCost` faqat `products.read_cost`.

### `GET /inventory/reconciliation`
- **Ruxsat:** `inventory.reconcile`. Faqat o‘qiydi — avtomatik tuzatish yo‘q (D-03).
- **200:**
  ```json
  { "checkedAt": "2026-10-22T10:00:00.000Z", "pairsChecked": 1840, "mismatchCount": 0,
    "mismatches": [ { "warehouseId": "…", "warehouseName": "…", "productId": "…", "productName": "…",
                      "stockQuantity": "10.000", "ledgerQuantity": "9.000", "lastBalanceAfter": "9.000" } ],
    "documentIssueCount": 0, "customerIssueCount": 0 }
  ```
  `mismatches` — ko‘pi bilan 500 ta (to‘liq son `mismatchCount`da); `documentIssueCount` — `reconcile_document_movements` + `reconcile_document_totals`, `customerIssueCount` — `reconcile_customer_aggregates`.
- **Audit:** `INVENTORY_RECONCILIATION_RUN` (`{ source: "api" | "job", pairsChecked, mismatchCount, documentIssueCount, customerIssueCount }`).
- **Kunlik job:** har kuni 03:00 (Asia/Tashkent), Redis `SET NX` qulfi bilan kuniga bitta instansiyada; natija audit’ga (`actorId = null`, `source: "job"`) va log’ga (nomuvofiqlik bo‘lsa `warn`). `NODE_ENV=test`da o‘chirilgan.

---

## 9. Qoldiq qo‘shish (sobiq "Kirim" bo‘limi) ✅

**2026-11-03 (biznes egasi so‘rovi):** alohida "Kirim" bo‘limi va `/incoming*` endpointlari olib tashlandi. Qoldiq faqat Mahsulotlar bo‘limidan qo‘shiladi. Server har safar **darhol tasdiqlangan** kirim hujjatini yozadi (`incoming` / `incoming_items` jadvallari, `INCOMING` ledger, hisobotlar, `incoming30` — avvalgidek). Eski hujjatlar (shu jumladan DRAFT/CANCELLED) bazada qoladi va hisobotlarda ko‘rinadi. Modul: `backend/src/modules/incoming` (HTTP endpointsiz, `IncomingService.receive`).

- **Ruxsat:** `incoming.manage` **va** `incoming.confirm` (avvalgi kirim qilish huquqi).
- **Tranzaksiya:** `assertOperationalWarehouse` (ruxsat + ACTIVE, `FOR SHARE`) → mahsulot `FOR SHARE` (ACTIVE, `allowDecimal` siyosati) → hujjat + qator (snapshot D-08) → CONFIRMED (totallar DB’da) → `InventoryService.increase` (`unit_cost = costPrice`) → audit. Biror qadam xato bersa — hammasi qaytariladi.
- **D-16:** qoldiq qo‘shish `products.cost_price`ni o‘zgartirmaydi; partiya narxi hujjat qatorida va ledger’da.
- **Audit:** `INCOMING_CONFIRMED` (`{ number, warehouseId, date, itemsCount, totalQuantity, totalAmount }`). `INCOMING_CREATED/UPDATED/CANCELLED` — faqat eski yozuvlarda.

### `POST /products` + `initialStock` (ixtiyoriy) — yangi mahsulot boshlang‘ich qoldiq bilan
- **Body:** mahsulot maydonlari + `"initialStock": { "warehouseId": "…", "quantity": "12", "date": "2026-11-03", "notes": "…" }`. Kelgan narxi — mahsulotning `costPrice` (ikkinchi narx maydoni yo‘q).
- Mahsulot va qoldiq **bitta tranzaksiyada**: ombor nofaol / kasr miqdor / boshqa xato bo‘lsa — mahsulot ham yaratilmaydi.
- **Xatolar:** `403 FORBIDDEN` (kirim ruxsati yo‘q) · `400` (`initialStock` + `status: INACTIVE`) · `422 WAREHOUSE_INACTIVE` · `422 INVALID_QUANTITY` (`initialStock.quantity`) · `403 WAREHOUSE_ACCESS_DENIED` · `404`
- **201:** `ProductDto` (`stock`, `received` yangilangan) · **Audit:** `PRODUCT_CREATED` + `INCOMING_CONFIRMED`

### `POST /products/:id/stock` — mavjud mahsulotga qoldiq
- **Body:** `{ "warehouseId": "…", "quantity": "5", "costPrice": "1500.00", "date": "2026-11-03", "notes": null }` (`strictObject`; client totallari → `400`)
- **201:** `ProductDto` · **Xatolar:** `404` · `422 PRODUCT_INACTIVE` · `422 WAREHOUSE_INACTIVE` · `422 INVALID_QUANTITY` (`quantity`) · `403`

---

## 9a. Credits — nasiya (D-24) ✅

Modul: `backend/src/modules/credits`. Barcha endpointlar — `credits.manage` (faqat ADMIN). Jadval va qoldiq — `@divine/shared` (`buildCreditInstallments`, `computeCreditSchedule`); qoldiq bazada saqlanmaydi.

| Endpoint | Request | Javob | Xatolar |
|---|---|---|---|
| `GET /credits` | `page`, `pageSize`, `search` (ism, telefon, `N-000123`), `status` ∈ {`ACTIVE`, `OVERDUE`, `PAID`}, `sort` ∈ {`next`, `takenAt`, `remainingAmount`} (standart `next:asc`) | `CreditsListResponse` = `Paginated<CreditDto>` + `summary: { remainingAmount, activeCount, overdueCount }` | `400` |
| `GET /credits/reminders` | — | `CreditReminderDto[]` — ertaga to‘lovi borlar (summa: shu kungacha jami qoldiq) | — |
| `GET /credits/:id` | — | `CreditDetailDto` (`schedule`, `payments`) | `404` |
| `POST /credits` | `{ debtorName, debtorPhone, amount (≥ 1 000), takenAt, firstDueDate, installments, intervalDays?, note? }` | `201 CreditDetailDto` | `400` (to‘lov olingan kundan oldin, noma’lum maydon) |
| `POST /credits/:id/payments` | `{ amount, date, note? }` | `201 CreditDetailDto` | `400` (kelajak sana), `404`, `422 CREDIT_OVERPAID` |

**Audit** (ism, telefon va izoh yozilmaydi): `CREDIT_CREATED` — `{ amount, installments, intervalDays, firstDueDate }`; `CREDIT_PAYMENT_ADDED` — `{ paymentId, amount, date }`.

---

## 10. Customers — mijozlar (Phase 9) ✅

Modul: `backend/src/modules/customers`. Sxemalar — `@divine/shared` (`customerCreateSchema`, `customerUpdateSchema`); body `strictObject` (noma’lum maydon, masalan client yuborgan `totalSpent` → `400`). Ism va telefon **unique emas** (A-23 — oila a’zolarida bitta raqam bo‘lishi mumkin): takroriy mijoz rad etilmaydi. **O‘chirish va arxivlash yo‘q** (BR-30; sxemada holat ustuni yo‘q, sotuvlar FK RESTRICT). Qoidalar — D-17 (tasdiqlangan).

```ts
interface CustomerDto { id; name; phone: string | null /* +998XXXXXXXXX */;
  // FAQAT customers.read_history (ADMIN); USER — faqat id, name, phone (OWN-07):
  notes?: string | null; purchaseCount?: number; totalSpent?: Money; lastPurchaseAt?: IsoDateTime | null;
  createdAt?: IsoDateTime; updatedAt?: IsoDateTime }
```

### `GET /customers`
- **Ruxsat:** `customers.read` (USER ham — kassada mijoz tanlash)
- **Query:** `search` (ism — qisman, registrsiz; telefon — kamida 3 ta raqam, qisman, bo‘sh joy/tire e’tiborsiz), `page`, `pageSize`, `sort` ∈ {`name`, `lastPurchaseAt`, `createdAt`, `totalSpent`, `purchaseCount`} (standart `lastPurchaseAt:desc`, xarid qilmaganlar oxirida). `totalSpent`/`purchaseCount` bo‘yicha saralash — faqat `customers.read_history`, aks holda `400`.
- **200:** `Paginated<CustomerDto>` — USER: faqat `id`, `name`, `phone`

### `POST /customers`
- **Ruxsat:** `customers.create`
- **Body:** `{ "name": "Aziz Karimov", "phone": "+998 90 123 45 67", "notes"?: "…" }`
- **Validatsiya:** `name` — `customerNameSchema` (majburiy, trim, ≤ 150); `phone` — ixtiyoriy, bo‘sh/`null` → `null`, berilsa `+998XXXXXXXXX` ga normallashtiriladi (`90 123-45-67`, `998901234567` ham qabul qilinadi), noto‘g‘ri bo‘lsa `400`; `notes` — ≤ 1000, faqat `customers.manage` (aks holda `403 FORBIDDEN`, `details[0].field = "notes"`).
- **201:** `CustomerDto` (USER uchun minimal) · **Audit:** `CUSTOMER_CREATED` (`{ hasPhone, hasNotes }` — ism, telefon, izoh yozilmaydi)

### `GET /customers/:id`
- **Ruxsat:** `customers.read_history` · **200:** `CustomerDto` (to‘liq) · **404**

### `PATCH /customers/:id`
- **Ruxsat:** `customers.manage` · **Body:** `{ name?, phone?, notes? }` (kamida bittasi; `phone: null` / `notes: null` — tozalash)
- O‘tgan sotuvlardagi mijoz snapshot’i (`customer_name_snapshot`, `customer_phone_snapshot`) o‘zgarmaydi.
- **Audit:** `CUSTOMER_UPDATED` (`{ fields: ["name", "phone", …] }` — faqat o‘zgargan maydon nomlari, qiymatlarsiz); o‘zgarishsiz so‘rov — audit yo‘q.

### `GET /customers/:id/purchases` — xarid tarixi (REQ-080)
- **Ruxsat:** `customers.read_history` · **Query:** `page`, `pageSize`, `dateFrom`, `dateTo` (sotuv vaqti, Toshkent kunlari), `sort=soldAt:desc|asc`
- **200:** `CustomerPurchasesResponse` = `Paginated<SaleDto>` (qatorlar snapshot’i bilan: mahsulot nomi, miqdor, narx) + `summary: { purchaseCount, totalSpent, lastPurchaseAt }`. `SaleDto.totalCost`, `grossProfit`, `items[].unitCost`, `lineProfit` — FAQAT `products.read_cost`.
- Ma’lumot manbai — haqiqiy `sales`/`sale_items` jadvallari (soxta ma’lumot yo‘q); sotuvlar Phase 10 dan keyin paydo bo‘ladi, ungacha bo‘sh. Yig‘ma — mijoz qatoridagi cache ustunlar (sotuv tranzaksiyasi yangilaydi, `reconcile_customer_aggregates` tekshiradi).
- **Xatolar:** `404` · `400` (sana oralig‘i)

---

## 11. Sales — sotuvlar (Phase 10) ✅

Modul: `backend/src/modules/sales`. Sxema — `@divine/shared` (`saleCreateSchema`, `idempotencyKeySchema`); body `strictObject` — client narx, tannarx yoki total yubora olmaydi (`400`). `sales` va `sale_items` o‘zgarmaydi (DB trigger) — tahrirlash/o‘chirish/bekor qilish/qaytarish endpointi yo‘q (D-03). Qoidalar — BUSINESS-RULES **D-18** (tasdiqlangan, 2026-10-22).

### `POST /sales` — sotuv yaratish (atomic, idempotent)
- **Ruxsat:** `sales.create` (+ ombor ownership — OWN-02)
- **Header:** `Idempotency-Key: <UUID>` — sotuv formasi ochilganda yaratiladi, tarmoq xatosidan keyingi qayta yuborishda **o‘sha kalit** ishlatiladi. Yo‘q → `400 IDEMPOTENCY_KEY_REQUIRED`; UUID emas → `400 VALIDATION_ERROR` (`details[0].field = "Idempotency-Key"`).
- **Body:**
  ```json
  { "warehouseId": "…",
    "customer": { "name": "Aziz Karimov", "phone": "+998901234567" },
    "items": [ { "productId": "…", "quantity": "2" }, { "productId": "…", "quantity": "1.250" } ] }
  ```
  yoki mavjud mijoz bilan: `"customer": { "id": "…" }` (bu holda `name`/`phone` yuborilmaydi).
- **Validatsiya:**
  - `warehouseId` — ACTIVE va (`warehouses.read_all`siz user uchun) biriktirilgan
  - `customer` — `id` (mavjud mijoz, `404` + `details[0].field = "customer.id"`) **yoki** `name` (majburiy, BR-05; xato — `customer.name`) + ixtiyoriy `phone` (BR-06, `+998XXXXXXXXX` ga normallashtiriladi). `name` bilan kelganda **har doim yangi mijoz** yaratiladi (takroriy ism/telefon ruxsat — D-17) va `CUSTOMER_CREATED` audit (`{ hasPhone, hasNotes: false, source: "sale" }`). `id` bilan — ism va telefon snapshot’i shu mijozdan
  - `items` 1–200 ta; takroriy `productId` qatorlari birlashtiriladi (BR-19); `productId` — mavjud ACTIVE mahsulot (`404` / `422 PRODUCT_INACTIVE`, `items[i].productId`); `quantity` > 0, ≤ 3 kasr va mahsulotning `allowDecimal` siyosatiga mos (`422 INVALID_QUANTITY`, `items[i].quantity`)
  - **narx yuborilmaydi** — `unitPrice` = `products.sale_price`, `unitCost` = `products.cost_price` (mahsulot kartochkasi, kirim narxi emas — D-02, D-16), sotuv paytidagi snapshot
- **Tranzaksiya** ([ARCHITECTURE.md §12.1](ARCHITECTURE.md#121-sotuv-post-sales)): ombor `FOR SHARE` (ruxsat + ACTIVE) → mahsulotlar `FOR SHARE` → qoldiq oldindan tekshiruvi (barcha yetmayotgan qatorlar bitta javobda) → mijoz (mavjud — `FOR UPDATE`; yoki yangi) → `sales` + `sale_items` (totallar DB yaxlitlashi bilan) → `InventoryService.decrease` (shartli UPDATE + `SALE` ledger, `product_id` tartibida) → mijoz yig‘malari (`purchase_count`, `total_spent`, `last_purchase_at`) → audit. Biror qadam xato bersa — sotuv, qatorlar, qoldiq, ledger, yangi mijoz, yig‘malar va audit to‘liq qaytariladi.
- **201:** `SaleDto` (qatorlar bilan) — yangi sotuv
- **200:** `SaleDto` — shu `Idempotency-Key`, **shu user** va **bir xil** kanonik payload bilan avval yaratilgan sotuv (qatorlar tartibi va `"2"`/`"2.000"` farq qilmaydi). Parallel bir xil so‘rovlar — bitta sotuv (UNIQUE kalit), qolganlari o‘sha sotuvni oladi.
- **Xatolar:**
  - `409 IDEMPOTENCY_KEY_REUSED` (kalit boshqa payload yoki boshqa user bilan ishlatilgan)
  - `409 INSUFFICIENT_STOCK` — `details: [{ "field": "items[0].quantity", "message": "«Telefon Redmi 13» uchun omborda faqat 3 dona bor" }, …]`
  - `403 WAREHOUSE_ACCESS_DENIED` · `422 WAREHOUSE_INACTIVE` · `422 PRODUCT_INACTIVE` · `422 INVALID_QUANTITY` · `404 NOT_FOUND` (mahsulot yoki mijoz) · `400 VALIDATION_ERROR` (bo‘sh qatorlar, ismsiz mijoz, client narxi)
- **Audit:** `SALE_CREATED` (`{ saleNumber, warehouseId, customerId, itemsCount, totalQuantity, totalAmount }` — tannarx va shaxsiy ma’lumotsiz)
- **Javobda tannarx:** `totalCost`, `grossProfit`, `items[].unitCost`, `items[].lineProfit` — FAQAT `products.read_cost` (sotuvchi javobida kalit yo‘q).

### `GET /sales`
- **Ruxsat:** `sales.read_all` yoki `sales.read_own` (USER — faqat o‘ziniki, OWN-04: query'dagi `userId` e’tiborga olinmaydi)
- **Query (barchasi birgalikda):** `page`, `pageSize`, `dateFrom`, `dateTo` (sotuv vaqti, Toshkent kunlari), `productId`, `userId` (faqat `sales.read_all`), `warehouseId`, `customerId`, `search` (sotuv raqami `S-000123`/`123` yoki mijoz ismi snapshot’i), `sort` ∈ {`soldAt`, `totalAmount`, `number`} (standart `soldAt:desc`)
- **200:** `SalesListResponse` = `Paginated<SaleDto>` (qatorlarsiz) + `summary: { count, totalQuantity, totalAmount, totalCost?, grossProfit? }` (butun filtr bo‘yicha; tannarx/foyda — faqat `products.read_cost`)

### `GET /sales/:id`
- **Ruxsat:** `sales.read_all` yoki `sales.read_own` · **200:** `SaleDto` (qatorlar bilan) · **404** (topilmadi yoki USER uchun begona — OWN-05)

---

## 12. Expenses — Xarajatlar (Phase 11) ✅

Modul: `backend/src/modules/expenses`. Sxemalar — `@divine/shared` (`expenseCreateSchema`, `expenseUpdateSchema`, `expenseCategoryCreateSchema`, `expenseCategoryUpdateSchema`); body `strictObject` — noma’lum maydon (masalan, bekor qilingan `status` — D-11) → `400`. Qarorlar: D-01, D-11 (holat yo‘q), D-12 (sotuvchi faqat qo‘shadi — **D-23 bilan almashtirilgan**: sotuvchi o‘z xarajatlari va kategoriyalarini ko‘radi, kategoriya qo‘shadi), **D-19** (kategoriya majburiy, sotuvchi faqat faol kategoriyani tanlaydi, kategoriyalarni ADMIN boshqaradi, boshlang‘ich ro‘yxat bo‘sh, sana Toshkent bo‘yicha bugundan keyin emas).

### Kategoriyalar

| Endpoint | Ruxsat | Request | Javob | Xatolar |
|---|---|---|---|---|
| `GET /expense-categories` | `expenses.read`, `expenses.create` yoki `expenses.manage` | `isActive=true\|false` (faqat to‘liq ko‘ruvchiga) | `ExpenseCategoryDto[]` (nom bo‘yicha). Sotuvchi (faqat `expenses.create`): **faqat faollari, `{ id, name }`** — `isActive` filtri e’tiborga olinmaydi | `400` (`isActive` noto‘g‘ri) |
| `POST /expense-categories` | `expenses.manage` | `{ name }` (1–100) | `201 ExpenseCategoryDto` | `409 NAME_TAKEN` (registrsiz, `field = name`) |
| `PATCH /expense-categories/:id` | `expenses.manage` | `{ name?, isActive? }` (kamida bittasi) | `200 ExpenseCategoryDto` | `404`, `409 NAME_TAKEN` |
| `DELETE /expense-categories/:id` | `expenses.manage` | — (UI'da tasdiqlash) | `204` | `404`, `409 ENTITY_IN_USE` — bitta bo‘lsa ham xarajatga (soft-delete qilingani ham) bog‘langan (BR-31; nofaol qilinadi); D-20) |

Nofaol kategoriya yangi xarajatga ham, tahrirlashda ko‘chirishga ham tanlanmaydi (`422 EXPENSE_CATEGORY_INACTIVE`, `field = categoryId`); eski xarajatlarda saqlanadi va nomi ko‘rinadi. Kategoriyani tekshirish xarajat tranzaksiyasida `FOR SHARE` bilan — parallel nofaol qilish/o‘chirish kutadi.

### Xarajatlar

| Endpoint | Ruxsat | Request | Javob | Xatolar |
|---|---|---|---|---|
| `GET /expenses` | `expenses.read` (hammasi) yoki `expenses.create` (**faqat o‘zi qo‘shganlari**, `createdBy` majburan o‘zi — D-23) | `page`, `pageSize`, `dateFrom`, `dateTo` (xarajat sanasi, ikkalasi ham kiradi), `categoryId`, `createdBy`, `search` (izoh, registrsiz; `%`/`_` oddiy belgi), `sort` ∈ {`date`, `amount`} (standart `date:desc`) — barchasi birgalikda | `ExpensesListResponse` = `Paginated<ExpenseDto>` + `summary: { count, totalAmount }` (butun filtr bo‘yicha, soft-delete qilinganlarsiz) | `400` (noto‘g‘ri sort/sana/UUID, `dateFrom > dateTo`) |
| `GET /expenses/:id` | `expenses.read` yoki `expenses.create` (faqat o‘ziniki, D-23) | — | `ExpenseDto` | `404` (o‘chirilgan yoki begona) |
| `POST /expenses` | `expenses.create` yoki `expenses.manage` (D-12) | `{ date, amount, categoryId, note? }` | `201 ExpenseDto` — kiritgan user nomidan | `400` (summa ≤ 0 yoki > 2 kasr — BR-32; kategoriyasiz — `Kategoriyani tanlang`; kelajak sana — `field = date`; `status`), `404` (`field = categoryId`), `422 EXPENSE_CATEGORY_INACTIVE` |
| `PATCH /expenses/:id` | `expenses.manage` | **qisman:** `{ date?, amount?, categoryId?, note? }` (kamida bittasi; `note: null` — tozalash) | `200 ExpenseDto` — faqat yuborilgan va haqiqatan o‘zgargan maydonlar yoziladi (`"1500"` = `"1500.00"`); o‘zgarishsiz — audit yo‘q | `400`, `404`, `422 EXPENSE_CATEGORY_INACTIVE` (yangi kategoriya nofaol bo‘lsa; joriy nofaol kategoriya qolishi mumkin) |
| `DELETE /expenses/:id` | `expenses.manage` | — (UI'da tasdiqlash, BR-33) | `204` — **soft delete** (`deleted_at`, `deleted_by`): qator va summa bazada qoladi, ro‘yxat/detal/yig‘ma/hisobotlardan chiqadi; qayta o‘chirish va tahrirlash → `404` | `404` |

**Sana (D-19):** `date` — `YYYY-MM-DD`; serverning joriy vaqti (`Clock`) bo‘yicha Toshkent kunidan keyin bo‘lsa → `400` (`Xarajat sanasi bugundan keyin bo‘lishi mumkin emas`); bugun va o‘tgan sanalar ruxsat.

**Audit** (izoh matni **yozilmaydi** — shaxsiy ma’lumot bo‘lishi mumkin):
- `EXPENSE_CREATED` — `{ date, amount, categoryId, hasNote }`
- `EXPENSE_UPDATED` — `{ fields: [...], changes: { date?, amount?, categoryId? : { from, to } } }` (izoh — faqat `fields` ichida nomi)
- `EXPENSE_DELETED` — `{ date, amount, categoryId }`
- `EXPENSE_CATEGORY_CREATED` (`{ name }`), `EXPENSE_CATEGORY_UPDATED` (`{ name, changes }`), `EXPENSE_CATEGORY_DELETED` (`{ name }`)

**Doiradan tashqari (Phase 12):** `GET /reports/expenses`, `finance-summary`, dashboard — hozircha mock.

---

## 13. Reports — hisobotlar (Phase 12 — tayyor)

- **Ruxsat:** barchasi `reports.read` (USER’da yo‘q → `403`).
- **Ta’riflar:** har bir hisobot `REPORT_DEFINITIONS` (`shared/src/reports`) da e’lon qilingan: ustunlar (kalit, `labelKey`, tur, tekislash), ruxsat etilgan filtrlar, `status` qiymatlari, yig‘ma va standart saralash. Backend SQL’i, frontend mock va UI sarlavhalari shu bitta manbadan.
- **Umumiy query:** `page`, `pageSize` (≤ 100), `sort=<ustun>:asc|desc` (faqat shu hisobot ustunlari; ko‘rinmaydigan ustun → `400`, `field: "sort"`), `dateFrom`, `dateTo` (sana filtri bor hisobotlarda **majburiy** — yo‘q bo‘lsa `400` `dateFrom`/`dateTo`; oraliq ≤ 366 kun — aks holda `400` `dateTo`; `dateFrom > dateTo` → `400`). Sanalar — Toshkent kunlari, ikkala chegara kiradi (D-21). Hisobotga tegishli bo‘lmagan query parametrlari e’tiborga olinmaydi.
- **Umumiy javob:** `{ columns: ReportColumn[], data: Record<string, string | number | null>[], meta: PaginationMeta, summary: ReportSummaryItem[], groups?: ReportGroupItem[] }`. Pul — `"123.45"`, miqdor — `"1.500"`, butun son — `number`, vaqt — ISO UTC. `summary` — butun filtr bo‘yicha (sahifa emas).
- **Tannarx (OWN-06):** `cost: true` deb belgilangan ustunlar (tannarx, foyda, ombor tannarxi, kirim summasi) va ularning yig‘malari faqat `products.read_cost` bilan qaytadi; aks holda `columns`, `data` va `summary`da umuman yo‘q.
- **Izchillik:** sahifa, yig‘ma va guruhlar bitta `REPEATABLE READ` tranzaksiyada o‘qiladi.
- **Export arxitekturasi:** JSON javob `ReportDefinition`dan quriladi. Kelajakda `Accept: text/csv` (yoki `?format=csv|xlsx`) uchun streaming exporter qo‘shiladi — endpointlar o‘zgarmaydi (REQ-111). Hozircha export yo‘q (UI’da tugma ham yo‘q).

| Endpoint | Tavsif (TZ §12) | Qo‘shimcha filtrlar | Ustunlar (tannarx — *) | Yig‘ma | Standart saralash |
|---|---|---|---|---|---|
| `GET /reports/sales` | Sotuvlar | `productId` (shu mahsulot qatnashgan sotuvlar), `userId`, `warehouseId`, `customerId` | `soldAt`, `number`, `customer`, `seller`, `warehouse`, `quantity`, `revenue`, `cost`*, `profit`* | `count`, `revenue`, `cost`*, `profit`* | `soldAt:desc` |
| `GET /reports/products` | Mahsulotlar (barcha mahsulotlar, sotilgan/sotilmagan) | `productId`, `groupId`, `userId`, `warehouseId`, `status=sold\|unsold` (A-17) | `product`, `group`, `received` (davrdagi tasdiqlangan kirim), `sold`, `stock` (joriy), `revenue`, `profit`* | `count`, `quantity` (sotilgan), `revenue`, `profit`* | `revenue:desc` |
| `GET /reports/warehouse-stock` | Ombor qoldig‘i (sanasiz — joriy) | `warehouseId`, `productId`, `groupId`, `status=inStock\|lowStock\|outOfStock` | `warehouse`, `product`, `group`, `stock`, `stockValue`*, `saleValue`, `status` | `count`, `quantity`, `stockValue`* | `stock:desc` |
| `GET /reports/incoming` | Kirimlar (kirim sanasi bo‘yicha) | `warehouseId`, `productId`, `userId` (yaratgan), `status=DRAFT\|CONFIRMED\|CANCELLED` | `date`, `number`, `warehouse`, `itemsCount`, `quantity`, `amount`*, `status` | `count` (hammasi), `quantity` va `amount`* — **faqat CONFIRMED** | `date:desc` |
| `GET /reports/expenses` | Xarajatlar (o‘chirilganlarsiz) | `categoryId`, `userId` (yaratgan) | `date`, `category`, `note`, `amount` | `count`, `expenses` + `groups` (kategoriya bo‘yicha: `label`, `count`, `amount`, summa kamayishi bo‘yicha) | `date:desc` |
| `GET /reports/user-sales` | User sotuvlari (sotuvi borlar; `userId` berilsa — u, sotuvsiz bo‘lsa ham) | `userId`, `warehouseId`, `productId` | `seller`, `salesCount`, `quantity`, `revenue`, `averageCheck`, `profit`* | `count` (sotuvlar), `revenue`, `profit`* | `revenue:desc` |
| `GET /reports/product-sales` | Mahsulot sotuvlari (qator darajasida) | `productId`, `groupId`, `userId`, `warehouseId` | `product`, `group`, `quantity`, `revenue`, `cost`*, `profit`* | `count`, `revenue`, `profit`* | `revenue:desc` |
| `GET /reports/customer-purchases` | Mijoz xaridlari | `productId`, `userId`, `warehouseId`, `customerId`, `search` (ism; ≥ 3 raqam bo‘lsa telefon ham) | `customer`, `phone`, `purchases`, `amount`, `averageCheck`, `lastPurchase` | `count`, `amount` | `amount:desc` |
| `GET /reports/finance-summary` | Moliyaviy xulosa (REQ-103) | `dateFrom`, `dateTo` (majburiy), `warehouseId` | quyidagi blok | — | — |

`averageCheck` = tushum ÷ sotuvlar soni (2 xona, yarim yuqoriga; sotuv bo‘lmasa `0` — D-21).

**`finance-summary` javobi** — tushunchalar aniq ajratilgan ([BUSINESS-RULES §4](BUSINESS-RULES.md#4-hisob-kitob-formulalari)):
```json
{ "period": { "dateFrom": "2026-10-01", "dateTo": "2026-10-06" },
  "warehouseId": null,
  "salesCount": 412,
  "revenue": "125000000.00",            // Tushum
  "costOfGoodsSold": "98000000.00",     // Sotilgan mahsulot tannarxi (sotuv paytidagi snapshot)       *
  "grossProfit": "27000000.00",         // Hisoblangan (yalpi) foyda = tushum − tannarx                  *
  "expenses": "4500000.00",             // Xarajatlar (o‘chirilganlarsiz)
  "netProfit": "22500000.00",           // Sof foyda = yalpi foyda − xarajatlar                          *
  "incomingPurchases": "150000000.00",  // Tasdiqlangan kirimlar summasi (xarajat EMAS)                  *
  "inventoryValueAtCost": "310000000.00"// Ombor tannarxi — joriy qoldiq × kartochka tannarxi (sanasiz)  *
}
```
- `*` — faqat `products.read_cost` bilan (aks holda kalit yo‘q).
- `warehouseId` berilsa: sotuv, kirim va ombor qiymati — shu ombor bo‘yicha; xarajatlar omborga bog‘lanmagan, shuning uchun **`expenses` va `netProfit` — `null`** (D-21 (6)); UI "—" va izoh ko‘rsatadi.

---

## 14. Dashboard (Phase 12 — tayyor)

Barcha qiymatlar so‘rov vaqtida tranzaksion jadvallardan hisoblanadi (kesh yo‘q) — inventar bilan doim mos (REQ-031). "Bugun" — serverning `Clock`i bo‘yicha Toshkent kuni (`[00:00, 24:00)` Toshkent). Dashboard’da tannarx va foyda yo‘q.

### `GET /dashboard/summary` (REQ-030, REQ-031)
- **Ruxsat:** `dashboard.admin`
- **200:** bitta `REPEATABLE READ` snapshot’dan
  ```json
  { "asOf": "2026-10-06T10:30:00.000Z", "businessDate": "2026-10-06",
    "today": { "soldQuantity": "142.000", "salesAmount": "18450000.00", "salesCount": 37 },
    "yesterday": { "salesAmount": "17100000.00" },
    "allTime": { "soldQuantity": "58210.500", "salesAmount": "7215000000.00", "salesCount": 9120 },
    "warehouse": { "totalQuantity": "9120.250", "productCount": 180,
                   "byUnit": [ { "unit": "DONA", "quantity": "8900.000" }, { "unit": "KG", "quantity": "220.250" } ] },
    "lowStock": { "count": 6, "items": [ { "productId": "…", "name": "Kabel USB-C", "unit": "DONA", "stock": "3.000", "threshold": "5.000" } ] },
    "users": { "active": 8, "total": 9, "soldToday": 5 } }
  ```
- `warehouse.productCount` — barcha omborlardagi jami qoldig‘i > 0 bo‘lgan mahsulotlar soni.
- `lowStock` — ACTIVE mahsulotlar, barcha omborlardagi jami qoldiq ≤ chegara (`min_stock`, bo‘lmasa sozlamadagi `lowStockDefaultThreshold`, A-15); `items` — eng kritik 6 tasi (`stock ÷ max(chegara, 1)`, keyin nom).

### `GET /dashboard/sales-trend?days=7|14|30`
- **Ruxsat:** `dashboard.admin` · standart `30`; boshqa qiymat → `400`.
- **200:** `[{ date, amount, count }]` — oxirgi `days` Toshkent kuni (bugun ham), bo‘sh kunlar `0` bilan.

### `GET /dashboard/top-products?days=7|14|30&limit=1..20`
- **Ruxsat:** `dashboard.admin` · standart `days=30`, `limit=5`.
- **200:** `[{ productId, name, unit, quantity, amount }]` — summa bo‘yicha kamayish (D-21).

### `GET /dashboard/my-summary` (OWN-08)
- **Ruxsat:** `dashboard.own`
- **200:** `{ businessDate, today: { salesCount, soldQuantity, salesAmount }, warehouses: [{ id, name }] }` — faqat joriy userning bugungi sotuvlari; `warehouses` — unga ruxsat etilgan **faol** omborlar (`warehouses.read_all` bo‘lsa — barcha faol omborlar).

---

## 15. Audit (Phase 13 — tayyor)

Faqat o‘qish. Audit yozuvlari service’lar ichida, biznes amali bilan **bitta tranzaksiyada** yoziladi (`AuditService.record`); yozish, o‘zgartirish va o‘chirish endpointlari **mavjud emas** (D-06, BR-25) — `POST/PUT/PATCH/DELETE /audit-logs…` → `404`. DB darajasida ham `UPDATE`/`DELETE`/`TRUNCATE` — `DV001` (trigger), `divine_app` — faqat `SELECT, INSERT`.

### `GET /audit-logs`
- **Ruxsat:** `audit.read` (ADMIN; USER → `403`)
- **Query:** `limit` (1–100, standart 50), `cursor` (oldingi javobning `nextCursor`i, o‘zgartirilmasdan), `dateFrom`, `dateTo` (Toshkent kunlari, ikkala chegara kiradi; `dateFrom > dateTo` → `400`), `actorId` (UUID), `action` (`AuditAction` katalogidan), `entityType` (`AuditEntityType`), `entityId` (≤ 64). Filtrlar AND bilan; bo‘sh qiymat — filtr yo‘q. Noto‘g‘ri yoki buzilgan `cursor` → `400` (`field: "cursor"`).
- **200:** `AuditLogPage` — `{ data: AuditLogDto[], nextCursor: string | null }`, tartib `occurredAt DESC, id DESC` (yangilari birinchi; bir vaqtdagilar — `id` bo‘yicha). `nextCursor = null` — oxirgi sahifa.
- **Cursor (keyset):** sahifalash OFFSET’siz `(occurred_at, id)` bo‘yicha — katta hajmda ham tez (`occurred_at` indekslari) va ro‘yxat ko‘rilayotganda qo‘shilgan yangi yozuvlar keyingi sahifalarni siljitmaydi (takror ham, tushib qolish ham yo‘q). Jami son qaytarilmaydi. (Dastlabki contract’dagi `page/pageSize` varianti qilinmadi — DEVELOPMENT-PLAN Phase 13: cursor pagination.)
- `userAgent` javobga chiqmaydi (faqat DB’da). `metadata`da parol, hash va token hech qachon bo‘lmaydi (yozishda olib tashlanadi, SECURITY §14).

### `GET /audit-logs/:id`
- **Ruxsat:** `audit.read` · **200:** `AuditLogDto` · **404** · ID — musbat butun son (aks holda `400`)

### Audit qilinadigan amallar (REQ-120, AC-21)

Har bir mutatsiya endpointi audit yozadi — `backend/test/db/audit-coverage.db-spec.ts` endpointlarni Nest metadata’sidan topadi va har birini shu jadval bilan solishtiradi (yangi endpoint audit qarorisiz qo‘shilsa, test yiqiladi):

| Endpoint | Amal |
|---|---|
| `POST /auth/login` | `AUTH_LOGIN_SUCCEEDED`; xato — `AUTH_LOGIN_FAILED` (actor yo‘q), lock — `AUTH_ACCOUNT_LOCKED` |
| `POST /auth/refresh` | oddiy rotatsiya audit qilinmaydi; o‘g‘irlangan token qayta ishlatilsa — `AUTH_REFRESH_REUSE_DETECTED` |
| `POST /auth/logout` | `AUTH_LOGOUT` |
| `POST /users` · `PATCH /users/:id` · `PATCH /users/:id/status` · `POST /users/:id/reset-password` · `PUT /users/:id/warehouses` | `USER_CREATED` · `USER_UPDATED` · `USER_STATUS_CHANGED` · `USER_PASSWORD_RESET` · `USER_WAREHOUSES_CHANGED` |
| `POST/PATCH/DELETE /product-groups…` | `PRODUCT_GROUP_CREATED` / `_UPDATED` / `_DELETED` |
| `POST /products` · `PATCH /products/:id` · `PATCH /products/:id/status` | `PRODUCT_CREATED` · `PRODUCT_UPDATED` (+ holat o‘zgarsa `PRODUCT_STATUS_CHANGED`) · `PRODUCT_STATUS_CHANGED` |
| `POST /warehouses` · `PATCH /warehouses/:id` · `PATCH /warehouses/:id/status` | `WAREHOUSE_CREATED` · `WAREHOUSE_UPDATED` · `WAREHOUSE_STATUS_CHANGED` |
| `POST /incoming` · `PATCH /incoming/:id` · `POST …/confirm` · `POST …/cancel` | `INCOMING_CREATED` · `INCOMING_UPDATED` · `INCOMING_CONFIRMED` · `INCOMING_CANCELLED` |
| `POST /customers` · `PATCH /customers/:id` | `CUSTOMER_CREATED` · `CUSTOMER_UPDATED` (shaxsiy qiymatlarsiz — D-17) |
| `POST /sales` | `SALE_CREATED` (+ ism bilan yangi mijoz — `CUSTOMER_CREATED`, `source: "sale"`) |
| `POST/PATCH/DELETE /expense-categories…` · `POST/PATCH/DELETE /expenses…` | `EXPENSE_CATEGORY_*` · `EXPENSE_*` (izoh matnisiz) |
| `PATCH /settings` | `SETTINGS_UPDATED` (`from/to`) |
| `GET /inventory/reconciliation` (va kunlik job) | `INVENTORY_RECONCILIATION_RUN` |

O‘zgarishsiz `PATCH` (hamma qiymat avvalgidek) audit yozmaydi; muvaffaqiyatsiz mutatsiya (`4xx`) ham — audit amal bilan birga rollback bo‘ladi.

---

## 16. Settings (Phase 12 — tayyor)

Faqat 3 ta maydon (D-21 (5)); `settings` jadvalidagi kalitlar `company_name`, `low_stock_default_threshold`, `currency_label`.

### `GET /settings`
- **Ruxsat:** `settings.read`
- **200:** `{ "companyName": "Divine.uz", "lowStockDefaultThreshold": "5", "currencyLabel": "so‘m" }`

### `PATCH /settings`
- **Ruxsat:** `settings.manage`
- **Body:** yuqoridagi maydonlarning istalgan qismi (qisman PATCH; bo‘sh body yoki boshqa kalit → `400`) · **Validatsiya:** `companyName` 1–200; `lowStockDefaultThreshold` — manfiy bo‘lmagan miqdor (≤ 3 kasr), `"7.500"` → `"7.5"` ko‘rinishida saqlanadi; `currencyLabel` 1–10
- **200:** to‘liq `SettingsDto`. Kam qoldiq chegarasi dashboard, mahsulot, ombor va hisobotlarda darhol qo‘llanadi.
- **Audit:** `SETTINGS_UPDATED` — `{ changes: { <maydon>: { from, to } } }`, faqat haqiqatda o‘zgargan maydonlar; o‘zgarish bo‘lmasa audit yozilmaydi.

---

## 17. Health (Phase 1 — tayyor)

### `GET /health`
- **Ruxsat:** public · `Cache-Control: no-store`
- **200** (hammasi ishlayapti) / **503** (kamida bitta tizim ishlamayapti):
  ```json
  { "status": "ok", "checks": { "database": "up", "redis": "up" },
    "version": "0.1.0", "timestamp": "2026-10-06T10:25:59.615Z" }
  ```
- Maxfiy ma’lumot (host, versiya tafsilotlari, xato matni) qaytarilmaydi.

---

## 18. Frontend (mock) bosqichida aniqlangan qo‘shimchalar

Frontend `frontend/src/mocks` dagi mock API bilan qurilgan. Quyidagilar UI talabi bilan contract'ga qo‘shildi va backend phase'larida implement qilinishi kerak:

| Endpoint / maydon | Maqsad | Phase |
|---|---|---|
| `GET /dashboard/sales-trend?days=7\|14\|30` → `[{ date, amount, count }]` | Dashboard "Savdo statistikasi" grafigi (kunlik, Toshkent kuni bo‘yicha) — **tayyor (§14)** | 12 |
| `GET /dashboard/top-products?days=30&limit=5` → `[{ productId, name, unit, quantity, amount }]` | "Eng ko‘p sotilgan mahsulotlar" — **tayyor (§14)** | 12 |
| `DashboardSummaryDto.yesterday.salesAmount`, `allTime.salesCount`, `warehouse.productCount`, `users.total` | KPI kartalaridagi izohlar ("kechaga nisbatan", "N ta sotuv") — **tayyor (§14)** | 12 |
| `ProductDto.received`, `sold`, `isLowStock`, `warehouses[]` | Mahsulotlar jadvali: "Kelgan", "Sotilgan", "Ombor" ustunlari | 6 |
| `GET /products?stock=low\|out`, `sort=received\|sold\|stock` | Kam qolgan va tugagan mahsulotlar filtri | 6 |
| `GET /warehouses` javobida `productCount`, `totalQuantity`, `stockValue`, `lowStockCount`; `GET /warehouses/:id` da `incoming30`, `outgoing30` | Ombor kartochkalari va kirim/chiqim xulosasi | 7 |
| ~~`ExpenseDto.status: PAID \| PENDING`~~ **BEKOR (D-11)** | "Chiqim" jadvalidagi "Holat" ustuni (UI talabi). DB ustuni Phase 11 migratsiyasida (`20261023100000_expenses_drop_status`) olib tashlandi | 11 |
| `GET /reports/<yo‘l>` — yagona shakl `{ columns[], data[], meta, summary[], groups? }` | Hisobotlar sahifasi; ustun sarlavhalari `labelKey` orqali o‘zbekcha lug‘atdan — **tayyor (§13)**; mock `/reports/:type` o‘rniga backend yo‘llari (`warehouse-stock`, `user-sales`, …) ishlatiladi | 12 |
| `POST /__demo/reset` | **Faqat mock rejim** — backendda bo‘lmaydi | — |
