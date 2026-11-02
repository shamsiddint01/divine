import { Module } from '@nestjs/common';
import { InventoryModule } from '../inventory/inventory.module.js';
import { IncomingRepository } from './incoming.repository.js';
import { IncomingService } from './incoming.service.js';

/**
 * Kirim hujjatlari — HTTP endpoint'i yo'q: qoldiq mahsulotlar bo'limidan qo'shiladi
 * (`POST /products`, `POST /products/:id/stock`). Qoldiq faqat `InventoryService` orqali o'zgaradi.
 */
@Module({
  imports: [InventoryModule],
  providers: [IncomingService, IncomingRepository],
  exports: [IncomingService],
})
export class IncomingModule {}
