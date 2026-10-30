import { Controller, Get, Patch, Post, Req } from '@nestjs/common';
import { ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import {
  type CustomerCreateInput,
  customerCreateSchema,
  type CustomerDto,
  type CustomerPurchasesResponse,
  type CustomerUpdateInput,
  customerUpdateSchema,
  ErrorCode,
  type Paginated,
  Permission,
  uuidSchema,
} from '@divine/shared';
import type { Request } from 'express';
import type { AccessContext } from '../../common/auth/access-context.js';
import { Ctx, RequirePermissions } from '../../common/auth/auth.decorators.js';
import { createListQuerySchema, listFilters } from '../../common/query/list-query.js';
import { ApiErrorResponses } from '../../common/swagger/api-schemas.js';
import { ZodBody, ZodParam, ZodQuery } from '../../common/validation/zod-validation.pipe.js';
import { requestMeta } from '../auth/auth.http.js';
import type { ListCustomersQuery, PurchasesQuery } from './customers.repository.js';
import { CustomersService } from './customers.service.js';

const listCustomersQuerySchema = createListQuerySchema({
  sortFields: ['name', 'lastPurchaseAt', 'totalSpent', 'purchaseCount', 'createdAt'],
  defaultSort: { field: 'lastPurchaseAt', direction: 'desc' },
  filters: { search: listFilters.search() },
});

const purchasesQuerySchema = createListQuerySchema({
  sortFields: ['soldAt'],
  defaultSort: { field: 'soldAt', direction: 'desc' },
  filters: listFilters.dateRange(),
});

const idParam = () => ZodParam('id', uuidSchema);

/**
 * Mijozlar (Phase 9, API §10). Qidiruv — `customers.read` (USER: sotuv vaqtida, faqat `id, name, phone`);
 * yaratish — `customers.create`; detal va xarid tarixi — `customers.read_history`; tahrirlash —
 * `customers.manage`.
 */
@ApiTags('Customers')
@Controller('customers')
export class CustomersController {
  constructor(private readonly customers: CustomersService) {}

  @Get()
  @RequirePermissions(Permission.CUSTOMERS_READ)
  @ApiOperation({ summary: 'Mijozlarni qidirish (ism yoki telefon), saralash, pagination' })
  @ApiOkResponse({ description: 'Paginated<CustomerDto>' })
  @ApiErrorResponses(ErrorCode.VALIDATION_ERROR, ErrorCode.FORBIDDEN)
  list(
    @Ctx() ctx: AccessContext,
    @ZodQuery(listCustomersQuerySchema) query: ListCustomersQuery,
  ): Promise<Paginated<CustomerDto>> {
    return this.customers.list(ctx, query);
  }

  @Get(':id')
  @RequirePermissions(Permission.CUSTOMERS_READ_HISTORY)
  @ApiOperation({ summary: 'Mijoz ma’lumotlari va yig‘malari' })
  @ApiErrorResponses(ErrorCode.NOT_FOUND, ErrorCode.FORBIDDEN)
  get(@idParam() id: string): Promise<CustomerDto> {
    return this.customers.get(id);
  }

  @Get(':id/purchases')
  @RequirePermissions(Permission.CUSTOMERS_READ_HISTORY)
  @ApiOperation({ summary: 'Mijozning xarid tarixi (sotuvlar) va yig‘masi' })
  @ApiOkResponse({ description: 'CustomerPurchasesResponse' })
  @ApiErrorResponses(ErrorCode.VALIDATION_ERROR, ErrorCode.NOT_FOUND, ErrorCode.FORBIDDEN)
  purchases(
    @Ctx() ctx: AccessContext,
    @idParam() id: string,
    @ZodQuery(purchasesQuerySchema) query: PurchasesQuery,
  ): Promise<CustomerPurchasesResponse> {
    return this.customers.purchases(ctx, id, query);
  }

  @Post()
  @RequirePermissions(Permission.CUSTOMERS_CREATE)
  @ApiOperation({ summary: 'Mijoz yaratish (ism majburiy, telefon ixtiyoriy)' })
  @ApiErrorResponses(ErrorCode.VALIDATION_ERROR, ErrorCode.FORBIDDEN)
  create(
    @Ctx() ctx: AccessContext,
    @ZodBody(customerCreateSchema) body: CustomerCreateInput,
    @Req() req: Request,
  ): Promise<CustomerDto> {
    return this.customers.create(ctx, body, requestMeta(req));
  }

  @Patch(':id')
  @RequirePermissions(Permission.CUSTOMERS_MANAGE)
  @ApiOperation({ summary: 'Mijozni tahrirlash (o‘tgan sotuvlardagi snapshot o‘zgarmaydi)' })
  @ApiErrorResponses(ErrorCode.VALIDATION_ERROR, ErrorCode.NOT_FOUND, ErrorCode.FORBIDDEN)
  update(
    @Ctx() ctx: AccessContext,
    @idParam() id: string,
    @ZodBody(customerUpdateSchema) body: CustomerUpdateInput,
    @Req() req: Request,
  ): Promise<CustomerDto> {
    return this.customers.update(ctx, id, body, requestMeta(req));
  }
}
