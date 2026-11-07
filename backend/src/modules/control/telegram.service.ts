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
    let ok = false;
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
      ok = response.ok;
    } catch {
      // Pastda: xato xabari token'siz.
    }
    if (!ok) {
      this.logger.warn('Telegram xabari yuborilmadi');
      throw new AppError(ErrorCode.SERVICE_UNAVAILABLE, {
        message: 'Telegram’ga xabar yuborib bo‘lmadi, birozdan keyin qayta urinib ko‘ring',
      });
    }
  }
}
