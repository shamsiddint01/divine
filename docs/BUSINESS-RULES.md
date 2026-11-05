# Divine.uz — Biznes qoidalari

> **Manba:** TZ §18 (non-negotiable) va TZ'ning boshqa bo‘limlaridan kelib chiqadigan qoidalar.
> **Qoida:** hech bir BR jimgina olib tashlanmaydi, o‘zgartirilmaydi yoki soddalashtirilmaydi (TZ §20, REQ-173).
> Har bir qoida **uch qatlamda** himoyalanadi: Frontend (UX) → Backend (service/domain, haqiqiy chegara) → Database (constraint/trigger, oxirgi himoya chizig‘i).

---

## 1. Non-negotiable qoidalar (TZ §18)

### BR-01 — Faqat Admin user yaratadi
- **Manba:** TZ §3, §18 · **REQ:** REQ-020, REQ-010
- **Backend:** `POST /users` → `users.manage` permission (faqat ADMIN). Ochiq ro‘yxatdan o‘tish endpointi **yo‘q**. Birinchi admin faqat seed buyrug‘i orqali yaratiladi (A-21).
- **Frontend:** "Userlar" bo‘limi va "User qo‘shish" tugmasi faqat `users.read`/`users.manage` bo‘lsa ko‘rinadi.
- **Xato:** `403 FORBIDDEN` · **Test:** AC-01, AC-18

### BR-02 — Admin login beradi, server parol yaratadi
- **Manba:** TZ §3, §18 · **REQ:** REQ-021, REQ-024
- **Backend:** `POST /users` body'sida `login` majburiy. `password` maydoni **qabul qilinmaydi** (strict sxema → `400`). Parolni server yaratadi va faqat yaratish javobida bir marta qaytaradi (REQ-026). Parolni tiklash ham faqat server generatsiyasi orqali (`POST /users/:id/reset-password`).
- **Frontend:** formada parol maydoni yo‘q. Yaratilgandan keyin "Bu parol faqat bir marta ko‘rsatiladi" modali va nusxa olish tugmasi.
- **Test:** AC-01, AC-04

### BR-03 — Login faqat A-Z / a-z / 0-9
- **Manba:** TZ §3, §18 · **REQ:** REQ-022, REQ-023
- **Qoida:** faqat lotin harflari va raqamlar; probel va maxsus belgilar yo‘q (boshida va oxirida ham); uzunlik 3–32 (A-05); unique, **case-insensitive** (`Ali` ≡ `ali`).
- **Shared:** `loginSchema` (`/^[A-Za-z0-9]+$/`, trim yo‘q) — client va server bir xil sxema. **Phase 1'da implement qilingan va testlangan** (to‘g‘ri va noto‘g‘ri formatlar, uzunlik, case-insensitive normallashtirish).
- **DB:** `CHECK (login ~ '^[A-Za-z0-9]{3,32}$')` + `UNIQUE (lower(login))`
- **Xato:** `400 VALIDATION_ERROR` (format), `409 LOGIN_TAKEN` (band) · **Test:** AC-02, AC-03

### BR-04 — Parol aynan 6 ta raqam
- **Manba:** TZ §3, §18 · **REQ:** REQ-024, REQ-025
- **Qoida:** `crypto.randomInt(0, 1_000_000)` → `padStart(6, '0')` (CSPRNG, bir tekis taqsimot; boshida 0 bo‘lishi mumkin — A-06). Saqlash: `argon2id(HMAC-SHA256(pepper, parol))`. Plaintext hech qayerda saqlanmaydi va log qilinmaydi.
- **Shared:** `generatedPasswordSchema` (`/^\d{6}$/`) — **Phase 1'da implement qilingan va testlangan**.
- **Xavf:** 6 xonali parolning kuchsizligi va unga qarshi choralar — [SECURITY.md §5](SECURITY.md#5-6-xonali-parol-talabining-xavfi).
- **Test:** AC-04 (10 000 marta generatsiya: barchasi `/^\d{6}$/`)

### BR-05 — Har bir sotuvda mijoz ismi majburiy
- **Manba:** TZ §8, §9, §18 · **REQ:** REQ-074
- **Shared:** `customerNameSchema` (trim, 1–150; bo‘sh yoki faqat probel → "Mijoz ismi majburiy") — **Phase 1'da testlangan**.
- **Backend:** sotuv `customer.id` (mavjud mijoz) yoki `customer.name` bilan. Ism `sales.customer_name_snapshot` ga yoziladi.
- **DB:** `customers.name NOT NULL CHECK (btrim(name) <> '')`, `sales.customer_name_snapshot NOT NULL CHECK (...)`
- **Xato:** `400 VALIDATION_ERROR` / `422 CUSTOMER_NAME_REQUIRED` · **Test:** AC-15

### BR-06 — Mijoz telefoni ixtiyoriy
- **Manba:** TZ §8, §9, §18 · **REQ:** REQ-074
- **Qoida:** bo‘sh qoldirish mumkin. Berilsa O‘zbekiston formatiga normallashtiriladi (`+998XXXXXXXXX`, A-23).
- **Shared:** `optionalPhoneSchema` — **Phase 1'da testlangan**. **DB:** `phone NULL`, `CHECK (phone ~ '^\+998[0-9]{9}$')`
- **Test:** AC-16

### BR-07 — Qoldiqdan ko‘p sotib bo‘lmaydi
- **Manba:** TZ §8, §17, §18 · **REQ:** REQ-073, REQ-077, REQ-161
- **Backend:** atomic shartli `UPDATE warehouse_stock … WHERE quantity >= $q` tranzaksiya ichida. 0 qator yangilansa, butun sotuv rollback qilinadi. Parallel so‘rovlarda ham ishlaydi ([DATABASE §5.3](DATABASE.md#53-yozish-algoritmlari)).
- **DB:** `warehouse_stock CHECK (quantity >= 0)`, `inventory_movements CHECK (balance_after >= 0)`
- **Frontend:** savatda mavjud qoldiq ko‘rinadi, oshib ketsa ogohlantiriladi (faqat UX).
- **Xato:** `409 INSUFFICIENT_STOCK` (mahsulot nomi va mavjud miqdor bilan) · **Test:** AC-12, AC-13 (concurrency)

### BR-08 — Tasdiqlangan kirim qoldiqni oshiradi
- **Manba:** TZ §7, §18 · **REQ:** REQ-064, REQ-160
- **Backend:** `POST /incoming/:id/confirm` — DRAFT → CONFIRMED, har bir item uchun stock ↑ va ledger yozuvi, audit — **bitta tranzaksiyada** (hammasi yoki hech narsa). Takroriy tasdiqlash stockni ikki marta oshirmaydi.
- **DB:** `UNIQUE(reference_type, reference_item_id)`, `trg_incoming_guard`
- **Test:** AC-09, AC-10

### BR-09 — Tasdiqlangan sotuv qoldiqni kamaytiradi
- **Manba:** TZ §8, §18 · **REQ:** REQ-075, REQ-160
- **Backend:** sale + sale_items + stock ↓ + inventory_movements + mijoz yig‘malari + audit — **bitta tranzaksiyada**.
- **Test:** AC-11

### BR-10 — Shtrix-kod unique
- **Manba:** TZ §6, §17, §18 · **REQ:** REQ-051, REQ-162
- **Qoida:** berilgan shtrix-kod tizimda yagona (D-05: shtrix-kod ixtiyoriy). Parallel yaratishda ham kafolatlangan (DB unique).
- **DB:** `UNIQUE (barcode)`; service `23505` xatosini `409 BARCODE_TAKEN` ga o‘giradi.
- **Test:** AC-06

### BR-11 — Kirim jami miqdori dinamik hisoblanadi
- **Manba:** TZ §7, §18 · **REQ:** REQ-062, REQ-063, REQ-065
- **Frontend:** `useFieldArray` + `useWatch` — istalgan qator miqdori o‘zgarganda jami **darhol** yangilanadi (50 + 30 + 100 + 20 = **200**). Hisob decimal-safe (float xatosiz).
- **Backend:** client'dan total qabul qilinmaydi. Server `total_quantity = Σ quantity`, `total_amount = Σ round(quantity × cost_price, 2)` ni har bir saqlashda va tasdiqlashda qayta hisoblaydi.
- **Test:** AC-07, AC-08

### BR-12 — Barcha user-facing UI va xabarlar o‘zbekcha
- **Manba:** TZ §1, §16, §18 · **REQ:** REQ-002
- **Amalga oshirish:**
  - UI matnlari faqat `frontend/src/i18n/uz.ts` da; JSX'da qo‘lda yozilgan matn ESLint xatosi (**Phase 1'da tayyor**)
  - Server xabarlari — `ERROR_MESSAGES_UZ` (har bir error kodi uchun)
  - Validatsiya — `VALIDATION_MESSAGES_UZ` + global o‘zbekcha Zod error map (**Phase 1'da tayyor va testlangan**)
  - Hisobot sarlavhalari — `ReportDefinition` ustunlari o‘zbekcha
  - Kod identifikatorlari inglizcha bo‘lishi mumkin
- **Test:** AC-25 (lug‘at testi: bo‘sh matn yo‘q, kirill yo‘q, `o‘`/`g‘` to‘g‘ri; error map: inglizcha Zod matni chiqmaydi)

---

## 2. TZ'dan kelib chiqadigan qo‘shimcha qoidalar

| ID | Qoida | Manba / REQ | Amalga oshirish | Xato |
|---|---|---|---|---|
| BR-13 | Mahsulot miqdori siyosati: `allow_decimal=false` bo‘lsa, miqdor butun son bo‘lishi shart; `DONA` doim butun | TZ §8 (A-13) · REQ-073 | Domain: `isWholeQuantity`; DB: `CHECK (unit <> 'DONA' OR allow_decimal = false)` | `422 INVALID_QUANTITY` |
| BR-14 | Miqdor doim musbat (> 0); kasr ko‘pi bilan 3 xona | TZ §8 · REQ-073 | `quantitySchema`; DB `CHECK (quantity > 0)` | `400` |
| BR-15 | Sotuv narxi va tannarx serverda sotuv paytidagi qiymatdan **snapshot** qilinadi (tannarx — mahsulot kartochkasidagi `cost_price`, kirim narxi emas — D-16); client narx yubora olmaydi | TZ §8, §11 (D-02, A-18) · REQ-076, REQ-102 | `sale_items.unit_price`, `unit_cost` | `400` (unknown field) |
| BR-16 | Tasdiqlangan kirim va sotuv o‘zgartirilmaydi va o‘chirilmaydi | TZ §14 (D-07) | Service + DB trigger | `409 INCOMING_NOT_DRAFT` |
| BR-17 | Kirim holat mashinasi: `DRAFT → CONFIRMED`, `DRAFT → CANCELLED`; boshqa o‘tishlar yo‘q | TZ §7 (A-24) | `IncomingService` (hujjat `FOR UPDATE`) + shartli UPDATE + trigger (Phase 8) | `409 INCOMING_NOT_DRAFT` |
| BR-18 | Kirimda kamida 1 ta mahsulot; bitta mahsulot bir marta | TZ §7 (A-09) | Sxema + `UNIQUE(incoming_id, product_id)` | `422 INCOMING_EMPTY`, `400` |
| BR-19 | Sotuvda kamida 1 ta mahsulot; takroriy qatorlar birlashtiriladi | TZ §8 | Service | `422 SALE_EMPTY` |
| BR-20 | INACTIVE mahsulotni sotib ham, kirim qilib ham bo‘lmaydi | TZ §6 | Service | `422 PRODUCT_INACTIVE` |
| BR-21 | INACTIVE omborga kirim ham, sotuv ham qilinmaydi | TZ §5 | Service: `InventoryService` (ombor `FOR SHARE`, Phase 7) | `422 WAREHOUSE_INACTIVE` |
| BR-22 | USER faqat biriktirilgan omboridan sotadi va faqat o‘z sotuvlarini ko‘radi | TZ §2 (D-04) · REQ-011 | [RBAC §6](RBAC.md#6-user-ownership-qoidalari) | `403` / `404` |
| BR-23 | Sotuv idempotent: bir xil `Idempotency-Key` + bir xil payload — bitta sotuv | TZ §15 · REQ-145 | `sales.idempotency_key UNIQUE` + `request_hash` | `409 IDEMPOTENCY_KEY_REUSED` |
| BR-24 | Har bir kritik mutatsiya o‘sha tranzaksiya ichida audit qilinadi | TZ §13 · REQ-120 | `AuditService.record(tx, …)` | — |
| BR-25 | Audit jurnalini hech kim o‘zgartira olmaydi va o‘chira olmaydi | TZ §13 (D-06) · REQ-122 | Endpoint yo‘q + trigger + DB huquqlari | — |
| BR-26 | Inventar ledger'i o‘zgarmaydi; stock va ledger doim mos | TZ §14 · REQ-132 | Trigger, bitta tranzaksiya, reconciliation | — |
| BR-27 | ADMIN o‘zini bloklay olmaydi, o‘z rolini o‘zgartira olmaydi va o‘z parolini admin endpointi orqali tiklay olmaydi; tizimda kamida 1 ta faol ADMIN qoladi | Xavfsizlik | Service (+ advisory lock) | `403 CANNOT_MODIFY_SELF`, `409 LAST_ACTIVE_ADMIN` |
| BR-28 | Bloklangan user tizimga kira olmaydi; mavjud sessiyalari darhol bekor qilinadi | TZ §3 · REQ-027 | Guard (har so‘rovda status) + sessiya revoke | `401/403 ACCOUNT_BLOCKED` |
| BR-29 | Parol tiklanganda barcha sessiyalar bekor qilinadi | Xavfsizlik | `password_changed_at` + revoke | — |
| BR-30 | Mahsulot, ombor, user va mijoz hard-delete qilinmaydi (tarix saqlanadi) | TZ §14 | Status yoki arxiv | — |
| BR-31 | Mahsulot guruhi va xarajat kategoriyasi faqat bog‘langan yozuv bo‘lmasa o‘chiriladi | Data integrity | FK RESTRICT + service tekshiruvi (xarajat kategoriyasi: soft-delete qilingan xarajat ham band qiladi — Phase 11) | `409 ENTITY_IN_USE` |
| BR-32 | Xarajat summasi > 0 | TZ §11 | `positiveMoneySchema`; DB `CHECK (amount > 0)` | `400` |
| BR-33 | Destructive amallar (o‘chirish, arxivlash, bloklash, kirimni tasdiqlash yoki bekor qilish) UI'da tasdiqlash dialogini talab qiladi | TZ §16 · REQ-153 | `ConfirmDialog`: xarajat, kategoriya va guruhni o‘chirish; mahsulot, ombor va kategoriyani nofaol qilish, guruhni arxivlash; userni bloklash, parolni tiklash; kirimni tasdiqlash/bekor qilish; kassada savatni tozalash/omborni almashtirish; demo'ni tiklash. Faollashtirish va arxivdan chiqarish — tasdiqsiz (qaytariladigan) | Phase 14: `app/confirm-dialogs.test.tsx`, `ProductGroupsPage`, `ExpensesPage`, `UsersPage`, `WarehousesPage` testlari; real backend E2E (bekor qilinsa so‘rov yuborilmaydi — audit) |
| BR-34 | Barcha vaqtlar UTC'da saqlanadi; "bugun" va kunlik filtrlar `Asia/Tashkent` kuni bo‘yicha | TZ §17 · REQ-165 | `APP_TIMEZONE`, [DATABASE §10](DATABASE.md#10-vaqt-zonasi) | — |
| BR-35 | Pul summalari aniq decimal (float emas), API'da string | TZ §14 · REQ-133 | `NUMERIC`, `Prisma.Decimal`, `moneySchema` | — |

---

## 3. Holat mashinalari

### 3.1. Kirim (`incoming.status`)

```
          POST /incoming
               │
               ▼
          ┌─────────┐   PATCH /incoming/:id (tahrirlash, totallar qayta hisoblanadi)
          │  DRAFT  │◀───┐
          └────┬────┘────┘
     confirm   │   cancel
   ┌───────────┴───────────┐
   ▼                       ▼
┌───────────┐        ┌───────────┐
│ CONFIRMED │        │ CANCELLED │      yakuniy holatlar: o‘zgarmaydi (trigger)
│ stock ↑   │        │ stock —   │
└───────────┘        └───────────┘
```

### 3.2. Sotuv (`sales.status`)

`COMPLETED` — yaratilish paytida yakuniy holat. Bekor qilish va qaytarish hozircha yo‘q (D-03). Kelajakda ular yangi holatlar va teskari (`RETURN`) ledger harakati orqali qo‘shiladi; mavjud yozuvlar o‘zgartirilmaydi.

### 3.3. User (`users.status`)

`ACTIVE ⇄ BLOCKED` (faqat ADMIN, o‘zini emas). Login lock (`locked_until`) — holat emas, vaqtinchalik cheklov.

---

## 4. Hisob-kitob formulalari

Barcha hisoblar `NUMERIC`/`Decimal` bilan bajariladi. Yaxlitlash: pul — 2 xona, `ROUND_HALF_UP` (PostgreSQL `round()` bilan bir xil).

| Ko‘rsatkich | Formula | Manba |
|---|---|---|
| Kirim jami miqdori | `Σ incoming_items.quantity` | TZ §7 (50+30+100+20=200) |
| Kirim jami summasi | `Σ round(quantity × cost_price, 2)` | TZ §7 (ixtiyoriy talab — implement qilinadi) |
| Sotuv qatori summasi | `line_total = round(quantity × unit_price, 2)` | TZ §8 |
| Sotuv jami | `total_amount = Σ line_total` | TZ §8 |
| Qator tannarxi | `line_cost = round(quantity × unit_cost, 2)` | D-02 |
| **Hisoblangan foyda** (TZ formulasi) | `Σ (unit_price − unit_cost) × quantity` = `Σ (line_total − line_cost)` | TZ §11 |
| **Tushum** (revenue) | `Σ sales.total_amount` (davr bo‘yicha) | TZ §11 |
| **Sotilgan mahsulot tannarxi** (COGS) | `Σ sales.total_cost` | TZ §11 |
| **Xarajatlar** (expense) | `Σ expenses.amount WHERE deleted_at IS NULL` (holat yo‘q — D-11; kategoriya bo‘yicha ham — D-19) | TZ §11 |
| **Sof foyda** | `hisoblangan foyda − xarajatlar` (TZ'da yo‘q, qo‘shimcha ko‘rsatkich — A-22) | — |
| **Ombor tannarxi** (inventory cost) | `Σ warehouse_stock.quantity × products.cost_price` (joriy) | TZ §11 |
| Kirim summasi (xarid) | `Σ incoming.total_amount (CONFIRMED)` — **xarajat sifatida hisoblanmaydi** | TZ §11 |
| Bugungi sotilgan miqdor / summa | `Σ sale_items.quantity` / `Σ sales.total_amount`, `sold_at ∈ [bugun 00:00, ertaga 00:00) Asia/Tashkent` | TZ §4 |
| Jami sotilgan miqdor / summa | Barcha vaqt bo‘yicha xuddi shunday | TZ §4 |
| Ombordagi jami miqdor | `Σ warehouse_stock.quantity` + birlik bo‘yicha bo‘linma (A-L06) | TZ §4 |
| Kam qoldiq | mahsulot ACTIVE va `Σ stock (barcha omborlar) ≤ COALESCE(min_stock, settings.low_stock_default_threshold)` | TZ §4 (A-15) |
| Faol userlar | `COUNT(users WHERE status = 'ACTIVE')` + qo‘shimcha "bugun sotuv qilganlar" (A-16) | TZ §4 |

**Yaxlitlash eslatmasi:** butun miqdor va 2 xonali narxda `(p − c) × q` aniq hisoblanadi. Kasr miqdorda (3 xona) qator darajasida yaxlitlanadi va foyda `Σ (line_total − line_cost)` sifatida olinadi. Bu TZ formulasidan har bir qator uchun ko‘pi bilan ±0,01 so‘m farq qilishi mumkin. Shu yondashuv tanlandi, chunki hisobotlardagi tushum va tannarx bilan foyda o‘zaro aynan mos keladi.

---

## 5. Qabul qilingan qarorlar

TZ'dagi noaniqlik va ziddiyatlar bo‘yicha. Foydalanuvchiga taklif qilingan standart variantlar Phase 1'da tasdiqlangan deb qabul qilindi.

| ID | Masala | Qaror | Asos |
|---|---|---|---|
| D-01 | §16 navigatsiyasida "Chiqim" bor, "Xarajatlar" yo‘q; §11 esa xarajat modulini talab qiladi | "Chiqim" = Xarajatlar sahifasi | Aks holda xarajatlarning navigatsiyada joyi qolmaydi. Ombor chiqimlari (sotuvlar) "Ombor → harakatlar" bo‘limida ko‘rinadi |
| D-02 | §11 formulasidagi `costPrice` manbai | Sotuv paytidagi `products.cost_price` snapshot'i (`sale_items.unit_cost`) | TZ formulasiga eng yaqin; tarixiy hisobotlar barqaror qoladi |
| D-03 | Qaytarish, bekor qilish, tuzatish, ko‘chirish | Hozircha scope'dan tashqarida; sxema tayyor | TZ'da yo‘q. Keyinroq alohida qaror bilan qo‘shiladi |
| D-04 | USER qaysi ombordan sotadi | `user_warehouses` orqali biriktirish | §8 sotuvda `warehouseId` saqlashni talab qiladi |
| D-05 | Shtrix-kod majburiymi | Ixtiyoriy, berilsa unique | Tarozida sotiladigan mahsulotlarda shtrix-kod bo‘lmasligi mumkin |
| D-06 | §2 "ADMIN full CRUD audit" ↔ §13 audit o‘zgarmasligi | Audit hamma uchun o‘zgarmas, ADMIN faqat o‘qiydi | TZ'dan qattiqroq, yumshoqroq emas |
| D-07 | §2 "full CRUD sales/incoming" ↔ §14 ledger | Tasdiqlangan hujjatlar o‘zgarmaydi | Ledger va stock yaxlitligi |
| D-08 | Hujjat qatorlari mahsulot o‘zgarsa buziladimi | `sale_items`, `incoming_items` da `product_name`, `barcode` snapshot (narx/tannarx — D-02) | Chek va kirim hujjati tarixiy holatda qoladi (Phase 2) |
| D-09 | Arxivlangan mahsulotning shtrix-kodi qayta ishlatiladimi | Yo‘q: shtrix-kod barcha mahsulotlar (arxivlanganlar ham) orasida unique | Arxivdan qaytarishda to‘qnashuv bo‘lmaydi; tarixdagi shtrix-kod bitta mahsulotga ishora qiladi (Phase 2) |
| D-10 | Birinchi admin qachon yaratiladi | Phase 4 CLI (auth moduli bilan), Phase 2 seed'ida emas | Parol hash'i va generatsiyasi auth phase'iga tegishli; seed'da parol bo‘lmaydi (Phase 2) |
| D-11 | Xarajat formasi va "Chiqim" nomi (biznes egasi qarori, 2026-10-22) | Bo‘lim nomi **"Xarajatlar"**. ~~Xarajat = sana + summa + izoh (+ kiritgan user). Kategoriya so‘ralmaydi (eski yozuvlardagi kategoriya ro‘yxatda ko‘rinadi).~~ — **kategoriya qismi D-19 bilan almashtirildi (2026-10-23): kategoriya majburiy.** **Holat (`PAID`/`PENDING`) olib tashlandi** — A-27 bekor (o‘z kuchida). Ro‘yxatdagi yig‘ma: "Jami" | ~~TZ bilan conflict: REQ-100 xarajatda `category` talab qiladi~~ — D-19 dan keyin conflict yo‘q. Phase 11 migratsiyasi `20261023100000_expenses_drop_status`: `expenses.status` va `expense_status` turi olib tashlandi; `category_id` NOT NULL **qoldi** (D-19). Mavjud migratsiyalar qayta yozilmadi. Tekshiruv: `migrations.db-spec.ts` "Phase 11 migratsiyasi" |
| D-12 | Sotuvchi xarajat kirita oladimi (biznes egasi qarori, 2026-10-22) | **Ha, faqat qo‘shadi:** USER'da `expenses.create` — Xarajatlar bo‘limi menyuda bor, lekin ro‘yxat, summalar, tahrirlash va o‘chirish yo‘q. Ro‘yxatni faqat `expenses.read` (ADMIN) ko‘radi. Yozuv kiritgan user nomidan saqlanadi | Kassadan qilingan xarajat (masalan, tushlik) joyida yoziladi. **TZ bilan farq:** RBAC'da USER faqat sotuv jarayoni (REQ-011) — biznes egasi qarori ustun. Backend Phase 11: `POST /expenses` — `@RequireAnyPermission(expenses.create, expenses.manage)` |
| D-13 | Users moduli: "faollashtirish/o‘chirish" va lockout (Phase 5) | Alohida "deactivated" holati **yo‘q**: o‘chirish = `BLOCKED`, faollashtirish = `ACTIVE` (sxemada 2 holat, BR-28). Login lockout — holat emas: bloklash/blokdan chiqarish unga tegmaydi, parol tiklash uni tozalaydi. Ombor: avval biriktirilgan va keyin nofaol bo‘lgan ombor saqlanadi, yangi nofaol ombor qo‘shilmaydi. User formasidagi omborlar `GET /users/warehouse-options` dan | Yangi migratsiyasiz, Phase 4 auth dizayni bilan mos. Alohida "deactivated" kerak bo‘lsa — yangi migration va TZ tasdig‘i kerak |
| D-14 | Mahsulot guruhi va mahsulot boshqaruvi (Phase 6) | Guruhni **arxivlash** (`isActive = false`): yangi mahsulot qo‘shilmaydi (`422 PRODUCT_GROUP_INACTIVE`), mavjudlari va tarix saqlanadi; mahsulotli guruhni o‘chirib bo‘lmaydi (`409 ENTITY_IN_USE`). Mahsulot PATCH'i `status`ni ham qabul qiladi (forma), o‘zgarsa `PRODUCT_STATUS_CHANGED` audit. Sotuvchi faqat ACTIVE mahsulot va faol guruhlarni ko‘radi. Miqdorlar (`stock/received/sold`) userning ombor doirasida | API §5–6 da guruh arxivi yo‘q edi — mahsulotli guruhni chiqarishning yagona xavfsiz yo‘li; `PRODUCT_GROUP_INACTIVE` — yangi xato kodi |
| D-15 | Omborlar boshqaruvi (Phase 7) | O‘chirish **yo‘q** — faqat nofaol qilish (`PATCH /warehouses/:id/status`); qoldig‘i bor omborni ham nofaol qilish mumkin: qoldiq, ledger, hujjatlar va `user_warehouses` saqlanadi, yangi kirim/sotuv → `422 WAREHOUSE_INACTIVE`, qayta faollashtirish mumkin. Nofaol qilish UI'da tasdiq so‘raydi, faollashtirish — tasdiqsiz. USER `GET /warehouses`da ko‘rsatkichlarsiz faqat o‘z ACTIVE omborlarini ko‘radi. Aralash rejimda (`VITE_AUTH_MODE=http`) kassa ombor va mahsulotlarni serverdan o‘qiydi, sotuvni saqlash Phase 10 gacha o‘chirilgan | Tarixiy hujjatlar omborga FK RESTRICT bilan bog‘langan — o‘chirish yaxlitlikni buzadi. Qoldiqli omborni nofaol qilishni taqiqlash TZ'da yo‘q; taqiqlash kerak bo‘lsa — kichik o‘zgarish (service tekshiruvi) |
| D-16 | Kirim qoidalari (Phase 8) — **biznes egasi tomonidan tasdiqlangan (2026-10-22)** | (1) Kelgan narxi `0` bo‘lishi mumkin (DB `cost_price >= 0`, mahsulot narxi bilan bir xil qoida). (2) Kirimni tasdiqlash mahsulot kartochkasidagi `cost_price`ni **o‘zgartirmaydi**; kirimdagi narx faqat hujjat tarixida (`incoming_items.cost_price`) va ledger'da (`inventory_movements.unit_cost`) saqlanadi. Sotuvdagi foyda **mahsulot kartochkasidagi** tannarxdan: sotuv paytida `products.cost_price` → `sale_items.unit_cost` snapshot (D-02), foyda = `line_total − line_cost`; ombor qiymati ham kartochka tannarxida. (3) Nofaol omborning qoralamasini tahrirlash va tasdiqlash mumkin emas (`422 WAREHOUSE_INACTIVE`) — faqat faol omborga ko‘chirish yoki bekor qilish. (4) Kirim hujjatini o‘chirish yo‘q (endpoint yo‘q); DRAFT bekor qilinadi (`CANCELLED`). (5) Hujjat sanasiga cheklov yo‘q — o‘tgan va kelajak sanalar qabul qilinadi | TZ bu holatlarni aniqlamagan edi; biznes egasi tasdiqladi. Tekshiruv: `incoming.db-spec.ts` ("D-16: …" testlari, nofaol ombor testi), `IncomingPage.test.tsx` (mock pariteti). Phase 10 sotuv servisi `unit_cost`ni aynan `products.cost_price`dan olishi va buni testlashi shart |
| D-17 | Mijozlar moduli (Phase 9) — **biznes egasi tomonidan tasdiqlangan (2026-10-22)** | (1) Bir xil ism va telefonli mijozlarni yaratishga ruxsat (A-23); UI takroriylik haqida ogohlantirmaydi. (2) Mijozni o‘chirish yoki arxivlash yo‘q (BR-30). (3) Sotuvchi (`customers.create`) mijoz yaratadi, lekin izoh kirita olmaydi (`403`); izoh, jami xarid summasi, xaridlar soni va xarid tarixi faqat `customers.read_history`/`customers.manage` (hozir — ADMIN). (4) Sotuvchi `totalSpent` va `purchaseCount` bo‘yicha saralay olmaydi (`400`); `lastPurchaseAt` bo‘yicha — ruxsat. (5) Audit'da shaxsiy ma’lumot qiymatlari yo‘q: yaratishda `{ hasPhone, hasNotes }`, tahrirlashda faqat o‘zgargan maydon nomlari. (6) `GET /customers/:id/purchases` sotilgan mahsulot qatorlari bilan qaytadi (API §10) | Tekshiruv: `customers.db-spec.ts` (takroriy mijoz, o‘chirish endpointi yo‘q, sotuvchi ruxsatlari va saralash, audit metadata, xarid tarixi qatorlari), `test/unit/customers`, `CustomersPage.test.tsx` |
| D-18 | Sotuv qoidalari (Phase 10) — **biznes egasi tomonidan tasdiqlangan (2026-10-22)** | (1) `customer: { name, phone? }` bilan kelgan sotuv **har doim yangi mijoz** yaratadi (API §11; telefon yoki ism bo‘yicha mavjud mijozga avtomatik bog‘lanmaydi — takroriy ruxsat, D-17); doimiy mijoz kassada ro‘yxatdan tanlanadi (`{ id }`). (2) `Idempotency-Key` — UUID (DB ustuni `uuid`) va kalitni yuborgan sotuvchiga bog‘liq: shu user + shu kalit + ekvivalent payload (qatorlar tartibi, `"2"`/`"2.000"`, takroriy qatorlar) → o‘sha sotuv (`200`), ikkinchi sotuv yaratilmaydi; boshqa payload yoki boshqa user → `409 IDEMPOTENCY_KEY_REUSED`; kalitsiz → `400`, UUID emas → `400`. (3) Qoldiq yetmasa — barcha yetmayotgan qatorlar bitta `409 INSUFFICIENT_STOCK` javobida, hech narsa yozilmaydi. (4) Sotuvni tahrirlash, bekor qilish, qaytarish, o‘chirish yo‘q — D-03 saqlanadi (endpoint yo‘q, `sales`/`sale_items` DB triggeri bilan o‘zgarmaydi). (5) ADMIN istalgan **faol** ombordan sotadi (RBAC §6); nofaol ombor — ADMIN uchun ham `422 WAREHOUSE_INACTIVE` | Tekshiruv (`backend/test/db/sales.db-spec.ts`): (1) "D-18(1): ism va telefon mavjud mijoznikiga teng bo‘lsa ham — har doim yangi mijoz…", "to‘g‘ri sotuv…", mock — `SalesHistoryView.test.tsx` "ism bilan kelgan mijoz — har doim yangi"; (2) "bir xil kalit + bir xil payload → o‘sha sotuv…", "kalit boshqa payload yoki boshqa user bilan → 409…", "bir xil kalit bilan 5 ta parallel so‘rov → bitta sotuv", `shared` `sales.test.ts` (UUID), mock — `mock-api.test.ts`; (3) "AC-12: qoldiqdan ko‘p → 409, barcha yetmayotgan qatorlar xabarda…"; (4) "D-18(4), D-03: sotuvni tahrirlash, bekor qilish, qaytarish, o‘chirish yo‘q… → 404", `immutability.db-spec.ts` "sales va sale_items: yakunlangan sotuv o‘zgarmaydi"; (5) "anonim → 401; biriktirilmagan ombor → 403… ADMIN — istalgan faol ombordan", "validatsiya: … nofaol ombor → 422" |
| D-19 | Xarajat kategoriyasi va sanasi (Phase 11 oldidan, D-11 ni o‘zgartiradi) — **biznes egasi tomonidan tasdiqlangan (2026-10-23)** | (1) Kategoriya **har bir xarajatda majburiy** — kategoriyasiz xarajat saqlanmaydi (`400`, `categoryId`); DB `expenses.category_id` NOT NULL qoladi. (2) Sotuvchi (`expenses.create`) ham xarajat qo‘shganda kategoriyani **tanlaydi** — buning uchun faol kategoriyalar ro‘yxatini (faqat `id`, `name`) o‘qiy oladi; tanlangan kategoriya mavjud va faol bo‘lishi shart. (3) Kategoriyalar ro‘yxatini **ADMIN** (`expenses.manage`) boshqaradi: qo‘shadi, nomini o‘zgartiradi, nofaol qiladi; nom registrsiz takrorlanmaydi (`409 NAME_TAKEN`); ishlatilgan kategoriya o‘chirilmaydi (BR-31); boshlang‘ich ro‘yxat **bo‘sh** (seed yo‘q). (4) Xarajat sanasi **kelajakda bo‘lishi mumkin emas** (Toshkent vaqti bo‘yicha bugundan keyin → `400`, `date`); o‘tgan sanalar ruxsat. (5) Holat (`PAID`/`PENDING`) yo‘q — D-11 o‘z kuchida | Biznes egasining 2026-10-23 dagi javobi ("Kategoriyani qo‘shib qo‘yish kerak ekan"; "Kelajak sana taqiq"; kategoriya majburiy; sotuvchi tanlaydi; admin boshqaradi). REQ-100 (TZ: category) bilan endi mos. Kategoriya yo‘q paytda xarajat qo‘shib bo‘lmaydi — UI buni tushuntiradi. **Implementatsiya (Phase 11):** API §12. Tekshiruv: (1) `expenses.db-spec.ts` "rad etiladi: kategoriyasiz…", `constraints.db-spec.ts` (NOT NULL), shared `expenses.test.ts`; (2) "sotuvchi: faqat faol kategoriyalar (`id, name`)…", "noma’lum kategoriya → 404; nofaol → 422", `ExpensesPage.test.tsx`; (3) "kategoriyalar" describe (409 NAME_TAKEN, nofaol qilish, ishlatilganini o‘chirib bo‘lmaydi), seed'da kategoriya yo‘q; (4) "D-19: sana Toshkent bo‘yicha bugundan keyin → 400", unit `expenses.spec.ts` (yarim tun chegarasi); (5) migratsiya testi, `status` → `400` |
| D-20 | Phase 11 implementatsiya qarorlari — **biznes egasi tomonidan tasdiqlangan (2026-10-23)** | (1) Xarajat kategoriyasi faqat **ishlatilmagan** bo‘lsa o‘chiriladi (`DELETE /expense-categories/:id`; soft-delete qilingan xarajat ham kategoriyani band qiladi → `409 ENTITY_IN_USE`, o‘rniga nofaol qilinadi — BR-31). (2) Nofaol kategoriyaga **yangi** xarajat yozilmaydi (`422 EXPENSE_CATEGORY_INACTIVE`), lekin eski xarajat tahrirlanganda uning joriy (nofaol) kategoriyasi saqlanishi mumkin | Tekshiruv: `expenses.db-spec.ts` ("ishlatilgan kategoriya … o‘chirilmaydi → 409; bo‘shi → 204", "kelajak sanaga → 400; nofaol kategoriyaga ko‘chirish → 422; nofaol kategoriyadagi eski xarajatni … tahrirlash mumkin"), real backend E2E |
| D-21 | Phase 12 doirasi (hisobotlar, dashboard, sozlamalar) — **biznes egasi tomonidan tasdiqlangan (2026-10-24)** | (1) Sozlamalar (`GET/PATCH /settings`) Phase 12 da backend'ga ulanadi. (2) Mock bosqichidagi qo‘shimcha ko‘rsatkichlar saqlanadi va tranzaksion ma’lumotdan hisoblanadi: "kechaga nisbatan" (`yesterday.salesAmount`), **o‘rtacha chek** = tushum ÷ sotuvlar soni (sotuv bo‘lmasa — 0), savdo grafigi (7/14/30 kun), eng ko‘p sotilgan 5 mahsulot (summa bo‘yicha), hisobotlardagi "o‘rtacha chek" ustuni. (3) Sana filtri bor hisobotlarda sana oralig‘i **majburiy**, ko‘pi bilan 366 kun; UI standarti — **joriy oy** (Toshkent bo‘yicha oyning 1-kunidan bugungacha). (4) REQ-167: 1 mln sotuvli alohida benchmark (`EXPLAIN ANALYZE`), doimiy test to‘plamiga kirmaydi. (5) Sozlamalar — **faqat API §16 dagi 3 ta maydon** (kompaniya nomi, kam qoldiq chegarasi, valyuta yozuvi); mock UI'dagi yuridik nom, INN, telefon, manzil, standart ombor va "kirimni tasdiqlash talab qilinsin" (ta’siri yo‘q edi) olib tashlanadi; kassa va kirimda standart ombor — foydalanuvchiga ruxsat etilgan birinchi faol ombor. (6) `finance-summary`da ombor tanlansa "Xarajatlar" va "Sof foyda" hisoblanmaydi (`null`, UI'da "—" va izoh) — xarajatlar omborga bog‘lanmagan, taqsimlash qoidasi yo‘q | Biznes egasining 2026-10-24 dagi javoblari |
| D-24 | Nasiya bo‘limi — **biznes egasi so‘rovi (2026-11-05)** | (1) Faqat ADMIN (`credits.manage`); sotuvchiga menyuda ko‘rinmaydi, server `403`. (2) Nasiya: kim (ism, ixtiyoriy telefon — mijozlar bazasiga bog‘lanmagan), summa, olingan sana va vaqt, birinchi to‘lov sanasi, necha marta, har necha kunda. (3) Summa teng bo‘linadi (butun so‘m, qoldiq oxirgi to‘lovda). (4) To‘lovlar jadvalga tartib bilan taqsimlanadi: yetmagani muddat o‘tgach keyingi to‘lovga qo‘shiladi, ortig‘i keyingisidan ayriladi; qoldiqdan oshsa `422 CREDIT_OVERPAID`. (5) To‘lov kunidan bir kun oldin eslatma — qo‘ng‘iroqcha va bo‘lim tepasi (ilova ichida; SMS yo‘q). (6) Nasiya sotuv, ombor qoldig‘i va hisobotlarga bog‘lanmagan. Tahrirlash va o‘chirish yo‘q | Tekshiruv: `credits.test.ts`, `credits.db-spec.ts`, `CreditsPage.test.tsx` |
| D-23 | Xarajatlarda sotuvchi doirasi — **biznes egasi so‘rovi (2026-11-03)**, D-12 va D-19’ning sotuvchiga oid qismini almashtiradi | (1) Sotuvchi (`expenses.create`) faqat **o‘zi qo‘shgan** xarajatlarni ro‘yxatda va detalda ko‘radi (`createdBy` filtri serverda majburan o‘zi; begonasi — `404`); tahrirlash/o‘chirish — faqat ADMIN. (2) Sotuvchi faqat **o‘zi qo‘shgan** faol kategoriyalarni ko‘radi va tanlaydi (admin kategoriyasi — `404`); xarajat formasida "+ Yangi kategoriya" orqali o‘zi qo‘shadi (`POST /expense-categories`). (3) Kategoriya nomi **har bir user ichida** noyob (`expense_categories_owner_name_lower_key`, migratsiya `20261103100000`); turli userlarda bir xil nom bo‘lishi mumkin. (4) ADMIN hamma xarajat va kategoriyani ko‘radi, kategoriyada kim qo‘shgani (`createdBy`) bor | Tekshiruv: `expenses.db-spec.ts` (D-23), `rbac-matrix.db-spec.ts`, `ExpensesPage.test.tsx` |
| D-22 | Phase 13 audit jurnali — **biznes egasi tomonidan tasdiqlangan (2026-10-28)** | (1) Mock (demo) rejimi ham audit yozadi: har bir mock mutatsiyasi backend bilan bir xil amal nomi va metadata shakli bilan (`frontend/src/mocks/audit.ts`); mock’da IP, so‘rov ID, lockout va refresh reuse yo‘q; demo jurnalida oxirgi 2 000 yozuv saqlanadi. (2) Tafsilotlar umumiy ko‘rinishda: amal nomi o‘zbekcha, metadata — kalit → qiymat (o‘zgarishlar "oldin → keyin", ID’lar mavjud ro‘yxatlardan nomga aylanadi); har bir amal uchun alohida matn yozilmaydi. (3) Jurnal Sozlamalar ichidagi "Audit jurnali" bo‘limida (A-20), faqat `audit.read`. (4) Sahifalash — cursor ("Yana yuklash"), jami son yo‘q | Tekshiruv: `mock-api.test.ts` (audit), `AuditLogView.test.tsx`, `metadata.test.ts`, real backend E2E |

---

## 6. Taxminlar ([ASSUMPTION])

| ID | Taxmin | Sabab |
|---|---|---|
| A-01 | Rollar va permissionlar jadvallarda; 2 ta rol seed qilinadi | §2 "explicitly authorized read operations" permission modelini talab qiladi |
| A-03 | USER mahsulot guruhlari ro‘yxatini faqat filtr uchun o‘qiydi | Sotuvdagi qidiruv uchun |
| A-05 | Login uzunligi 3–32; kiritilgan ko‘rinishda saqlanadi, kirishda case-insensitive | TZ'da uzunlik berilmagan |
| A-06 | Parol `000000`–`999999`, boshida 0 bo‘lishi mumkin | "Aynan 6 raqam" shartiga mos va entropiya to‘liq saqlanadi |
| A-08 | `groupId` majburiy | Hisobotlarda guruh bo‘yicha bo‘lish izchil bo‘ladi |
| A-09 | Bitta kirimda mahsulot bir marta | Totallar va ledger'ni soddalashtiradi |
| A-10 | Xarajat kategoriyasi alohida jadval | Hisobotda guruhlash uchun |
| A-13 | Product'ga `unit` va `allow_decimal` qo‘shiladi | §8 "product policy" — maydon TZ'da yo‘q |
| A-14 | USER bosh sahifasi: "Yangi sotuv" + o‘zining bugungi ko‘rsatkichlari | Dashboard TZ'da "Admin dashboard" deb berilgan |
| A-15 | Kam qoldiq: `products.min_stock` yoki global sozlama (standart 5) | §4 chegara bermaydi |
| A-16 | Faol userlar = `status = ACTIVE` soni (+ "bugun sotuv qilganlar") | §4 ta’rif bermaydi |
| A-17 | "Sotilgan/sotilmagan" filtri — tanlangan davrda sotuvi bor yoki yo‘q mahsulotlar | §10 ta’rif bermaydi |
| A-18 | Sotuvchi narxni o‘zgartira olmaydi, chegirma yo‘q | TZ'da yo‘q |
| A-19 | USER parolini o‘zi o‘zgartira olmaydi; parolni faqat ADMIN tiklaydi (yangi 6 xonali parol) | §3 "tizim yaratadi" |
| A-20 | Sozlamalar: kompaniya nomi, kam qoldiq chegarasi, valyuta yorlig‘i; audit jurnali sahifasi ham shu bo‘limda | §16 mazmun bermaydi; §16 navigatsiyasida audit bo‘limi yo‘q |
| A-21 | Birinchi admin seed orqali yaratiladi; parol faqat seed terminal chiqishida bir marta ko‘rsatiladi | "Faqat admin yaratadi" qoidasidagi tovuq-tuxum muammosi |
| A-22 | Sof foyda = hisoblangan foyda − xarajatlar (qo‘shimcha ko‘rsatkich) | §11 faqat yalpi foyda formulasini beradi |
| A-23 | Telefon `+998XXXXXXXXX` ga normallashtiriladi va unique emas | Oila a’zolarida bitta raqam bo‘lishi mumkin |
| A-24 | Kirim avval DRAFT, keyin tasdiqlanadi | §7 "on confirmation" + §19 "edit an incoming item quantity" |
| A-25 | Ko‘rsatiladigan raqamlar: kirim `K-000123`, sotuv `S-000123` | Qog‘oz hujjat va qidiruv uchun |
| A-26 | Login yaratilgandan keyin o‘zgartirilmaydi | Audit va identifikatsiya barqarorligi |
| A-27 | ~~Xarajat holati: `PAID` (standart) yoki `PENDING`; xarajatlar jamiga ikkalasi kiradi, alohida ham ko‘rsatiladi~~ | TZ §11 holat bermaydi; frontend "Chiqim" sahifasida "To‘langan / Kutilmoqda" ustuni bor (API §18). Phase 2'da DB'ga kiritildi; Phase 11'da biznes egasi bilan tasdiqlanadi — **BEKOR (D-11, 2026-10-22)** |
| A-L06 | "Ombordagi jami miqdor" bitta raqam sifatida va birlik bo‘yicha bo‘linma bilan ko‘rsatiladi | Turli birliklarni (dona + kg) qo‘shish ma’nosiz bo‘lishi mumkin |
| A-L11 | Performance maqsadi: oddiy API p95 < 300 ms; hisobotlar 1 mln sotuvda < 2 s | TZ'da raqam yo‘q (REQ-167) |
