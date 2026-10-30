import { Module } from '@nestjs/common';
import { InventoryController } from './inventory.controller.js';
import { InventoryRepository } from './inventory.repository.js';
import { InventoryService } from './inventory.service.js';
import { ReconciliationJob } from './reconciliation.job.js';

/** Inventar (Phase 7): qoldiq o'zgarishlari, ledger, reconciliation. Kirim/sotuv modullari import qiladi. */
@Module({
  controllers: [InventoryController],
  providers: [InventoryService, InventoryRepository, ReconciliationJob],
  exports: [InventoryService],
})
export class InventoryModule {}
