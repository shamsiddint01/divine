#!/usr/bin/env bash
# Bot tokeni bilan chat ID'ni topadi (docs/RUNBOOK-RENDER.md, "Telegram"). Avval botga /start yozing.
set -euo pipefail
read -rsp "Bot tokeni (BotFather bergan): " TOKEN
echo
curl -sS --max-time 20 "https://api.telegram.org/bot${TOKEN}/getUpdates" | node -e '
  let raw = ""; process.stdin.on("data", (c) => (raw += c)).on("end", () => {
    const data = JSON.parse(raw);
    if (!data.ok) { console.log("Token noto‘g‘ri"); process.exit(1); }
    const chats = [...new Set(data.result.map((u) => (u.message || u.my_chat_member || {}).chat?.id).filter(Boolean))];
    if (chats.length === 0) { console.log("Xabar topilmadi: botga /start yozing va qayta ishga tushiring"); process.exit(1); }
    console.log("TELEGRAM_CHAT_ID:", chats.at(-1));
  });'
