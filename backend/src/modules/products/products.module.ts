import { Module } from '@nestjs/common';
import { IncomingModule } from '../incoming/incoming.module.js';
import { ProductsController } from './products.controller.js';
import { ProductsRepository } from './products.repository.js';
import { ProductsService } from './products.service.js';

/** Mahsulotlar (Phase 6) + qoldiq qo'shish (sobiq "Kirim" bo'limi). */
@Module({
  imports: [IncomingModule],
  controllers: [ProductsController],
  providers: [ProductsService, ProductsRepository],
})
export class ProductsModule {}
