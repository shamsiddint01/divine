import { Module } from '@nestjs/common';
import { PublicTelegramService, TelegramService } from './telegram.service.js';

/** Egasining Telegram'i (superadmin kodi, eslatmalar, murojaatlar) va mijozlar boti. */
@Module({
  providers: [TelegramService, PublicTelegramService],
  exports: [TelegramService, PublicTelegramService],
})
export class TelegramModule {}
