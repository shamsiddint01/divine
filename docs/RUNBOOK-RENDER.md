# Render + Neon + Upstash (bepul tarif)

Divine.uz'ni bepul xizmatlarda ishga tushirish. Frontend va backend — Render, baza — Neon, Redis — Upstash.
Tarif cheklovlari: backend 15 daqiqa so'rovsiz uxlaydi, baza 1 GB, Upstash oyiga 500 000 buyruq.

## 1. Neon

1. PostgreSQL 18 loyihasi, hudud Frankfurt.
2. Connection string'ni **Connection pooling o'chirilgan** holda oling (`-pooler` bo'lmasin): `pg-connection.ts`
   `options=-c timezone=UTC` yuboradi.

## 2. Upstash

Redis bazasi, hudud Frankfurt. `rediss://` manzilini oling.

## 3. Bazani tayyorlash (noutbukda, bir marta)

Repo ildizida `.env.render` yarating (`.gitignore`da):

```bash
NEON_OWNER_URL=postgresql://...
REDIS_URL=rediss://...
ADMIN_LOGIN=admin
```

```bash
scripts/render/setup-db.sh
```

Admin paroli terminalda bir marta chiqadi. Render qiymatlari `.env.render.secrets` faylida.
`PASSWORD_PEPPER`ni yo'qotmang: usiz parollarni tekshirib bo'lmaydi.

## 4. Render

1. New → Blueprint → `shamsiddint01/divine` (`render.yaml` o'qiladi).
2. `DATABASE_URL`, `REDIS_URL`, `JWT_ACCESS_SECRET`, `PASSWORD_PEPPER` qiymatlarini `.env.render.secrets`dan kiriting.
3. Xizmat nomi band bo'lsa, Render boshqa manzil beradi: `render.yaml`dagi `CORS_ORIGINS` va `/api/*` rewrite
   manzilini shunga moslang.

## 5. Ishga tushgandan keyin tekshirish

- `https://divine-uz-api.onrender.com/api/v1/health` — `database` va `redis` `up`.
- Saytga kirish, sahifani yangilash (refresh cookie), sotuv, nasiya.
- `TRUST_PROXY`: audit logdagi IP foydalanuvchiniki bo'lishi kerak. Render proxy'si bo'lsa, qiymatni oshiring,
  aks holda login limiti (daqiqasiga 10) hamma uchun umumiy bo'lib qoladi.

## Bekap

Neon'dan to'liq nusxa trafik sarflaydi (oyiga 5 GB). Katta bazada haftalik oling.
