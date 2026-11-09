import { Module } from '@nestjs/common';
import { ControlTokenGuard } from '../site/control-token.guard.js';
import { TelegramModule } from '../telegram/telegram.module.js';
import {
  SupportControlController,
  SupportController,
  TelegramWebhookController,
} from './support.controller.js';
import { SupportService } from './support.service.js';

/** Murojaat bo'limi (2026-11-09). */
@Module({
  imports: [TelegramModule],
  controllers: [SupportController, SupportControlController, TelegramWebhookController],
  providers: [SupportService, ControlTokenGuard],
})
export class SupportModule {}
