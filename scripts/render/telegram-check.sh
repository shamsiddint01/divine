#!/usr/bin/env bash
# Render'dagi TELEGRAM_BOT_TOKEN qaysi botniki va Telegram xabarlarni saytga yetkazyaptimi (webhook holati).
# Token ekranda ko'rinmaydi va hech qayerga yozilmaydi. Natija: bot nomi, webhook manzili, oxirgi xato.
set -euo pipefail
read -rsp "Bot tokeni (Render → divine-uz-api → Environment → TELEGRAM_BOT_TOKEN): " TOKEN
echo
api() { curl -sS --max-time 20 "https://api.telegram.org/bot${TOKEN}/$1"; }
{ api getMe; echo; api getWebhookInfo; } | node -e '
  let raw = ""; process.stdin.on("data", (c) => (raw += c)).on("end", () => {
    const [me, hook] = raw.trim().split("\n").map((line) => JSON.parse(line));
    if (!me.ok) { console.log("Token noto‘g‘ri:", me.description); process.exit(1); }
    console.log("Bot:            @" + me.result.username + " (" + me.result.first_name + ")");
    const w = hook.result || {};
    console.log("Webhook:        " + (w.url || "YO‘Q — Telegram xabarlarni saytga yubormayapti"));
    console.log("Kutayotgan:     " + (w.pending_update_count ?? 0) + " ta xabar");
    if (w.last_error_date) {
      const at = new Date(w.last_error_date * 1000).toLocaleString("uz-UZ", { timeZone: "Asia/Tashkent" });
      console.log("Oxirgi xato:    " + at + " — " + w.last_error_message);
    } else {
      console.log("Oxirgi xato:    yo‘q");
    }
  });'
