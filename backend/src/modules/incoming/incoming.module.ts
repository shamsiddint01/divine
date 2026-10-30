import { Module } from '@nestjs/common';
import { InventoryModule } from '../inventory/inventory.module.js';
import { IncomingController } from './incoming.controller.js';
import { IncomingRepository } from './incoming.repository.js';
import { IncomingService } from './incoming.service.js';

/** Kirim (Phase 8). Qoldiq faqat `InventoryService` orqali o'zgaradi. */
@Module({
  imports: [InventoryModule],
  controllers: [IncomingController],
  providers: [IncomingService, IncomingRepository],
})
export class IncomingModule {}
