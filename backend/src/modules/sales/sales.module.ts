import { Module } from '@nestjs/common';
import { InventoryModule } from '../inventory/inventory.module.js';
import { SalesController } from './sales.controller.js';
import { SalesRepository } from './sales.repository.js';
import { SalesService } from './sales.service.js';

/** Sotuvlar (Phase 10). Qoldiq faqat `InventoryService` orqali; `SalesRepository` mijoz xarid tarixida ham. */
@Module({
  imports: [InventoryModule],
  controllers: [SalesController],
  providers: [SalesService, SalesRepository],
  exports: [SalesRepository],
})
export class SalesModule {}
