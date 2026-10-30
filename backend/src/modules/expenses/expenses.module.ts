import { Module } from '@nestjs/common';
import { ExpenseCategoriesController, ExpensesController } from './expenses.controller.js';
import { ExpensesRepository } from './expenses.repository.js';
import { ExpensesService } from './expenses.service.js';

/** Xarajatlar va kategoriyalar (Phase 11). */
@Module({
  controllers: [ExpensesController, ExpenseCategoriesController],
  providers: [ExpensesService, ExpensesRepository],
})
export class ExpensesModule {}
