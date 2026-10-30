import { Module } from '@nestjs/common';
import { InventoryModule } from '../inventory/inventory.module.js';
import { WarehousesController } from './warehouses.controller.js';
import { WarehousesRepository } from './warehouses.repository.js';
import { WarehousesService } from './warehouses.service.js';

/** Omborlar (Phase 7). Harakatlar ro'yxati — InventoryModule'dan (yagona ledger o'quvchisi). */
@Module({
  imports: [InventoryModule],
  controllers: [WarehousesController],
  providers: [WarehousesService, WarehousesRepository],
})
export class WarehousesModule {}
