# Divine.uz — Database dizayni

> **Holat:** Phase 2'da implementatsiya qilingan (2026-10-08): [`backend/prisma/schema.prisma`](../backend/prisma/schema.prisma) + [`backend/prisma/migrations/`](../backend/prisma/migrations/). Implementatsiyada qabul qilingan qarorlar va dastlabki dizayndan farqlar — [§13](#13-phase-2-qarorlari-va-dizayndan-farqlar).
> DBMS: **PostgreSQL 18**. Bog‘liq: [ARCHITECTURE](ARCHITECTURE.md) · [BUSINESS-RULES](BUSINESS-RULES.md) · [SECURITY](SECURITY.md)

---

## 1. Konvensiyalar

| Mavzu | Qoida |
|---|---|
| Nomlash | Jadval va ustunlar `snake_case`, jadval nomi ko‘plikda (`sale_items`). Prisma modellari `PascalCase` + `@@map` / `@map` |
| Primary key | `UUID`, standart qiymat `uuidv7()` (PG 18 native, vaqt bo‘yicha tartiblangan — B-tree index'ga qulay). Yuqori hajmli append-only jadvallar (`inventory_movements`, `audit_logs`) — `BIGINT GENERATED ALWAYS AS IDENTITY`. Lug‘at jadvallari (`roles`, `permissions`) — `SMALLINT` identity |
| Pul | `NUMERIC(18,2)` — hech qachon `float`/`real`/`double` emas (REQ-133) |
| Miqdor | `NUMERIC(14,3)` — kasr miqdorli mahsulotlar (kg, litr, metr) uchun |
| Vaqt belgisi | `TIMESTAMPTZ(3)`, UTC'da saqlanadi. DB sessiyasi `TIME ZONE 'UTC'` |
| Biznes sanasi | `DATE` (kirim va xarajat sanasi) — Toshkent kalendari bo‘yicha kiritiladi |
| Timestamps | Har bir o‘zgaruvchan jadvalda `created_at` va `updated_at` (`DEFAULT now()`, `updated_at` ni Prisma `@updatedAt` yangilaydi). Immutable jadvallarda faqat `created_at` |
| Ledger tartibi | `inventory_movements` tartibi `id` (IDENTITY) bo‘yicha, `created_at` bo‘yicha emas: `now()` tranzaksiya boshlangan vaqtni qaytaradi, `id` esa stock qatori lock qilingandan keyin olinadi (§5.3) |
| NaN | PostgreSQL `NUMERIC` `'NaN'` ni qabul qiladi va `'NaN' >= 0` TRUE. Shuning uchun har bir pul/miqdor CHECK'ida `<> 'NaN'` bor. Infinity va scale'dan oshgan butun qismni `NUMERIC(p,s)` o‘zi rad etadi |
| Enum | PostgreSQL `ENUM` tiplari (qiymatlari `@divine/shared` enumlari bilan aynan bir xil) |
| FK | Standart `ON DELETE RESTRICT`. Faqat aniq ko‘rsatilgan joylarda `CASCADE` (§3 jadvali, test bilan qotirilgan). RESTRICT buzilishi SQLSTATE **`23001`** (`restrict_violation`) qaytaradi, `23503` emas (§12) |
| O‘chirish | Tarixi bor yozuvlar hard-delete qilinmaydi: `status`/`is_active`/`deleted_at` |
| Matn | `VARCHAR(n)` — uzunlik chegarasi DB darajasida ham. Bo‘sh matnga qarshi `CHECK (btrim(col) <> '')` |
| Case-insensitive unique | Expression index: `UNIQUE (lower(col))` |
| Kengaytmalar | `pg_trgm` (qisman nom qidiruvi, `ILIKE '%…%'`) |

---

## 2. Enum tiplari

| Enum | Qiymatlar |
|---|---|
| `role_code` | `ADMIN`, `USER` |
| `user_status` | `ACTIVE`, `BLOCKED` |
| `product_status` | `ACTIVE`, `INACTIVE` |
| `product_unit` | `DONA`, `KG`, `LITR`, `METR` |
| `warehouse_status` | `ACTIVE`, `INACTIVE` |
| `incoming_status` | `DRAFT`, `CONFIRMED`, `CANCELLED` |
| `sale_status` | `COMPLETED` (kelajakda: `CANCELLED`, `RETURNED` — D-03) |
| `movement_type` | `INCOMING`, `SALE`, `ADJUSTMENT`\*, `RETURN`\*, `TRANSFER`\* |
| `movement_reference_type` | `INCOMING`, `SALE` |
| ~~`expense_status`~~ | ~~`PAID`, `PENDING` (A-27)~~ — **olib tashlandi** (D-11; Phase 11 migratsiyasi `20261023100000_expenses_drop_status`) |

\* zaxira qiymatlar (D-03): API ularni yaratmaydi, `inventory_movements_validate` trigger'i esa hozircha rad etadi (kelajakdagi migratsiya ochadi).

`audit_logs.action` va `audit_logs.entity_type` — `VARCHAR`. Yangi audit amali qo‘shilganda enum migratsiyasi kerak bo‘lmasligi uchun shunday tanlangan. Ruxsat etilgan qiymatlar `@divine/shared` (`AuditAction`, `AuditEntityType`) da.

---

## 3. ERD

```
                         ┌───────────┐       ┌──────────────────┐       ┌─────────────┐
                         │   roles   │1─────*│ role_permissions │*─────1│ permissions │
                         └─────┬─────┘       └──────────────────┘       └─────────────┘
                               │1
                               │*
┌───────────────┐ *    1 ┌─────┴─────┐ 1    * ┌─────────────────┐ *    1 ┌────────────┐
│ user_sessions │───────│   users   │───────│ user_warehouses │───────│ warehouses │
└───────────────┘        └─────┬─────┘        └─────────────────┘        └──┬───┬──┬──┘
                               │1 (created_by / user_id / actor_id)         │1  │1 │1
          ┌────────────────────┼─────────────────┬──────────────┐          │   │  │
          │*                   │*                │*             │*         │   │  │
   ┌──────┴─────┐       ┌──────┴─────┐    ┌──────┴─────┐  ┌─────┴──────┐   │   │  │
   │  incoming  │*──────│  (wh 1)    │    │   sales    │  │  expenses  │   │   │  │
   └──────┬─────┘       └────────────┘    └──┬──────┬──┘  └─────┬──────┘   │   │  │
          │1    incoming.warehouse_id ───────┼──────┼───────────┼──────────┘   │  │
          │*                    sales.warehouse_id ─┼───────────┼──────────────┘  │
   ┌──────┴─────────┐            │1          │*     │      *┌───┴────────────────┐│
   │ incoming_items │            │*          │      │      1│ expense_categories ││
   └──────┬─────────┘     ┌──────┴─────┐ ┌───┴─────┐│       └────────────────────┘│
          │*              │ sale_items │ │customers││                             │
          │1              └──────┬─────┘ └─────────┘│                             │
   ┌──────┴─────┐ *    1 ┌───────┴──┐               │                             │
   │  products  │───────│ (prod 1) │               │                             │
   └──┬───┬─────┘        └──────────┘               │                             │
      │*  │1                                        │                             │
      │1  │*                                        │                             │
┌─────┴────────┐  ┌──────────────────┐ *        1   │                             │
│product_groups│  │ warehouse_stock  │──────────────┼── warehouses ───────────────┘
└──────────────┘  │ PK(wh, product)  │              │
                  └──────────────────┘              │
                  ┌─────────────────────┐ *         │
                  │ inventory_movements │───────── products, warehouses, users
                  │ ref → incoming_items│ 1:1 (reference_item_id)
                  │     | sale_items    │
                  └─────────────────────┘
   audit_logs *──1 users (actor_id, NULL = tizim) · settings *──1 users (updated_by)
```

**Asosiy bog‘lanishlar:**

| Bog‘lanish | Kardinallik | FK | ON DELETE |
|---|---|---|---|
| roles → users | 1 : * | `users.role_id` | RESTRICT |
| roles ↔ permissions | * : * | `role_permissions` | CASCADE |
| users → user_sessions | 1 : * | `user_sessions.user_id` | CASCADE |
| user_sessions → user_sessions | 1 : 1 | `user_sessions.replaced_by_id` (unique, rotation zanjiri) | SET NULL |
| users ↔ warehouses | * : * | `user_warehouses` (PK `(user_id, warehouse_id)` — takroriy biriktirish yo‘q) | RESTRICT |
| product_groups → products | 1 : * | `products.group_id` | RESTRICT |
| warehouses × products → warehouse_stock | 1 : * / 1 : * | composite PK | RESTRICT |
| warehouses / products / users → inventory_movements | 1 : * | `warehouse_id`, `product_id`, `created_by` | RESTRICT |
| warehouses → incoming | 1 : * | `incoming.warehouse_id` | RESTRICT |
| incoming → incoming_items | 1 : * | `incoming_items.incoming_id` | CASCADE (faqat DRAFT — trigger) |
| products → incoming_items / sale_items | 1 : * | `product_id` | RESTRICT |
| warehouses / users / customers → sales | 1 : * | `warehouse_id`, `user_id`, `customer_id` | RESTRICT |
| sales → sale_items | 1 : * | `sale_items.sale_id` | RESTRICT |
| expense_categories → expenses | 1 : * | `expenses.category_id` | RESTRICT |
| users → audit_logs | 1 : * | `audit_logs.actor_id` (NULL = tizim) | RESTRICT |
| incoming_items / sale_items → inventory_movements | 1 : 1 | `reference_item_id` (polimorf, FK'siz; `UNIQUE(reference_type, reference_item_id)`) | — |

---

## 4. Jadvallar

Belgilar: **PK** primary key · **FK** foreign key · **U** unique · **NN** NOT NULL · ★ TZ §14 minimal ro‘yxatidan qo‘shimcha jadval yoki maydon.

### 4.1. `roles`

| Ustun | Tip | Null | Default | Izoh |
|---|---|---|---|---|
| id | SMALLINT | NN | identity | **PK** |
| code | role_code | NN | — | **U** |
| name | VARCHAR(50) | NN | — | UI'dagi nomi: "Administrator", "Foydalanuvchi" |
| created_at | TIMESTAMPTZ(3) | NN | now() | |

### 4.2. `permissions` ★

| Ustun | Tip | Null | Default | Izoh |
|---|---|---|---|---|
| id | SMALLINT | NN | identity | **PK** |
| code | VARCHAR(64) | NN | — | **U**, masalan `sales.create` |
| description | VARCHAR(200) | NN | — | O‘zbekcha tavsif |

### 4.3. `role_permissions` ★

| Ustun | Tip | Null | Izoh |
|---|---|---|---|
| role_id | SMALLINT | NN | **PK**(1), **FK** roles(id) ON DELETE CASCADE |
| permission_id | SMALLINT | NN | **PK**(2), **FK** permissions(id) ON DELETE CASCADE |

Index: `(permission_id)`. Ma’lumot seed orqali `ROLE_PERMISSIONS` (`@divine/shared`) dan yoziladi.

### 4.4. `users`

| Ustun | Tip | Null | Default | Izoh |
|---|---|---|---|---|
| id | UUID | NN | uuidv7() | **PK** |
| login | VARCHAR(32) | NN | — | Admin kiritgan ko‘rinishda saqlanadi |
| password_hash | TEXT | NN | — | `v1$` + argon2id encoded (pepper versiyasi bilan). Plaintext hech qachon saqlanmaydi |
| full_name | VARCHAR(150) | NULL | — | ★ ko‘rsatish uchun |
| role_id | SMALLINT | NN | — | **FK** roles(id) RESTRICT |
| status | user_status | NN | 'ACTIVE' | |
| failed_login_attempts | SMALLINT | NN | 0 | ketma-ket xato urinishlar |
| lockout_count | SMALLINT | NN | 0 | ketma-ket lock'lar soni (progressive lockout, [SECURITY §4](SECURITY.md#4-lockout)) |
| locked_until | TIMESTAMPTZ(3) | NULL | — | |
| last_login_at | TIMESTAMPTZ(3) | NULL | — | |
| password_changed_at | TIMESTAMPTZ(3) | NN | now() | Bu vaqtdan oldin berilgan tokenlar rad etiladi |
| created_by | UUID | NULL | — | **FK** users(id) RESTRICT; NULL = seed'dagi birinchi admin |
| created_at / updated_at | TIMESTAMPTZ(3) | NN | now() | |

- **U:** `users_login_lower_key` ON `(lower(login))` — case-insensitive unique (REQ-023, BR-10 bilan bir xil yondashuv)
- **CHECK:** `login ~ '^[A-Za-z0-9]{3,32}$'` (BR-03), `failed_login_attempts >= 0`, `lockout_count >= 0`
- **Index:** `(role_id)`, `(status)`

### 4.5. `user_sessions` ★

| Ustun | Tip | Null | Default | Izoh |
|---|---|---|---|---|
| id | UUID | NN | uuidv7() | **PK** |
| user_id | UUID | NN | — | **FK** users(id) ON DELETE CASCADE |
| token_hash | CHAR(64) | NN | — | **U**; refresh token'ning SHA-256 hex'i |
| family_id | UUID | NN | — | rotation zanjiri (reuse detection) |
| replaced_by_id | UUID | NULL | — | **FK** user_sessions(id) |
| expires_at | TIMESTAMPTZ(3) | NN | — | |
| revoked_at | TIMESTAMPTZ(3) | NULL | — | |
| revoked_reason | VARCHAR(32) | NULL | — | `LOGOUT`, `ROTATED`, `REUSE_DETECTED`, `PASSWORD_RESET`, `USER_BLOCKED` |
| ip | INET | NULL | — | |
| user_agent | VARCHAR(300) | NULL | — | |
| created_at | TIMESTAMPTZ(3) | NN | now() | |
| last_used_at | TIMESTAMPTZ(3) | NULL | — | |

- **CHECK:** `(revoked_at IS NULL) = (revoked_reason IS NULL)`
- **Index:** `(user_id)`, `(family_id)`, `(expires_at)` — muddati o‘tganlarni tozalash uchun

### 4.6. `user_warehouses` ★ (D-04)

| Ustun | Tip | Null | Default | Izoh |
|---|---|---|---|---|
| user_id | UUID | NN | — | **PK**(1), **FK** users(id) RESTRICT |
| warehouse_id | UUID | NN | — | **PK**(2), **FK** warehouses(id) RESTRICT |
| created_by | UUID | NN | — | **FK** users(id) |
| created_at | TIMESTAMPTZ(3) | NN | now() | |

Index: `(warehouse_id)`.

### 4.7. `product_groups`

| Ustun | Tip | Null | Default | Izoh |
|---|---|---|---|---|
| id | UUID | NN | uuidv7() | **PK** |
| name | VARCHAR(200) | NN | — | |
| description | VARCHAR(1000) | NULL | — | |
| is_active | BOOLEAN | NN | true | |
| created_by | UUID | NN | — | **FK** users(id) |
| created_at / updated_at | TIMESTAMPTZ(3) | NN | now() | |

- **U:** `(lower(name))` · **CHECK:** `btrim(name) <> ''`
- O‘chirish: faqat mahsulot bog‘lanmagan bo‘lsa (FK RESTRICT → `409 ENTITY_IN_USE`).

### 4.8. `products`

| Ustun | Tip | Null | Default | Izoh |
|---|---|---|---|---|
| id | UUID | NN | uuidv7() | **PK** (TZ: id) |
| name | VARCHAR(200) | NN | — | TZ: name |
| group_id | UUID | NN | — | TZ: groupId · **FK** product_groups(id) RESTRICT |
| barcode | VARCHAR(64) | NULL | — | TZ: barcode · **U** (D-05: ixtiyoriy, berilsa unique) |
| cost_price | NUMERIC(18,2) | NN | — | TZ: costPrice |
| sale_price | NUMERIC(18,2) | NN | — | TZ: salePrice |
| unit | product_unit | NN | 'DONA' | ★ o‘lchov birligi |
| allow_decimal | BOOLEAN | NN | false | ★ miqdor siyosati (TZ §8 "product policy") |
| min_stock | NUMERIC(14,3) | NULL | — | ★ kam qoldiq chegarasi; NULL bo‘lsa global sozlama |
| status | product_status | NN | 'ACTIVE' | TZ: status |
| created_by | UUID | NN | — | **FK** users(id) |
| created_at / updated_at | TIMESTAMPTZ(3) | NN | now() | TZ: timestamps |

- **U:** `products_barcode_key (barcode)`. PostgreSQL'da NULL'lar o‘zaro teng hisoblanmaydi, shuning uchun bir nechta shtrix-kodsiz mahsulot bo‘lishi mumkin.
- **CHECK:** `btrim(name) <> ''` · `cost_price >= 0` · `sale_price >= 0` · `min_stock IS NULL OR min_stock >= 0` · `barcode ~ '^[\x21-\x7E]{1,64}$'` · `unit <> 'DONA' OR allow_decimal = false`
- **Index:** `(group_id)`, `(status)`, GIN `(name gin_trgm_ops)` — qisman nom qidiruvi (REQ-054)

### 4.9. `warehouses`

| Ustun | Tip | Null | Default | Izoh |
|---|---|---|---|---|
| id | UUID | NN | uuidv7() | **PK** |
| name | VARCHAR(200) | NN | — | |
| address | VARCHAR(300) | NULL | — | |
| status | warehouse_status | NN | 'ACTIVE' | |
| created_by | UUID | NN | — | **FK** users(id) |
| created_at / updated_at | TIMESTAMPTZ(3) | NN | now() | |

- **U:** `(lower(name))` · **CHECK:** `btrim(name) <> ''` · **Index:** `(status)`

### 4.10. `warehouse_stock` — joriy qoldiq (cache)

| Ustun | Tip | Null | Default | Izoh |
|---|---|---|---|---|
| warehouse_id | UUID | NN | — | **PK**(1), **FK** warehouses(id) RESTRICT |
| product_id | UUID | NN | — | **PK**(2), **FK** products(id) RESTRICT |
| quantity | NUMERIC(14,3) | NN | 0 | |
| created_at | TIMESTAMPTZ(3) | NN | now() | Phase 2: qator birinchi marta paydo bo‘lgan vaqt |
| updated_at | TIMESTAMPTZ(3) | NN | now() | |

- **CHECK:** `quantity >= 0 AND quantity <> 'NaN'` — **manfiy qoldiqqa qarshi oxirgi himoya** (REQ-161, BR-07)
- **Index:** `(product_id)` — mahsulot bo‘yicha barcha omborlardagi qoldiq
- **Trigger:** `warehouse_stock_matches_ledger` (DEFERRABLE INITIALLY DEFERRED) — COMMIT paytida joriy qoldiq = oxirgi ledger yozuvining `balance_after` (yozuv bo‘lmasa 0). Ledger'siz stock o‘zgarishi rad etiladi (INV-1). `warehouse_stock_no_truncate`.
- Qator birinchi kirimda `INSERT … ON CONFLICT` orqali yaratiladi. Stockni faqat `InventoryService` o‘zgartiradi.

### 4.10a. `warehouse_sales_totals` — sotilgan miqdor yig‘masi (Phase 17)

| Ustun | Tip | Null | Default | Izoh |
|---|---|---|---|---|
| warehouse_id | UUID | NN | — | **PK**(1), **FK** warehouses(id) RESTRICT |
| product_id | UUID | NN | — | **PK**(2), **FK** products(id) RESTRICT |
| quantity | NUMERIC(14,3) | NN | 0 | Jami sotilgan (ledger SALE harakatlari, ishorasi teskari) |

- **Yozuvchi — faqat trigger:** `inventory_movements_sales_totals` (AFTER INSERT, `movement_type = 'SALE'`) → `warehouse_sales_totals_apply()` (SECURITY DEFINER, `search_path` qotirilgan) — `INSERT … ON CONFLICT DO UPDATE quantity + Δ`. Harakatlar mahsulot tartibida va (ombor, mahsulot) qoldiq qatori qulflangan holda yoziladi — yangi qulf tartibi yo‘q. Sotuvni qaytarish yo‘q (D-03) — yig‘ma faqat o‘sadi.
- **Huquq:** `divine_app` — faqat `SELECT` (ilova yig‘mani to‘g‘ridan-to‘g‘ri o‘zgartira olmaydi).
- **CHECK:** `quantity >= 0 AND quantity <> 'NaN'`. **Index:** `(product_id)`.
- **Nazorat:** `reconcile_sales_totals` view — ledger bilan teng bo‘lmagan juftliklar (bo‘sh bo‘lishi shart; `scripts/prod/verify-db.sh` invarianti).
- **Sabab** (Phase 17 yuklama testi): kassa katalogi `sort=sold:desc` har so‘rovda ombordagi barcha sotuv qatorlarini `sales` bilan JOIN qilardi — bir yillik tarixli omborda p95 ~1,5 s va 503; §7.3.
- Migratsiya `20261030100000_warehouse_sales_totals` mavjud ma’lumotni ledger'dan bir martalik to‘ldiradi (shu tranzaksiyada).

### 4.11. `inventory_movements` — o‘zgarmas ledger

| Ustun | Tip | Null | Default | Izoh |
|---|---|---|---|---|
| id | BIGINT | NN | identity | **PK** |
| warehouse_id | UUID | NN | — | **FK** warehouses(id) |
| product_id | UUID | NN | — | **FK** products(id) |
| movement_type | movement_type | NN | — | |
| quantity | NUMERIC(14,3) | NN | — | **ishorali**: kirim `+`, chiqim `−` |
| balance_after | NUMERIC(14,3) | NN | — | harakatdan keyingi qoldiq (shu ombor + mahsulot) |
| unit_cost | NUMERIC(18,2) | NULL | — | kirimda — kirim narxi; sotuvda — snapshot tannarx |
| reference_type | movement_reference_type | NN | — | `INCOMING` / `SALE` |
| reference_id | UUID | NN | — | `incoming.id` / `sales.id` |
| reference_item_id | UUID | NN | — | `incoming_items.id` / `sale_items.id` |
| created_by | UUID | NN | — | **FK** users(id) — actor |
| created_at | TIMESTAMPTZ(3) | NN | now() | |

- **U:** `(reference_type, reference_item_id)` — bitta item ikki marta post qilinmaydi (idempotency, DB darajasida)
- **CHECK:**
  - `quantity <> 0`
  - `balance_after >= 0`
  - `unit_cost IS NULL OR unit_cost >= 0`
  - `(movement_type = 'INCOMING' AND quantity > 0) OR (movement_type = 'SALE' AND quantity < 0) OR movement_type IN ('ADJUSTMENT','RETURN','TRANSFER')`
  - `(movement_type = 'INCOMING') = (reference_type = 'INCOMING')` (faqat INCOMING/SALE uchun)
- **Index:** `(warehouse_id, product_id, id DESC)` — ombor/mahsulot tarixi va oxirgi balans · `(product_id, id DESC)` · `(reference_type, reference_id)` · `(created_at)` — sana oralig‘i
- **Trigger:**
  - `inventory_movements_immutable` (`BEFORE UPDATE OR DELETE`) va `inventory_movements_no_truncate` → `DV001`
  - `inventory_movements_validate` (`BEFORE INSERT`) → `DV003`: (1) faqat `INCOMING`/`SALE`; (2) havola qilingan hujjat qatori mavjud, mahsulot, ombor, miqdor (ishora bilan) va `unit_cost` aynan mos; kirim hujjati `CONFIRMED`; (3) `balance_after = oldingi balance_after + quantity`; (4) `balance_after = joriy warehouse_stock.quantity`

### 4.12. `incoming` — kirim hujjati

| Ustun | Tip | Null | Default | Izoh |
|---|---|---|---|---|
| id | UUID | NN | uuidv7() | **PK** |
| number | BIGINT | NN | identity | **U**; UI'da `K-000123` ko‘rinishida |
| incoming_date | DATE | NN | — | TZ: date (API maydoni `date`) |
| warehouse_id | UUID | NN | — | TZ: warehouseId · **FK** warehouses(id) |
| notes | VARCHAR(1000) | NULL | — | TZ: notes |
| status | incoming_status | NN | 'DRAFT' | ★ |
| total_quantity | NUMERIC(14,3) | NN | 0 | Σ items.quantity — **server hisoblaydi** |
| total_amount | NUMERIC(18,2) | NN | 0 | Σ items.line_total — server hisoblaydi |
| created_by | UUID | NN | — | TZ: createdBy · **FK** users(id) |
| confirmed_by | UUID | NULL | — | **FK** users(id) |
| confirmed_at | TIMESTAMPTZ(3) | NULL | — | |
| cancelled_by | UUID | NULL | — | **FK** users(id) |
| cancelled_at | TIMESTAMPTZ(3) | NULL | — | |
| created_at / updated_at | TIMESTAMPTZ(3) | NN | now() | |

- **CHECK:**
  - `total_quantity >= 0`, `total_amount >= 0`
  - `(status = 'CONFIRMED') = (confirmed_at IS NOT NULL AND confirmed_by IS NOT NULL)`
  - `(status = 'CANCELLED') = (cancelled_at IS NOT NULL AND cancelled_by IS NOT NULL)`
- **Index:** `(warehouse_id, incoming_date)`, `(status, incoming_date)`, `(incoming_date)`, `(created_by)`
- **Trigger:**
  - `incoming_guard` (`BEFORE INSERT OR UPDATE OR DELETE`) → `DV002`/`DV004`: yangi kirim faqat `DRAFT`; `DRAFT` bo‘lmagan qatorni yangilash yoki o‘chirish rad etiladi (D-07). Yagona ruxsat: DRAFT → CONFIRMED/CANCELLED. Tasdiqlashda hujjat bo‘sh emas va `total_quantity`/`total_amount` qatorlar yig‘indisiga teng (TZ misoli 50+30+100+20 = 200 DB darajasida tekshiriladi; hisoblash — application, A-24)
  - `incoming_confirmed_ledger` (DEFERRED, `WHEN status = 'CONFIRMED'`) → `DV003`: COMMIT paytida har bir qator uchun aynan bitta ledger yozuvi
  - `incoming_no_truncate`

### 4.13. `incoming_items`

| Ustun | Tip | Null | Default | Izoh |
|---|---|---|---|---|
| id | UUID | NN | uuidv7() | **PK** |
| incoming_id | UUID | NN | — | **FK** incoming(id) ON DELETE CASCADE |
| product_id | UUID | NN | — | TZ: productId · **FK** products(id) |
| product_name | VARCHAR(200) | NN | — | ★ snapshot (D-08): mahsulot keyin qayta nomlansa ham hujjat o‘zgarmaydi |
| barcode | VARCHAR(64) | NULL | — | ★ snapshot (D-08) |
| quantity | NUMERIC(14,3) | NN | — | TZ: quantity |
| cost_price | NUMERIC(18,2) | NN | — | TZ: costPrice (shu kirimdagi narx) |
| line_total | NUMERIC(18,2) | NN | generated | `GENERATED ALWAYS AS (round(quantity * cost_price, 2)) STORED` |
| created_at / updated_at | TIMESTAMPTZ(3) | NN | now() | |

- **U:** `(incoming_id, product_id)` — bitta kirimda mahsulot bir marta (A-09)
- **CHECK:** `quantity > 0`, `cost_price >= 0`
- **Index:** `(product_id)`
- **Trigger:** `incoming_items_guard` — ota `incoming.status <> 'DRAFT'` bo‘lsa INSERT/UPDATE/DELETE rad etiladi (`DV002`); qatorni boshqa hujjatga ko‘chirib bo‘lmaydi. Ota-qator `FOR SHARE` bilan lock qilinadi — parallel tasdiqlash bilan poyga yo‘q. `incoming_items_no_truncate`

### 4.14. `customers`

| Ustun | Tip | Null | Default | Izoh |
|---|---|---|---|---|
| id | UUID | NN | uuidv7() | **PK** |
| name | VARCHAR(150) | NN | — | majburiy (BR-05) |
| phone | VARCHAR(13) | NULL | — | ixtiyoriy (BR-06), `+998XXXXXXXXX` |
| notes | VARCHAR(1000) | NULL | — | |
| purchase_count | INTEGER | NN | 0 | ★ yig‘ma (sotuv tranzaksiyasida yangilanadi) |
| total_spent | NUMERIC(18,2) | NN | 0 | ★ yig‘ma |
| last_purchase_at | TIMESTAMPTZ(3) | NULL | — | ★ yig‘ma |
| created_by | UUID | NN | — | **FK** users(id) |
| created_at / updated_at | TIMESTAMPTZ(3) | NN | now() | |

- **CHECK:** `btrim(name) <> ''` · `phone IS NULL OR phone ~ '^\+998[0-9]{9}$'` · `purchase_count >= 0` · `total_spent >= 0`
- **Index:** `(phone) WHERE phone IS NOT NULL` (unique emas — A-23), GIN `(name gin_trgm_ops)`, `(last_purchase_at)`
- Yig‘ma ustunlar cache hisoblanadi; reconciliation `sales`dan qayta hisoblab tekshiradi.

### 4.15. `sales`

| Ustun | Tip | Null | Default | Izoh |
|---|---|---|---|---|
| id | UUID | NN | uuidv7() | **PK** |
| number | BIGINT | NN | identity | **U**; UI'da `S-000123` |
| sold_at | TIMESTAMPTZ(3) | NN | now() | sana va vaqt (REQ-076) |
| user_id | UUID | NN | — | sotuvchi · **FK** users(id) |
| warehouse_id | UUID | NN | — | **FK** warehouses(id) |
| customer_id | UUID | NN | — | **FK** customers(id) |
| customer_name_snapshot | VARCHAR(150) | NN | — | sotuv paytidagi ism (tarix o‘zgarmasligi uchun) |
| customer_phone_snapshot | VARCHAR(13) | NULL | — | |
| total_quantity | NUMERIC(14,3) | NN | — | Σ items.quantity |
| total_amount | NUMERIC(18,2) | NN | — | Σ items.line_total (tushum) |
| total_cost | NUMERIC(18,2) | NN | — | Σ items.line_cost (tannarx) |
| status | sale_status | NN | 'COMPLETED' | |
| idempotency_key | UUID | NN | — | **U** (REQ-145) |
| request_hash | CHAR(64) | NN | — | kanonik payload SHA-256 (kalitni boshqa payload bilan qayta ishlatishni aniqlash uchun) |
| created_at | TIMESTAMPTZ(3) | NN | now() | |

- **CHECK:** `btrim(customer_name_snapshot) <> ''` · `total_quantity > 0` · `total_amount >= 0` · `total_cost >= 0`
- **Index:** `(sold_at)`, `(user_id, sold_at)`, `(warehouse_id, sold_at)`, `(customer_id, sold_at)`
- **Trigger:**
  - `sales_immutable` (UPDATE/DELETE) va `sales_no_truncate` → `DV001` (D-03, D-07)
  - `sales_consistency` (DEFERRED, `AFTER INSERT`) → `DV004`/`DV003`: COMMIT paytida kamida bitta qator, `total_quantity`/`total_amount`/`total_cost` qatorlar yig‘indisiga teng, har bir qator uchun aynan bitta ledger yozuvi

### 4.16. `sale_items`

| Ustun | Tip | Null | Default | Izoh |
|---|---|---|---|---|
| id | UUID | NN | uuidv7() | **PK** |
| sale_id | UUID | NN | — | **FK** sales(id) RESTRICT |
| product_id | UUID | NN | — | **FK** products(id) |
| product_name | VARCHAR(200) | NN | — | ★ snapshot (D-08): chek mahsulot qayta nomlansa ham o‘zgarmaydi |
| barcode | VARCHAR(64) | NULL | — | ★ snapshot (D-08) |
| quantity | NUMERIC(14,3) | NN | — | |
| unit_price | NUMERIC(18,2) | NN | — | snapshot `products.sale_price` |
| unit_cost | NUMERIC(18,2) | NN | — | snapshot `products.cost_price` (D-02) |
| line_total | NUMERIC(18,2) | NN | generated | `round(quantity * unit_price, 2)` |
| line_cost | NUMERIC(18,2) | NN | generated | `round(quantity * unit_cost, 2)` |

- **U:** `(sale_id, product_id)` · **CHECK:** `quantity > 0`, `unit_price >= 0`, `unit_cost >= 0`
- **Index:** `(product_id, sale_id)`
- **Trigger:** `sale_items_immutable` (UPDATE/DELETE), `sale_items_no_truncate` → `DV001`; `sale_items_consistency` (DEFERRED, `AFTER INSERT`) — ota-sotuvni qayta tekshiradi, shuning uchun yakunlangan sotuvga keyinroq qator qo‘shib bo‘lmaydi (totallar mos kelmay qoladi → `DV004`)

### 4.17. `expense_categories` ★ (A-10)

| Ustun | Tip | Null | Default | Izoh |
|---|---|---|---|---|
| id | UUID | NN | uuidv7() | **PK** |
| name | VARCHAR(100) | NN | — | |
| is_active | BOOLEAN | NN | true | |
| created_by | UUID | NN | — | **FK** users(id) |
| created_at / updated_at | TIMESTAMPTZ(3) | NN | now() | |

- **U:** `(lower(name))` · **CHECK:** `btrim(name) <> ''`

### 4.18. `expenses`

| Ustun | Tip | Null | Default | Izoh |
|---|---|---|---|---|
| id | UUID | NN | uuidv7() | **PK** |
| expense_date | DATE | NN | — | TZ: date |
| amount | NUMERIC(18,2) | NN | — | TZ: amount |
| category_id | UUID | NN | — | TZ: category · **FK** expense_categories(id) RESTRICT · majburiy (D-19) |
| note | VARCHAR(1000) | NULL | — | TZ: note |
| created_by | UUID | NN | — | TZ: createdBy · **FK** users(id) |
| updated_by | UUID | NULL | — | **FK** users(id) |
| deleted_at | TIMESTAMPTZ(3) | NULL | — | soft delete |
| deleted_by | UUID | NULL | — | **FK** users(id) |
| created_at / updated_at | TIMESTAMPTZ(3) | NN | now() | |

- **CHECK:** `amount > 0 AND amount <> 'NaN'` · `(deleted_at IS NULL) = (deleted_by IS NULL)` · `note` bo‘sh satr emas
- **Index:** `(expense_date) WHERE deleted_at IS NULL`, `(category_id)`, `(created_by)`

### 4.19. `audit_logs` — o‘zgarmas audit jurnali

| Ustun | Tip | Null | Default | Izoh |
|---|---|---|---|---|
| id | BIGINT | NN | identity | **PK** |
| occurred_at | TIMESTAMPTZ(3) | NN | now() | timestamp |
| actor_id | UUID | NULL | — | **FK** users(id); NULL = tizim yoki noma’lum (masalan, xato login) |
| action | VARCHAR(64) | NN | — | `AuditAction` |
| entity_type | VARCHAR(32) | NN | — | `AuditEntityType` |
| entity_id | VARCHAR(64) | NULL | — | |
| metadata | JSONB | NN | '{}' | o‘zgarish tafsilotlari (`before`/`after` diff, totallar). **Parol, hash va token hech qachon yozilmaydi** |
| ip | INET | NULL | — | |
| user_agent | VARCHAR(300) | NULL | — | |
| request_id | VARCHAR(64) | NULL | — | log bilan bog‘lash uchun |

- **Index:** `(occurred_at DESC)`, `(entity_type, entity_id, occurred_at DESC)`, `(actor_id, occurred_at DESC)`, `(action, occurred_at DESC)`
- **CHECK:** `action`, `entity_type` — `^[A-Z][A-Z_]*$`; `metadata` — faqat JSON obyekt
- **Trigger:** `audit_logs_immutable` (UPDATE/DELETE) va `audit_logs_no_truncate` → `DV001` (D-06). Qo‘shimcha ravishda `divine_app` roliga faqat `SELECT, INSERT` berilgan (§6)

### 4.20. `settings` ★

| Ustun | Tip | Null | Default | Izoh |
|---|---|---|---|---|
| key | VARCHAR(64) | NN | — | **PK** |
| value | JSONB | NN | — | |
| updated_by | UUID | NULL | — | **FK** users(id) |
| updated_at | TIMESTAMPTZ(3) | NN | now() | |

Seed kalitlari: `company_name` (`"Divine.uz"`), `low_stock_default_threshold` (`"5"`), `currency_label` (`"so‘m"`).

---

## 5. Inventory ledger va `warehouse_stock` munosabati

### 5.1. Model

```
         yozish (bitta tranzaksiyada, ikkalasi birga)
  ┌──────────────────────────┐            ┌──────────────────────────────┐
  │ warehouse_stock          │            │ inventory_movements (ledger) │
  │ (warehouse, product) →   │◀── teng ──▶│ Σ quantity GROUP BY          │
  │ quantity (joriy holat)   │  invariant │ (warehouse, product)         │
  └──────────────────────────┘            └──────────────────────────────┘
     tez o‘qish: qoldiq,                     to‘liq tarix: kim, qachon,
     sotuv tekshiruvi                        nima sababdan, balance_after
```

- **Ledger** — haqiqat manbai va audit izi. Har bir harakat yangi qator, hech qachon o‘zgarmaydi va o‘chmaydi.
- **`warehouse_stock`** — ledger'ning materializatsiya qilingan yig‘indisi (cache). Sotuv tekshiruvi va qoldiqni ko‘rsatish uchun tez yo‘l.

### 5.2. Invariantlar

| # | Invariant | Kafolat |
|---|---|---|
| INV-1 | `warehouse_stock.quantity = Σ inventory_movements.quantity` (har bir ombor va mahsulot uchun) | Bitta tranzaksiya + **DB:** `inventory_movements_validate` (balans zanjiri) va `warehouse_stock_matches_ledger` (COMMIT'da qoldiq = oxirgi balans) + `reconcile_inventory_stock` |
| INV-2 | `warehouse_stock.quantity >= 0` | Atomic shartli UPDATE + `CHECK` |
| INV-3 | Har bir movement'ning `balance_after` qiymati shu harakatdan keyingi `warehouse_stock.quantity` ga teng | `RETURNING quantity` qiymati yoziladi; row lock tartibni kafolatlaydi; **DB:** `inventory_movements_validate` |
| INV-4 | Bitta kirim yoki sotuv itemi faqat bitta movement hosil qiladi va u qatorga aynan mos | `UNIQUE(reference_type, reference_item_id)` + `inventory_movements_validate` |
| INV-5 | Ledger o‘zgarmaydi | Trigger + DB huquqlari (§6) |
| INV-6 | Kirim movement'i musbat, sotuv movement'i manfiy | `CHECK` |
| INV-7 | `Σ sale_items.quantity` (mahsulot, ombor bo‘yicha) = `−Σ movements(SALE)` | Bitta tranzaksiya + **DB:** `sales_consistency` / `incoming_confirmed_ledger` (COMMIT'da har bir qator uchun harakat) + `reconcile_document_movements` |

Barcha invariantlar Phase 2 DB testlarida tekshirilgan (`backend/test/db/inventory.db-spec.ts`), shu jumladan 20 ta parallel sotuv ssenariysi.

### 5.3. Yozish algoritmlari

**Stockni oshirish (kirim tasdiqlash):**
```sql
INSERT INTO warehouse_stock (warehouse_id, product_id, quantity, updated_at)
VALUES ($1, $2, $3, now())
ON CONFLICT (warehouse_id, product_id)
DO UPDATE SET quantity = warehouse_stock.quantity + EXCLUDED.quantity, updated_at = now()
RETURNING quantity;   -- → balance_after

INSERT INTO inventory_movements
  (warehouse_id, product_id, movement_type, quantity, balance_after, unit_cost,
   reference_type, reference_id, reference_item_id, created_by)
VALUES ($1, $2, 'INCOMING', $3, $balance_after, $cost, 'INCOMING', $incoming_id, $item_id, $actor);
```

**Stockni kamaytirish (sotuv) — overselling'siz:**
```sql
UPDATE warehouse_stock
   SET quantity = quantity - $3, updated_at = now()
 WHERE warehouse_id = $1 AND product_id = $2 AND quantity >= $3
RETURNING quantity;   -- 0 qator → INSUFFICIENT_STOCK → ROLLBACK

INSERT INTO inventory_movements (…, movement_type, quantity, …)
VALUES (…, 'SALE', -$3, …);
```

**Concurrency:** shartli `UPDATE` qatorni lock qiladi. Parallel tranzaksiya kutadi va lock bo‘shagach `WHERE quantity >= $3` shartini **yangi** qiymat bilan qayta baholaydi (PostgreSQL READ COMMITTED EvalPlanQual). Shu tufayli 10 dona qoldiqqa 20 ta parallel 1 donalik sotuvdan aynan 10 tasi o‘tadi. Ko‘p itemli operatsiyalarda qatorlar `product_id` bo‘yicha tartiblangan holda lock qilinadi (deadlock oldini olish uchun). `40P01` xatosida 3 martagacha qayta urinish.

### 5.4. Reconciliation

Phase 2'da to‘rtta view yaratilgan. Har biri **faqat nomuvofiq qatorlarni** qaytaradi (bo‘sh natija = hammasi joyida). Trigger'lar bu holatlarni yozish paytida oldini oladi; view'lar trigger'lar chetlab o‘tilgan (superuser `session_replication_role = replica`, qo‘lda SQL) yoki eski ma’lumot import qilingan holatlar uchun mustaqil nazorat.

| View | Invariant | Natija ustunlari |
|---|---|---|
| `reconcile_inventory_stock` | INV-1, INV-3: qoldiq = Σ ledger = oxirgi `balance_after` | `warehouse_id, product_id, stock_quantity, ledger_quantity, last_balance_after` |
| `reconcile_document_movements` | INV-4, INV-7: har bir sotuv/tasdiqlangan kirim qatoriga mos harakat; tasdiqlanmagan kirimda harakat yo‘q; egasiz harakat yo‘q | `document_type, document_id, item_id, product_id, warehouse_id, expected_quantity, movement_quantity, issue` (`MISSING_MOVEMENT`, `MISMATCH`, `MOVEMENT_ON_UNCONFIRMED`, `ORPHAN_MOVEMENT`) |
| `reconcile_document_totals` | Hujjat totallari = qatorlar yig‘indisi | `document_type, document_id, stored_*, items_*` |
| `reconcile_customer_aggregates` | `customers.purchase_count/total_spent/last_purchase_at` = sotuvlardan hisoblangan | `customer_id, stored_*, actual_*` |

`reconcile_inventory_stock` ning asosi — quyidagi so‘rov (view unga oxirgi balans tekshiruvini ham qo‘shadi):

```sql
-- Stock va ledger farqi (bo'sh natija = hammasi joyida)
SELECT COALESCE(s.warehouse_id, m.warehouse_id) AS warehouse_id,
       COALESCE(s.product_id,  m.product_id)    AS product_id,
       COALESCE(s.quantity, 0)                  AS stock_quantity,
       COALESCE(m.ledger_quantity, 0)           AS ledger_quantity
  FROM warehouse_stock s
  FULL OUTER JOIN (
        SELECT warehouse_id, product_id, SUM(quantity) AS ledger_quantity
          FROM inventory_movements
         GROUP BY warehouse_id, product_id
  ) m ON m.warehouse_id = s.warehouse_id AND m.product_id = s.product_id
 WHERE COALESCE(s.quantity, 0) <> COALESCE(m.ledger_quantity, 0);
```

- `GET /api/v1/inventory/reconciliation` (ADMIN, `inventory.reconcile`) va kunlik rejalashtirilgan job (Phase 7) shu view'larni o‘qiydi; `divine_app` roliga `SELECT` berilgan.
- Natija audit'ga yoziladi (`INVENTORY_RECONCILIATION_RUN`). Farq topilsa, `error` darajasida log yoziladi.
- **Avtomatik tuzatish yo‘q.** Tuzatish faqat inson qarori bilan (kelajakdagi `ADJUSTMENT` harakati, D-03).

### 5.5. Hisoblangan ko‘rsatkichlar (manba jadvallari)

| Ko‘rsatkich | Manba |
|---|---|
| Joriy qoldiq (ombor) | `warehouse_stock` |
| Mahsulot: jami kirim | `Σ movements.quantity WHERE movement_type='INCOMING'` |
| Mahsulot: jami sotilgan | `Σ warehouse_sales_totals.quantity` (ombor doirasi bo‘yicha; = `Σ sale_items.quantity`, nazorat — `reconcile_sales_totals`; Phase 17) |
| Ombor harakatlari tarixi | `inventory_movements` (`warehouse_id`, vaqt bo‘yicha) |
| Dashboard: ombordagi jami miqdor | `Σ warehouse_stock.quantity` (birlik bo‘yicha bo‘linma bilan — A-L06) |

---

## 6. DB rollari va huquqlar

| Rol | Ishlatilishi | Huquqlar |
|---|---|---|
| `divine_owner` | Migratsiyalar (`MIGRATION_DATABASE_URL`) | Sxema egasi: DDL |
| `divine_app` | Ilova runtime (`DATABASE_URL`) | Barcha jadvallarda `SELECT, INSERT, UPDATE, DELETE`, **istisnolar:** `inventory_movements`, `audit_logs` — faqat `SELECT, INSERT`; `sales`, `sale_items` — `SELECT, INSERT`; `warehouse_sales_totals` (hosila, Phase 17) — faqat `SELECT`. Sequence'larda `USAGE` |

Bu ikki qatlamli himoya: app foydalanuvchisi ledger va auditni o‘zgartira olmaydi (huquq yo‘q), owner esa trigger'larga duch keladi.

**Implementatsiya (migratsiya `20261008100400_app_role_and_grants`):**
- `divine_app` — `NOLOGIN` guruh roli. Migratsiya uni yaratadi; migratsiya foydalanuvchisida `CREATEROLE` bo‘lmasa va rol oldindan yo‘q bo‘lsa, migratsiya aniq xabar bilan **to‘xtaydi** (jim o‘tkazib yuborilmaydi).
- Ilova login foydalanuvchisi unga a’zo qilinadi: `CREATE ROLE divine_api LOGIN PASSWORD '…' IN ROLE divine_app;` → `DATABASE_URL`.
- `divine_owner` (sxema egasi, `MIGRATION_DATABASE_URL`) — DBA yaratadi; `prisma.config.ts` `MIGRATION_DATABASE_URL` berilsa shuni ishlatadi, aks holda `DATABASE_URL`.
- Huquqlar har bir jadval uchun **aniq** beriladi; `ALTER DEFAULT PRIVILEGES` ishlatilmaydi — yangi o‘zgarmas jadvalga tasodifan `UPDATE` berilmasligi uchun. Yangi jadval qo‘shgan migratsiya `GRANT` ni ham o‘zi yozadi (`migrations.db-spec.ts` har bir jadvalda huquq borligini tekshiradi).
- Dev muhitida (docker-compose) bitta superuser bilan ishlaydi. **Production (Phase 17, `docker-compose.prod.yml`):** `docker/postgres/init-roles.sh` initdb'da `divine_owner` (LOGIN, baza va `public` egasi — migratsiya va seed), `divine_app` (NOLOGIN) va `divine_api` (LOGIN, `divine_app` a’zosi — ilova) rollarini yaratadi; `PUBLIC`dan baza ulanishi va `public`da CREATE olib tashlanadi; postgres superuser faqat konteyner ichidagi socket (peer) orqali — backup va tiklash uchun. Tekshiruv: `scripts/prod/security-check.sh` (ilova ulanishi `divine_api`, superuser emas; `divine_*` rollarida SUPERUSER/CREATEROLE/CREATEDB yo‘q).

---

## 7. Indexlash strategiyasi

| So‘rov (REQ) | Index |
|---|---|
| Login bo‘yicha kirish (REQ-023, REQ-092) | `UNIQUE lower(users.login)` |
| Shtrix-kod qidiruvi (REQ-054, REQ-071) | `UNIQUE products.barcode` |
| Nom bo‘yicha qisman qidiruv | GIN trgm `products.name`, `customers.name` |
| Sotuvlar: sana oralig‘i (REQ-090) | `sales(sold_at)` |
| Sotuvlar: user + sana | `sales(user_id, sold_at)` |
| Sotuvlar: ombor + sana | `sales(warehouse_id, sold_at)` |
| Mijoz xarid tarixi (REQ-080) | `sales(customer_id, sold_at)` |
| Mahsulot sotuv tarixi, mahsulot filtri | `sale_items(product_id, sale_id)` |
| Ombor harakatlari | `inventory_movements(warehouse_id, product_id, created_at DESC)` |
| Mahsulot bo‘yicha qoldiq | `warehouse_stock(product_id)` |
| Kirimlar: ombor/holat/sana | `incoming(warehouse_id, incoming_date)`, `incoming(status, incoming_date)` |
| Xarajatlar: sana | `expenses(expense_date) WHERE deleted_at IS NULL` |
| Audit filtrlari | `audit_logs(occurred_at)`, `(entity_type, entity_id, …)`, `(actor_id, …)`, `(action, …)` |
| FK ustunlari | Ota-qator o‘chirilishi/yangilanishi mumkin bo‘lgan FK'larda index (PostgreSQL avtomatik yaratmaydi). `created_by`/`updated_by`/`deleted_by` → `users` FK'lari **index'siz**: user hard-delete qilinmaydi (§11), shuning uchun bu index'lar faqat yozishni sekinlashtirardi. Istisno: so‘rovda filtr bo‘ladiganlari (`incoming.created_by`, `expenses.created_by`) |

#### 7.1. Index katalogi (Phase 2 — har bir index nima uchun kerak)

| Jadval | Index | Turi | Sabab (so‘rov / REQ) |
|---|---|---|---|
| users | `users_login_lower_key (lower(login))` | UNIQUE expression | Login bo‘yicha kirish va case-insensitive unique (REQ-023, REQ-092). Phase 4 login so‘rovi `WHERE lower(login) = lower($1)` |
| users | `(role_id)`, `(status)` | B-tree | Userlar ro‘yxati filtri; `roles` RESTRICT tekshiruvi |
| user_sessions | `token_hash` UNIQUE | B-tree | Refresh token bo‘yicha qidiruv |
| user_sessions | `(user_id)`, `(family_id)`, `(expires_at)`, `replaced_by_id` UNIQUE | B-tree | Userning sessiyalarini bekor qilish; reuse detection'da zanjirni bekor qilish; muddati o‘tganlarni tozalash; rotation zanjiri (o‘chirishda FK tekshiruvi) |
| role_permissions | PK `(role_id, permission_id)`, `(permission_id)` | B-tree | Rol permissionlari; permission o‘chirilganda CASCADE |
| user_warehouses | PK `(user_id, warehouse_id)`, `(warehouse_id)` | B-tree | Userning omborlari (ownership tekshiruvi); omborga biriktirilgan userlar |
| product_groups | `(lower(name))` UNIQUE | expression | Guruh nomi takrorlanmasligi |
| products | `products_barcode_key (barcode)` | UNIQUE | Skaner (`lookup`) va BR-10 (REQ-051, REQ-054, REQ-071) |
| products | `products_name_trgm_idx` | GIN `gin_trgm_ops` | Nom bo‘yicha qisman qidiruv `ILIKE '%…%'` (REQ-054) |
| products | `(group_id)`, `(status)` | B-tree | Guruh filtri va guruh o‘chirishda RESTRICT tekshiruvi; faol/arxiv filtri |
| warehouses | `(lower(name))` UNIQUE, `(status)` | expression / B-tree | Nom takrorlanmasligi; faol omborlar ro‘yxati |
| warehouse_stock | PK `(warehouse_id, product_id)` | B-tree | Ombor qoldig‘i va sotuvdagi atomic UPDATE (REQ-043) |
| warehouse_stock | `(product_id)` | B-tree | Mahsulot bo‘yicha barcha omborlardagi qoldiq |
| inventory_movements | `(reference_type, reference_item_id)` UNIQUE | B-tree | Bitta qator — bitta harakat (INV-4, idempotency) |
| inventory_movements | `(warehouse_id, product_id, id DESC)` | B-tree | Ombor/mahsulot tarixi va trigger'lardagi "oxirgi balans" (`LIMIT 1`) |
| inventory_movements | `(product_id, id DESC)` | B-tree | Mahsulot harakatlari tarixi |
| inventory_movements | `(reference_type, reference_id)` | B-tree | Hujjatning harakatlari (sotuv/kirim detali, `sales_consistency`) |
| inventory_movements | `(created_at)` | B-tree | Sana oralig‘idagi harakatlar (ombor detali "30 kun") |
| incoming | `number` UNIQUE | B-tree | `K-000123` bo‘yicha qidiruv |
| incoming | `(warehouse_id, incoming_date)`, `(status, incoming_date)`, `(incoming_date)`, `(created_by)` | B-tree | Kirimlar ro‘yxati filtrlari: ombor, holat, sana oralig‘i, muallif |
| incoming_items | `(incoming_id, product_id)` UNIQUE, `(product_id)` | B-tree | A-09; mahsulotning kirim tarixi va "jami kelgan" |
| customers | `customers_phone_idx (phone) WHERE phone IS NOT NULL` | partial | Telefon bo‘yicha qidiruv (unique emas, A-23) |
| customers | `customers_name_trgm_idx` | GIN trgm | Ism bo‘yicha qisman qidiruv (REQ-081) |
| customers | `(last_purchase_at)` | B-tree | "Oxirgi xarid" bo‘yicha saralash |
| sales | `number` UNIQUE, `idempotency_key` UNIQUE | B-tree | `S-000123` qidiruvi; REQ-145 |
| sales | `(sold_at)`, `(user_id, sold_at)`, `(warehouse_id, sold_at)`, `(customer_id, sold_at)` | B-tree | Sana oralig‘i (REQ-090), sotuvchi, ombor, mijoz tarixi (REQ-080) |
| sale_items | `(sale_id, product_id)` UNIQUE, `(product_id, sale_id)` | B-tree | Sotuv qatorlari; mahsulot filtri va mahsulot sotuv tarixi |
| expense_categories | `(lower(name))` UNIQUE | expression | Kategoriya nomi takrorlanmasligi |
| expenses | `expenses_expense_date_active_idx (expense_date) WHERE deleted_at IS NULL` | partial | Xarajatlar ro‘yxati va hisobotlar (o‘chirilganlarsiz) |
| expenses | `(category_id)`, `(created_by)` | B-tree | Kategoriya filtri va o‘chirishda RESTRICT; muallif filtri |
| audit_logs | `(occurred_at DESC)`, `(entity_type, entity_id, occurred_at DESC)`, `(actor_id, occurred_at DESC)`, `(action, occurred_at DESC)` | B-tree | Audit jurnali: vaqt, obyekt tarixi, kim, qaysi amal |

`status` ustunlari uchun alohida index faqat ro‘yxat filtri bo‘lgan jadvallarda (`users`, `products`, `warehouses`) va kombinatsiyada (`incoming(status, incoming_date)`). (`expenses.status` Phase 11 da olib tashlandi — D-11.)

Har bir hisobot so‘rovi Phase 12'da `EXPLAIN (ANALYZE, BUFFERS)` bilan 1 mln sotuvli seed'da tekshirildi (REQ-167) — natijalar §7.2 da.

### 7.2. Hisobotlar performance'i — 1 mln sotuv (Phase 12, REQ-167, D-21 (4))

**Ishga tushirish:** `pnpm --filter @divine/backend bench:reports` (`backend/test/bench/reports.bench-spec.ts`, Docker kerak, ~4 daqiqa; doimiy `test`/`test:db` to‘plamiga va CI'ga kirmaydi). Har safar toza PostgreSQL 18 konteyneri: migratsiyalar + seed, so‘ng 5 ombor, 200 mahsulot, 30 sotuvchi, 100 000 mijoz, **1 000 000 sotuv × 2 qator** (2 mln `sale_items`, 2 mln SALE harakati, 365 kunga teng), 3 650 tasdiqlangan kirim, 20 000 xarajat; `ANALYZE`. Seed tezligi uchun trigger'lar faqat seed tranzaksiyasida (`session_replication_role = replica`, shu vaqtinchalik konteyner) o‘chiriladi. O‘lchanadi: repository'ning **aynan o‘sha SQL'i** (`reportStatements`, `financeStatement` — sahifa + yig‘ma (+ guruhlar), `EXPLAIN (ANALYZE, BUFFERS)`, planning + execution) va HTTP so‘rovi (guard, validatsiya, JSON; 3 marta, mediana). Chegara: < 2000 ms (A-L11).

**Natija (2026-10-27; 12 yadro, 14 GB RAM, konteyner PostgreSQL'ining standart sozlamalari, `shared_buffers = 128MB`)** — barcha 22 tekshiruv o‘tdi:

| So‘rov (sahifa 20 qator) | SQL, ms | HTTP, ms |
|---|---|---|
| sales — joriy oy / 366 kun | 90 / 684 | 85 / 599 |
| sales — 366 kun, ombor + mahsulot filtri | 196 | — |
| products — oy / 366 kun | 500 / 1150 | 238 / 956 |
| warehouse-stock (joriy) | 4 | 9 |
| incoming — oy / 366 kun | 3 / 6 | 6 / 12 |
| expenses — oy / 366 kun | 3 / 33 | 24 / 42 |
| user-sales — oy / 366 kun | 53 / 748 | 51 / 617 |
| product-sales — oy / 366 kun | 294 / 1258 | 221 / 1034 |
| customer-purchases — oy / 366 kun | 208 / 1006 | 188 / 883 |
| finance-summary — oy / 366 kun | 12 / 80 | 15 / 76 |
| `/dashboard/summary` · `sales-trend?days=30` · `top-products?days=30` | — | 76 · 38 · 114 |

**Benchmark topgan va tuzatilgan muammo:** dastlabki versiyada sahifa so‘rovi `count(*) OVER ()` bilan jami sonni hisoblardi va vaqt CTE ichida `to_char` bilan matnga aylantirilardi — PostgreSQL LIMIT 20 dan oldin butun natijani join qilib, formatlab, saralashga majbur bo‘lardi: **sales — 366 kun 2638 ms (SQL) / 2378 ms (HTTP)**, chegaradan oshdi. Tuzatish: CTE'da xom `timestamptz` (formatlash faqat chiqadigan qatorlarga), jami son yig‘ma so‘rovida (bitta skan). Natija 684 / 599 ms; javob shakli o‘zgarmadi (`reports.db-spec.ts` qayta o‘tdi).

**Kuzatuv:** eng og‘ir so‘rovlar — butun yil bo‘yicha guruhlovchi hisobotlar (`product-sales`, `products`, `customer-purchases`: ~1–1,3 s; 2 mln qatorni agregatsiya qiladi). Ular chegara ichida, lekin ma’lumot o‘sishi bilan birinchi bo‘lib sekinlashadi; kerak bo‘lsa yechim — kunlik agregat jadvali (hozir kerak emas, qo‘shilmadi). API p95 < 300 ms (oddiy endpointlar, yuklama ostida) — Phase 15 yuklama testida (§7.3).

### 7.3. API yuklama ostida — p95 < 300 ms (Phase 15, REQ-167, A-L11)

To‘liq usul, muhit va jadval — [TESTING §5.2](TESTING.md#52-api-yuklama-testi--p95--300-ms-benchload). Xuddi shu 1 mln sotuvli seed ustida 32 virtual foydalanuvchi (normal ~112 RPS, peak ~194 RPS); yakuniy natija — har bir endpoint p95 ≤ 212 ms, 0 xato.

Birinchi o‘lchov ikki so‘rovning dataset o‘lchamiga chiziqli bog‘liqligini ko‘rsatdi; ikkalasi ham **so‘rov shaklini** o‘zgartirib tuzatildi — yangi index va migratsiya kerak bo‘lmadi:

- `GET /sales` (p95 ~2,5 s → 0,18 s): sahifa so‘rovidagi `count(*) OVER ()` sotuv qatorlari bo‘yicha korrelyatsiyalangan subquery bilan birga LIMIT’dan oldin barcha qatorlarni hisoblatardi. Endi sahifa (`page`) va jami son alohida; ro‘yxat sahifasida son `summary` dan olinadi (o‘sha WHERE).
- `GET /products` (p95 ~1,6 s → 0,15 s): qoldiq / kirim / sotilgan yig‘malari barcha mahsulotlar bo‘yicha hisoblanib, keyin LIMIT qilinardi. Yig‘ma bo‘yicha saralash yoki filtr (`stock`, `received`, `sold`, `stock=low|out`) bo‘lmasa — avval sahifa (`pg` CTE, `count(*) OVER ()` faqat `products` ustida), yig‘malar faqat sahifa mahsulotlari uchun: `product_id = ANY(ARRAY(SELECT id FROM pg))` — `sale_items(product_id, sale_id)` index bo‘yicha (`IN (SELECT …)` varianti 2 mln qatorni seq scan + hash semi-join qilardi: 198 ms → 36 ms); ombor doirasi bo‘lmasa `sales` bilan JOIN yo‘q.

**Phase 17:** kassa katalogi (`sort=sold:desc`) bir yillik tarixli omborda alohida ssenariy sifatida o‘lchandi — sotilgan miqdor har so‘rovda ombordagi barcha `SALE` qatorlaridan yig‘ilardi (p95 ~1,5–1,7 s, 434 ta 503). Bu safar so‘rov shakli yetarli emas edi (yig‘ma bo‘yicha saralash butun ombor tarixini talab qiladi) → trigger bilan yuritiladigan `warehouse_sales_totals` (§4.10a) → 22 / 61 ms, 0 xato. Natijalar va muhit (noutbuk zaryadga ulanmagan) — TESTING §5.2 "Phase 17 o‘lchovlari".

---

## 8. Migratsiya strategiyasi

**Phase 2 migratsiyalari** (`backend/prisma/migrations/`):

| Migratsiya | Mazmuni |
|---|---|
| `20261008100000_init` | `prisma migrate diff --from-empty` natijasi: 10 ta enum, 20 ta jadval, PK/FK/UNIQUE, B-tree, GIN va partial indexlar, `pg_trgm`. Qo‘lda: SERIAL → `GENERATED ALWAYS AS IDENTITY`, `line_total`/`line_cost` → `GENERATED ALWAYS AS (…) STORED` |
| `20261008100100_constraints` | Barcha CHECK'lar (NaN himoyasi bilan) va `lower(name/login)` unique indexlar |
| `20261008100200_integrity_triggers` | O‘zgarmaslik, kirim holati, ledger va hujjat to‘liqligi trigger'lari (§4, §5.2) |
| `20261008100300_reconciliation_views` | 4 ta reconciliation view (§5.4) |
| `20261008100400_app_role_and_grants` | `divine_app` roli, `GRANT`lar, `ALTER DATABASE … SET timezone = 'UTC'` |
| `20261023100000_expenses_drop_status` | **Phase 11** (D-11, D-19): `expenses.status` ustuni va `expense_status` turi olib tashlandi (A-27 bekor); `category_id` NOT NULL saqlandi. Dev bazada qo‘llashdan oldin xarajatlar soni 0 ekani tekshirildi |
| `20261030100000_warehouse_sales_totals` | **Phase 17** (REQ-167): `warehouse_sales_totals` jadvali, SALE harakatlaridan yangilovchi SECURITY DEFINER trigger, ledger'dan bir martalik to‘ldirish, `reconcile_sales_totals` view, `divine_app`ga faqat `SELECT` (§4.10a). Faqat qo‘shimcha — mavjud jadval va ma’lumot o‘zgarmaydi; dev bazaga qo‘llandi |

**Buyruqlar** (`backend/`):

| Buyruq | Qachon |
|---|---|
| `pnpm db:deploy` | Migratsiyalarni qo‘llash (dev va prod; faqat oldinga, interaktiv emas) |
| `pnpm db:seed` | Ma’lumotnoma seed'i (idempotent) — `db:deploy` dan keyin |
| `pnpm db:status` | Qo‘llanmagan migratsiyalar bormi |
| `pnpm db:migrate` | **Faqat dev:** `schema.prisma` o‘zgargandan keyin yangi migratsiya yaratish (`--create-only` bilan, so‘ng qo‘lda SQL qo‘shish) |
| `pnpm db:reset` | **Faqat dev:** DB'ni tozalab, migratsiya + seed |
| `pnpm test:db` | Toza PG 18 konteynerida migratsiya + barcha DB testlari |

**Prisma va qo‘lda SQL:** Prisma CHECK, expression index, trigger, view, IDENTITY va GENERATED ustunlarni drift deb **hisoblamaydi** (tekshirilgan). `@default(dbgenerated())` GENERATED ustunni Prisma Client'da yozib bo‘lmaydigan (ixtiyoriy) qiladi. `migrations.db-spec.ts` har safar `prisma migrate diff --from-config-datasource --to-schema --exit-code` bilan drift yo‘qligini tasdiqlaydi.

1. Model o‘zgarishi `schema.prisma` da qilinadi → `pnpm --filter @divine/backend exec prisma migrate dev --create-only --name <nom>`.
2. Prisma ifodalay olmaydigan narsalar yaratilgan SQL faylga **qo‘lda** qo‘shiladi: `CHECK` constraint'lar, expression index (`lower(...)`), partial index, GIN trgm, `GENERATED` ustunlar, trigger va funksiyalar, `CREATE EXTENSION pg_trgm`, rollar va `GRANT`.
3. Migratsiyalar **faqat oldinga** yuradi. Qo‘llanilgan migratsiya hech qachon tahrirlanmaydi; tuzatish yangi migratsiya bilan qilinadi.
4. Prod'da migratsiya ilova ishga tushishidan oldin **alohida qadam** sifatida bajariladi: `docker build --target migrate` → `prisma migrate deploy && node dist/database/seed.cli.js` (Phase 17: to‘g‘ridan-to‘g‘ri CLI, pnpm/corepack'siz — internetsiz ichki tarmoqda ham ishlaydi; root emas; `divine_owner` bilan, `MIGRATION_DATABASE_URL_FILE`). `docker-compose.prod.yml` (va dev `docker-compose.yml`) dagi `migrate` servisi shuni bajaradi, `api` esa `service_completed_successfully` ni kutadi. PostgreSQL ko‘p so‘rovli skriptni bitta implicit tranzaksiyada bajaradi — migratsiya yarim qo‘llanib qolmaydi.
5. Har bir migratsiya CI'da toza DB'ga qo‘llanib, DB testlari bilan tekshiriladi (`Database tests` qadami, Phase 2'dan).

## 9. Seed

`pnpm --filter @divine/backend db:seed` (`src/database/seed.cli.ts`, logika — `src/database/seed/`) — idempotent, bitta tranzaksiyada, prod'da ham xavfsiz:
1. `roles` (ADMIN "Administrator", USER "Foydalanuvchi") — upsert.
2. `permissions` — `@divine/shared` `ALL_PERMISSIONS` bilan **sinxronlanadi**: yo‘g‘i qo‘shiladi, tavsif yangilanadi, katalogda yo‘qlari o‘chiriladi (CASCADE bilan rol bog‘lanishlari ham). Tavsiflar `PERMISSION_DESCRIPTIONS` (`Record<Permission, string>` — tavsifsiz permission kompilyatsiya bo‘lmaydi).
3. `role_permissions` — `ROLE_PERMISSIONS` bilan aynan bir xil holatga keltiriladi (ortiqchasi o‘chiriladi).
4. `settings` — `company_name`, `low_stock_default_threshold`, `currency_label`; **faqat mavjud bo‘lmasa** yoziladi (admin o‘zgartirgan qiymat saqlanadi).
5. **Birinchi admin — Phase 4'ga ko‘chirilgan** (D-10): parol hash formati (argon2id + pepper, `v1$`) auth moduli bilan birga paydo bo‘ladi. Phase 4 CLI: login `SEED_ADMIN_LOGIN` env'dan, 6 xonali parol faqat terminalda bir marta ko‘rsatiladi (A-21). Seed'da hech qanday parol yo‘q.

Demo yoki test ma’lumotlari alohida skriptda (`db:seed:demo`) bo‘ladi va prod'da ishlatilmaydi.

## 10. Vaqt zonasi

- Barcha `TIMESTAMPTZ` UTC'da saqlanadi. Ikki qatlamda majburlanadi: migratsiya `ALTER DATABASE … SET timezone = 'UTC'` (har qanday klient uchun standart) va ilova ulanishi `options=-c timezone=UTC` (`src/database/pg-connection.ts`, PrismaService va seed).
- "Bugun" va kunlik hisobotlar Toshkent kuni chegarasida hisoblanadi: `[YYYY-MM-DD 00:00 Asia/Tashkent, keyingi kun 00:00)` → UTC'ga o‘girilib, `sold_at >= $from AND sold_at < $to` (index ishlatiladi).
- O‘zbekistonda yozgi vaqt yo‘q (doimiy UTC+5), lekin hisob-kitob baribir IANA zonasi (`Asia/Tashkent`) orqali qilinadi.

## 11. Ma’lumotlarni saqlash siyosati

| Ma’lumot | Siyosat |
|---|---|
| Sotuvlar, kirimlar, ledger, audit | Muddatsiz saqlanadi, o‘chirilmaydi |
| Mahsulot, ombor, user, mijoz | Hard-delete yo‘q; arxivlanadi (`status`/`is_active`) |
| Mahsulot guruhi, xarajat kategoriyasi | Bog‘langan yozuv bo‘lmasa o‘chirish mumkin |
| Xarajat | Soft delete (`deleted_at`) + audit |
| `user_sessions` | Muddati tugagan yoki bekor qilinganlari 30 kundan keyin o‘chiriladi — `SessionCleanupJob` (kunlik 04:00 Toshkent, Redis qulfi; Phase 17) |
| Backup'lar | Shifrlangan (GPG), `BACKUP_RETENTION_DAYS` (standart 14) — [RUNBOOK §3](RUNBOOK.md#3-backup). Moliyaviy ma’lumotlarning yuridik saqlash muddati — biznes egasi qarori |

## 12. DB xato kodlari (Phase 3 mapping uchun)

Phase 3'da implement qilingan: `backend/src/common/errors/database-errors.ts` (haqiqiy PG + Prisma xatolari bilan testlangan — `test/db/error-mapping.db-spec.ts`).

| SQLSTATE | Manba | Ma’nosi | API |
|---|---|---|---|
| `23505` | UNIQUE | Takroriy login / shtrix-kod / nom / idempotency kaliti | `409 LOGIN_TAKEN` / `BARCODE_TAKEN` / `NAME_TAKEN` + `details[].field` (constraint bo‘yicha), qolganlari `409 CONFLICT` |
| `23503` | FK (INSERT/UPDATE) | Bog‘langan yozuv mavjud emas | `404 NOT_FOUND` |
| `23001` | FK `ON DELETE RESTRICT` | Tarixi bor yozuvni o‘chirish urinishi | `409 ENTITY_IN_USE` |
| `23514` | CHECK | Biznes cheklovi | `409 INSUFFICIENT_STOCK` (`warehouse_stock_quantity_non_negative`), qolganlari `400 VALIDATION_ERROR` |
| `23502`, `22xxx` | NOT NULL, data exception | Validatsiyadan o‘tib ketgan qiymat | `400 VALIDATION_ERROR` |
| `40001`, `40P01` | Serialization, deadlock | `TransactionRunner` 3 marta qayta urinadi; keyin ham bo‘lsa | `409 CONFLICT` |
| `08xxx`, `53xxx`, `57P0x`, `57014`, `55P03` | Ulanish, resurs, timeout, lock | DB vaqtincha ishlamayapti | `503 SERVICE_UNAVAILABLE` |
| `428C9` | IDENTITY / GENERATED | Hisoblanadigan ustunga qiymat yozish | `500` (dastur xatosi) |
| `42501` | Huquq | `divine_app` o‘zgarmas jadvalni o‘zgartirmoqchi | `500` (dastur xatosi) |
| `25xxx` | Tranzaksiya holati | — | `500` |
| `DV001` | Trigger | O‘zgarmas yozuv (audit, ledger, sotuv) | `500` (dastur xatosi, `error` log) |
| `DV002` | Trigger | Kirim DRAFT emas | `409 INCOMING_NOT_DRAFT` |
| `DV003` | Trigger | Ledger ↔ stock ↔ hujjat invarianti buzildi | `500` (dastur xatosi) |
| `DV004` | Trigger | Hujjat bo‘sh yoki totallar qatorlarga mos emas | `500` (dastur xatosi) |

Prisma kodlari (SQLSTATE'siz): `P2025` (yozuv topilmadi) → `404`, `P2034` → `409 CONFLICT`, `P2028` (tranzaksiya timeout) va `P1xxx` / `PrismaClientInitializationError` → `503`, `PrismaClientValidationError` → `500`.

**Xato shakllari (Prisma 7 + adapter-pg, kuzatilgan):** so‘rov xatolari — `PrismaClientKnownRequestError`, SQLSTATE `meta.driverAdapterError.cause.originalCode` da, unique/FK/RESTRICT constraint'i `cause.constraint.index` da, CHECK constraint'i faqat `cause.originalMessage` da. **COMMIT paytidagi** DEFERRED trigger xatolari (DV003/DV004) esa o‘ramasiz `DriverAdapterError` (`cause.originalCode`). Xom xabar va `detail` (qator qiymatlari) hech qachon client'ga ham, log'ga ham chiqmaydi.

## 13. Phase 2 qarorlari va dizayndan farqlar

| ID | Qaror | Sabab |
|---|---|---|
| D-08 | `incoming_items` va `sale_items` da `product_name`, `barcode` snapshot | Phase 2 talabi (§11 "barcode snapshot"). Mahsulot qayta nomlansa yoki arxivlansa ham chek va kirim hujjati o‘zgarmaydi. Narx va tannarx allaqachon snapshot edi (D-02) |
| D-09 | Shtrix-kod unique **barcha** mahsulotlar orasida (arxivlanganlar ham), partial index emas | Arxivlangan mahsulot qayta faollashtirilishi mumkin (to‘qnashuv bo‘lmaydi) va tarixiy hujjatlardagi shtrix-kod bitta mahsulotga ishora qiladi. Shtrix-kodni qayta ishlatish kerak bo‘lsa — avval eski mahsulotdan olib tashlanadi (ongli harakat, audit bilan) |
| D-10 | Birinchi admin seed'da emas, Phase 4 CLI'da | Phase 2 talabi: parol generatsiyasi va auth bu phase'da emas; `password_hash` CHECK'i faqat haqiqiy argon2id formatini qabul qiladi |
| A-27 | ~~`expenses.status` (`PAID`, `PENDING`, standart `PAID`)~~ **BEKOR (D-11); ustun Phase 11 da olib tashlandi** | Frontend contract (API §18) va "Chiqim" sahifasidagi "Holat" ustuni. TZ §11 holat bermaydi — [ASSUMPTION]. Hisobotdagi qo‘llanishi: BUSINESS-RULES §4 |
| — | `warehouse_stock.created_at` qo‘shildi | Phase 2 talabi (§9 "timestamps") |
| — | Ledger index'lari `created_at DESC` o‘rniga `id DESC` | Ledger tartibi `id` bo‘yicha (§1); trigger'lardagi "oxirgi balans" so‘rovi shu index'dan foydalanadi |
| — | Trigger nomlari `trg_` prefiksisiz (`audit_logs_immutable` …) | Constraint nomlari bilan bir xil uslub (`<jadval>_<maqsad>`) |
| — | Qo‘shimcha DB himoyalari: ledger ↔ stock ↔ hujjat to‘liqligi trigger'lari, `password_hash` formati, NaN | "Integrity faqat application kodiga bog‘liq bo‘lmasin" talabi |

## 14. DB testlari

`pnpm test:db` — Testcontainers orqali toza `postgres:18-alpine`, `prisma migrate deploy` va `pnpm db:seed` (production bilan bir xil yo‘l), so‘ng `backend/test/db/`:

| Fayl | Nima tekshiriladi |
|---|---|
| `migrations.db-spec.ts` | Takroriy deploy (no-op), `migrate status`, drift yo‘q, 20 jadval, `pg_trgm`, UTC, uuidv7, IDENTITY/GENERATED himoyasi, FK delete strategiyasi (CASCADE/SET NULL ro‘yxati qotirilgan), `divine_app` huquqlari, indexlar |
| `constraints.db-spec.ts` | Takroriy login (case-insensitive), shtrix-kod, nomlar, biriktirish, stock juftligi, idempotency kaliti; noto‘g‘ri FK; login formati; ochiq parol; manfiy/NaN/Infinity/overflow pul; nol/manfiy miqdor; mijoz, xarajat, audit, sessiya CHECK'lari |
| `immutability.db-spec.ts` | Audit, ledger, sotuv: UPDATE/DELETE/TRUNCATE — egasi uchun `DV001`, `divine_app` uchun `42501`; tasdiqlangan/bekor qilingan kirim qulfi; DRAFT tahrirlash va CASCADE |
| `inventory.db-spec.ts` | TZ misoli 200; tasdiqlash totallari; ledger zanjiri, moslik, idempotency, zaxira turlar; ledger'siz stock; overselling; sotuv to‘liqligi; **20 ta parallel sotuv → aynan 10 tasi**; reconciliation view'lari buzilishni aniqlaydi |
| `historical-integrity.db-spec.ts` | Arxiv + qayta nomlash + narx o‘zgarishi tarixni buzmaydi; RESTRICT; arxivlangan shtrix-kod (D-09) |
| `relationships.db-spec.ts` | Prisma Client orqali barcha asosiy relationlar, GENERATED ustunlar, Decimal aniqligi |
| `seed.db-spec.ts` | Rollar, permission katalogi, rol xaritasi, sozlamalar; idempotentlik; sozlama ustidan yozilmasligi; eskirgan permission tozalanishi |

