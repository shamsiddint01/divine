import { Module } from '@nestjs/common';
import { SalesModule } from '../sales/sales.module.js';
import { CustomersController } from './customers.controller.js';
import { CustomersRepository } from './customers.repository.js';
import { CustomersService } from './customers.service.js';

/** Mijozlar (Phase 9). Sotuv moduli (Phase 10) mijoz yig'malarini o'z tranzaksiyasida yangilaydi. */
@Module({
  imports: [SalesModule],
  controllers: [CustomersController],
  providers: [CustomersService, CustomersRepository],
})
export class CustomersModule {}
