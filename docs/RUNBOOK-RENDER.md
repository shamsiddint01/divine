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
- `TRUST_PROXY=loopback,uniquelocal,cloudflare,render`: sayt orqali so'rov 5 ta, API'ga to'g'ridan 2 ta proxy'dan
  o'tadi (2026-11-07 o'lchovi), shuning uchun hop soni emas, ishonchli proxy'lar ro'yxati. Tekshirish:
  `GET /api/v1/site-control/request-info` (`x-control-token`) — `ip` foydalanuvchiniki bo'lishi kerak.

## Bekap

- Har kecha 02:00 (Toshkent) `.github/workflows/backup.yml`: `pg_dump` → AES256 bilan shifrlash → GitHub artifact (30 kun).
  Natija saytga (`/site-control/backup-report`) yuboriladi, superadmin paneli "Bekap" ustunida ko'rsatadi.
- GitHub kalitlari: `scripts/render/backup-secrets.sh` chiqaradi (`BACKUP_DATABASE_URL`, `BACKUP_PASSPHRASE`,
  `SITE_CONTROL_TOKEN`). `BACKUP_PASSPHRASE` `.env.render.secrets`da: usiz nusxani ochib bo'lmaydi.
- Qo'lda: GitHub → Actions → Bekap → Run workflow.
- Tiklash: artifact'ni yuklab, `scripts/render/decrypt-backup.sh divine.dump.gpg`, keyin **yangi** bazaga
  `pg_restore --no-owner --no-privileges -d "<yangi baza>" divine.dump`. Ishlab turgan bazaga tiklamang.
- Neon'dan to'liq nusxa trafik sarflaydi (oyiga 5 GB): baza kattalashsa, kunlikdan haftalikka o'ting.

## Superadmin paneli

- Manzil: `https://divine-uz-superadmin.onrender.com`. Hisob saytning `users`idan alohida (`control_admins`).
- Birinchi sozlash: `scripts/render/setup-superadmin.sh <login>` (migratsiya, hisob, birinchi sayt).
- Sayt muddatni o'zida saqlaydi (`site_license`) va o'zi bloklaydi: panel uxlasa ham blok ishlaydi.
- **Migratsiya koddan oldin:** auto-sync har o'zgarishni `main`ga chiqaradi va Render darhol ishga tushiradi.
  Yangi jadvalga bog'liq kod bo'lsa, avval Neon'ga migratsiya qiling.

## Telegram

- Render'dagi `divine-uz-api` → Environment: `TELEGRAM_BOT_TOKEN` va `TELEGRAM_CHAT_ID`. Ikkalasi bo'lsa — superadmin
  kirishida Telegram kodi (5 daqiqa, 5 urinish) va har kuni 09:00 eslatma (`.github/workflows/reminders.yml`).
- Chat ID: botga `/start` yozib, `scripts/render/telegram-chat-id.sh`.
- Telegram ishlamay qolsa yoki bot yo'qolsa: Render'da shu ikki o'zgaruvchini o'chiring — kirish parol bilan qoladi.

