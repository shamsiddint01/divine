import { Controller, Delete, Get, HttpCode, Patch, Post, Req } from '@nestjs/common';
import { ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import {
  ErrorCode,
  type ExpenseCategoryCreateInput,
  expenseCategoryCreateSchema,
  type ExpenseCategoryDto,
  type ExpenseCategoryUpdateInput,
  expenseCategoryUpdateSchema,
  type ExpenseCreateInput,
  expenseCreateSchema,
  type ExpenseDto,
  type ExpensesListResponse,
  type ExpenseUpdateInput,
  expenseUpdateSchema,
  Permission,
  uuidSchema,
} from '@divine/shared';
import type { Request } from 'express';
import { z } from 'zod';
import type { AccessContext } from '../../common/auth/access-context.js';
import {
  Ctx,
  RequireAnyPermission,
  RequirePermissions,
} from '../../common/auth/auth.decorators.js';
import { createListQuerySchema, listFilters } from '../../common/query/list-query.js';
import { ApiErrorResponses } from '../../common/swagger/api-schemas.js';
import { ZodBody, ZodParam, ZodQuery } from '../../common/validation/zod-validation.pipe.js';
import { requestMeta } from '../auth/auth.http.js';
import type { ListExpensesQuery } from './expenses.repository.js';
import { ExpensesService } from './expenses.service.js';

const listExpensesQuerySchema = createListQuerySchema({
  sortFields: ['date', 'amount'],
  defaultSort: { field: 'date', direction: 'desc' },
  filters: {
    search: listFilters.search(),
    categoryId: listFilters.id(),
    createdBy: listFilters.id(),
    ...listFilters.dateRange(),
  },
});

const listCategoriesQuerySchema = z.object({ isActive: listFilters.boolean() });

const idParam = () => ZodParam('id', uuidSchema);

/**
 * Xarajatlar (Phase 11, API §12). Ro'yxat va detal — `expenses.read` (ADMIN); qo'shish —
 * `expenses.create` (sotuvchi ham, D-12) yoki `expenses.manage`; tahrirlash va o'chirish — `expenses.manage`.
 */
@ApiTags('Expenses')
@Controller('expenses')
export class ExpensesController {
  constructor(private readonly expenses: ExpensesService) {}

  @Get()
  @RequirePermissions(Permission.EXPENSES_READ)
  @ApiOperation({ summary: 'Xarajatlar ro‘yxati (filtrlar, saralash, pagination) va yig‘ma' })
  @ApiOkResponse({ description: 'ExpensesListResponse' })
  @ApiErrorResponses(ErrorCode.VALIDATION_ERROR, ErrorCode.FORBIDDEN)
  list(@ZodQuery(listExpensesQuerySchema) query: ListExpensesQuery): Promise<ExpensesListResponse> {
    return this.expenses.list(query);
  }

  @Get(':id')
  @RequirePermissions(Permission.EXPENSES_READ)
  @ApiOperation({ summary: 'Xarajat ma’lumotlari' })
  @ApiErrorResponses(ErrorCode.NOT_FOUND, ErrorCode.FORBIDDEN)
  get(@idParam() id: string): Promise<ExpenseDto> {
    return this.expenses.get(id);
  }

  @Post()
  @RequireAnyPermission(Permission.EXPENSES_CREATE, Permission.EXPENSES_MANAGE)
  @ApiOperation({ summary: 'Xarajat qo‘shish (sana, summa, kategoriya, izoh)' })
  @ApiErrorResponses(
    ErrorCode.VALIDATION_ERROR,
    ErrorCode.NOT_FOUND,
    ErrorCode.EXPENSE_CATEGORY_INACTIVE,
    ErrorCode.FORBIDDEN,
  )
  create(
    @Ctx() ctx: AccessContext,
    @ZodBody(expenseCreateSchema) body: ExpenseCreateInput,
    @Req() req: Request,
  ): Promise<ExpenseDto> {
    return this.expenses.create(ctx, body, requestMeta(req));
  }

  @Patch(':id')
  @RequirePermissions(Permission.EXPENSES_MANAGE)
  @ApiOperation({ summary: 'Xarajatni qisman tahrirlash' })
  @ApiErrorResponses(
    ErrorCode.VALIDATION_ERROR,
    ErrorCode.NOT_FOUND,
    ErrorCode.EXPENSE_CATEGORY_INACTIVE,
    ErrorCode.FORBIDDEN,
  )
  update(
    @Ctx() ctx: AccessContext,
    @idParam() id: string,
    @ZodBody(expenseUpdateSchema) body: ExpenseUpdateInput,
    @Req() req: Request,
  ): Promise<ExpenseDto> {
    return this.expenses.update(ctx, id, body, requestMeta(req));
  }

  @Delete(':id')
  @RequirePermissions(Permission.EXPENSES_MANAGE)
  @HttpCode(204)
  @ApiOperation({ summary: 'Xarajatni o‘chirish (soft delete)' })
  @ApiErrorResponses(ErrorCode.NOT_FOUND, ErrorCode.FORBIDDEN)
  async delete(
    @Ctx() ctx: AccessContext,
    @idParam() id: string,
    @Req() req: Request,
  ): Promise<void> {
    await this.expenses.delete(ctx, id, requestMeta(req));
  }
}

/**
 * Xarajat kategoriyalari (D-19). O'qish — xarajat qo'sha oladigan har kim (sotuvchi: faqat faollari,
 * `id, name`); boshqarish — `expenses.manage` (ADMIN).
 */
@ApiTags('Expenses')
@Controller('expense-categories')
export class ExpenseCategoriesController {
  constructor(private readonly expenses: ExpensesService) {}

  @Get()
  @RequireAnyPermission(
    Permission.EXPENSES_READ,
    Permission.EXPENSES_CREATE,
    Permission.EXPENSES_MANAGE,
  )
  @ApiOperation({ summary: 'Kategoriyalar ro‘yxati' })
  @ApiOkResponse({ description: 'ExpenseCategoryDto[]' })
  @ApiErrorResponses(ErrorCode.VALIDATION_ERROR, ErrorCode.FORBIDDEN)
  list(
    @Ctx() ctx: AccessContext,
    @ZodQuery(listCategoriesQuerySchema) query: { isActive?: boolean },
  ): Promise<ExpenseCategoryDto[]> {
    return this.expenses.listCategories(ctx, query);
  }

  @Post()
  @RequirePermissions(Permission.EXPENSES_MANAGE)
  @ApiOperation({ summary: 'Kategoriya qo‘shish' })
  @ApiErrorResponses(ErrorCode.VALIDATION_ERROR, ErrorCode.NAME_TAKEN, ErrorCode.FORBIDDEN)
  create(
    @Ctx() ctx: AccessContext,
    @ZodBody(expenseCategoryCreateSchema) body: ExpenseCategoryCreateInput,
    @Req() req: Request,
  ): Promise<ExpenseCategoryDto> {
    return this.expenses.createCategory(ctx, body, requestMeta(req));
  }

  @Patch(':id')
  @RequirePermissions(Permission.EXPENSES_MANAGE)
  @ApiOperation({ summary: 'Kategoriyani qayta nomlash yoki nofaol qilish' })
  @ApiErrorResponses(ErrorCode.VALIDATION_ERROR, ErrorCode.NOT_FOUND, ErrorCode.NAME_TAKEN)
  update(
    @Ctx() ctx: AccessContext,
    @idParam() id: string,
    @ZodBody(expenseCategoryUpdateSchema) body: ExpenseCategoryUpdateInput,
    @Req() req: Request,
  ): Promise<ExpenseCategoryDto> {
    return this.expenses.updateCategory(ctx, id, body, requestMeta(req));
  }

  @Delete(':id')
  @RequirePermissions(Permission.EXPENSES_MANAGE)
  @HttpCode(204)
  @ApiOperation({ summary: 'Xarajatsiz kategoriyani o‘chirish (BR-31)' })
  @ApiErrorResponses(ErrorCode.NOT_FOUND, ErrorCode.ENTITY_IN_USE)
  async delete(
    @Ctx() ctx: AccessContext,
    @idParam() id: string,
    @Req() req: Request,
  ): Promise<void> {
    await this.expenses.deleteCategory(ctx, id, requestMeta(req));
  }
}
