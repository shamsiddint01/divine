#!/usr/bin/env bash
# Bot tokeni qaysi botniki va Telegram xabarlarni saytga yetkazyaptimi (webhook holati).
# Egasining boti: Render → divine-uz-api → TELEGRAM_BOT_TOKEN; mijozlar boti: TELEGRAM_PUBLIC_BOT_TOKEN.
# Token ekranda ko'rinmaydi va hech qayerga yozilmaydi. Natija: bot nomi, webhook manzili, oxirgi xato.
set -euo pipefail
read -rsp "Bot tokeni (BotFather yoki Render'dan): " TOKEN
echo
# Nusxalashda qo'shilib ketgan bo'sh joy va qator belgilari olib tashlanadi.
TOKEN=$(printf '%s' "$TOKEN" | tr -d '[:space:]')
if ! [[ "$TOKEN" =~ ^[0-9]+:[A-Za-z0-9_-]+$ ]]; then
  echo "Token formati noto‘g‘ri: 1234567890:AA... ko‘rinishida bo‘lishi kerak" >&2
  exit 1
fi
api() { curl -sS --max-time 20 "https://api.telegram.org/bot${TOKEN}/$1" || true; }
ME=$(api getMe) HOOK=$(api getWebhookInfo) node -e '
  const parse = (raw) => { try { return JSON.parse(raw); } catch { return null; } };
  const me = parse(process.env.ME), hook = parse(process.env.HOOK);
  if (!me) { console.log("Telegram javob bermadi: internetni tekshirib, qayta urinib ko‘ring"); process.exit(1); }
  if (!me.ok) { console.log("Token noto‘g‘ri:", me.description); process.exit(1); }
  console.log("Bot:            @" + me.result.username + " (" + me.result.first_name + ")");
  const w = hook?.result || {};
  console.log("Webhook:        " + (w.url || "YO‘Q — Telegram xabarlarni saytga yubormayapti"));
  console.log("Kutayotgan:     " + (w.pending_update_count ?? 0) + " ta xabar");
  if (w.last_error_date) {
    const at = new Date(w.last_error_date * 1000).toLocaleString("uz-UZ", { timeZone: "Asia/Tashkent" });
    console.log("Oxirgi xato:    " + at + " — " + w.last_error_message);
  } else {
    console.log("Oxirgi xato:    yo‘q");
  }
'
