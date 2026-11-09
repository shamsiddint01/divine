import { Module } from '@nestjs/common';
import { TelegramService } from './telegram.service.js';

/** Egasining Telegram'i: superadmin kodi, eslatmalar va murojaatlar. */
@Module({ providers: [TelegramService], exports: [TelegramService] })
export class TelegramModule {}
