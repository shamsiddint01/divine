import { Module } from '@nestjs/common';
import { SettingsController } from './settings.controller.js';
import { SettingsService } from './settings.service.js';

/** Sozlamalar (Phase 12). */
@Module({ controllers: [SettingsController], providers: [SettingsService] })
export class SettingsModule {}
