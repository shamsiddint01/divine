import { Module } from '@nestjs/common';
import { ProductGroupsController } from './product-groups.controller.js';
import { ProductGroupsRepository } from './product-groups.repository.js';
import { ProductGroupsService } from './product-groups.service.js';

/** Mahsulot guruhlari (Phase 6). */
@Module({
  controllers: [ProductGroupsController],
  providers: [ProductGroupsService, ProductGroupsRepository],
})
export class ProductGroupsModule {}
