import { Injectable, Logger } from '@nestjs/common';
import { ErrorCode } from '@divine/shared';
import { AppError } from '../../common/errors/app-error.js';
import { InjectConfig } from '../../config/config.module.js';
import type { AppConfig } from '../../config/env.schema.js';

const TELEGRAM_TIMEOUT_MS = 15_000;

/** Egasining Telegram'iga xabar: superadmin kirish kodi va kunlik eslatmalar. Sozlanmagan — o'chiq. */
@Injectable()
export class TelegramService {
  private readonly logger = new Logger(TelegramService.name);

  constructor(@InjectConfig() private readonly config: AppConfig) {}

  get enabled(): boolean {
    return Boolean(this.config.TELEGRAM_BOT_TOKEN && this.config.TELEGRAM_CHAT_ID);
  }

  async send(text: string): Promise<void> {
    let reason = 'Telegram javob bermadi';
    try {
      const response = await fetch(
        `https://api.telegram.org/bot${this.config.TELEGRAM_BOT_TOKEN}/sendMessage`,
        {
          method: 'POST',
          signal: AbortSignal.timeout(TELEGRAM_TIMEOUT_MS),
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ chat_id: this.config.TELEGRAM_CHAT_ID, text }),
        },
      );
      if (response.ok) return;
      const body = (await response.json().catch(() => null)) as { description?: string } | null;
      reason = describe(response.status, body?.description);
    } catch {
      // Tarmoq xatosi: `reason` o'zgarmaydi. Xabarda token yo'q.
    }
    this.logger.warn(`Telegram xabari yuborilmadi: ${reason}`);
    throw new AppError(ErrorCode.SERVICE_UNAVAILABLE, {
      message: `Telegram’ga xabar yuborib bo‘lmadi: ${reason}`,
    });
  }
}

/** Telegram javobi → egasiga tushunarli sabab (token va chat ID qiymatlarisiz). */
function describe(status: number, description = ''): string {
  if (status === 401 || status === 404) return 'bot tokeni noto‘g‘ri (Render: TELEGRAM_BOT_TOKEN)';
  if (/chat not found/i.test(description)) {
    return 'chat topilmadi: botga Start bosing va TELEGRAM_CHAT_ID ni tekshiring';
  }
  if (/blocked|deactivated|initiate/i.test(description)) {
    return 'bot sizga yoza olmayapti: botni oching va Start bosing';
  }
  return description || `Telegram xatosi ${status}`;
}
