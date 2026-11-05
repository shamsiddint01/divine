import { Module } from '@nestjs/common';
import { CreditsController } from './credits.controller.js';
import { CreditsRepository } from './credits.repository.js';
import { CreditsService } from './credits.service.js';

/** Nasiya (D-24): faqat ADMIN. */
@Module({
  controllers: [CreditsController],
  providers: [CreditsService, CreditsRepository],
})
export class CreditsModule {}
