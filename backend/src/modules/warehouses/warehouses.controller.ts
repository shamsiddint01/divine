import { Controller, Get, Patch, Post, Req } from '@nestjs/common';
import { ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import {
  ErrorCode,
  type MovementDto,
  type Paginated,
  Permission,
  type StockRowDto,
  uuidSchema,
  WAREHOUSE_STATUSES,
  type WarehouseCreateInput,
  warehouseCreateSchema,
  type WarehouseDetailDto,
  type WarehouseDto,
  type WarehouseListItemDto,
  type WarehouseStatusInput,
  warehouseStatusSchema,
  type WarehouseUpdateInput,
  warehouseUpdateSchema,
} from '@divine/shared';
import type { Request } from 'express';
import type { AccessContext } from '../../common/auth/access-context.js';
import { Ctx, RequirePermissions } from '../../common/auth/auth.decorators.js';
import { createListQuerySchema, listFilters } from '../../common/query/list-query.js';
import { ApiErrorResponses } from '../../common/swagger/api-schemas.js';
import { ZodBody, ZodParam, ZodQuery } from '../../common/validation/zod-validation.pipe.js';
import { requestMeta } from '../auth/auth.http.js';
import { movementFilters } from '../inventory/inventory.controller.js';
import type { MovementFilter } from '../inventory/inventory.repository.js';
import type { ListWarehousesQuery, StockQuery } from './warehouses.repository.js';
import { WarehousesService } from './warehouses.service.js';

const listWarehousesQuerySchema = createListQuerySchema({
  sortFields: ['name', 'createdAt'],
  defaultSort: { field: 'createdAt', direction: 'asc' },
  filters: { search: listFilters.search(), status: listFilters.oneOf(WAREHOUSE_STATUSES) },
});

const stockQuerySchema = createListQuerySchema({
  sortFields: ['productName', 'quantity', 'stockValue', 'updatedAt'],
  defaultSort: { field: 'productName', direction: 'asc' },
  filters: {
    search: listFilters.search(),
    groupId: listFilters.id(),
    stock: listFilters.oneOf(['low', 'out'] as const),
  },
});

const movementsQuerySchema = createListQuerySchema({
  sortFields: ['createdAt'],
  defaultSort: { field: 'createdAt', direction: 'desc' },
  filters: movementFilters,
});

const idParam = () => ZodParam('id', uuidSchema);

/**
 * Omborlar (Phase 7, API §7). Ro'yxat — `warehouses.read` (USER: faqat biriktirilgan ACTIVE omborlar,
 * OWN-01); detal, qoldiq, harakatlar — `warehouses.read_all`; o'zgartirish — `warehouses.manage`.
 */
@ApiTags('Warehouses')
@Controller('warehouses')
export class WarehousesController {
  constructor(private readonly warehouses: WarehousesService) {}

  @Get()
  @RequirePermissions(Permission.WAREHOUSES_READ)
  @ApiOperation({ summary: 'Omborlar ro‘yxati (qidiruv, holat, saralash, pagination)' })
  @ApiOkResponse({ description: 'Paginated<WarehouseListItemDto>' })
  @ApiErrorResponses(ErrorCode.VALIDATION_ERROR, ErrorCode.FORBIDDEN)
  list(
    @Ctx() ctx: AccessContext,
    @ZodQuery(listWarehousesQuerySchema) query: ListWarehousesQuery,
  ): Promise<Paginated<WarehouseListItemDto>> {
    return this.warehouses.list(ctx, query);
  }

  @Get(':id')
  @RequirePermissions(Permission.WAREHOUSES_READ_ALL)
  @ApiOperation({ summary: 'Ombor ma’lumotlari va ko‘rsatkichlari' })
  @ApiErrorResponses(ErrorCode.NOT_FOUND, ErrorCode.FORBIDDEN)
  get(@Ctx() ctx: AccessContext, @idParam() id: string): Promise<WarehouseDetailDto> {
    return this.warehouses.get(ctx, id);
  }

  @Get(':id/stock')
  @RequirePermissions(Permission.WAREHOUSES_READ_ALL)
  @ApiOperation({ summary: 'Ombordagi qoldiqlar' })
  @ApiOkResponse({ description: 'Paginated<StockRowDto>' })
  @ApiErrorResponses(ErrorCode.VALIDATION_ERROR, ErrorCode.NOT_FOUND, ErrorCode.FORBIDDEN)
  stock(
    @Ctx() ctx: AccessContext,
    @idParam() id: string,
    @ZodQuery(stockQuerySchema) query: StockQuery,
  ): Promise<Paginated<StockRowDto>> {
    return this.warehouses.stock(ctx, id, query);
  }

  @Get(':id/movements')
  @RequirePermissions(Permission.WAREHOUSES_READ_ALL)
  @ApiOperation({ summary: 'Ombordagi kirim/chiqim harakatlari' })
  @ApiOkResponse({ description: 'Paginated<MovementDto>' })
  @ApiErrorResponses(ErrorCode.VALIDATION_ERROR, ErrorCode.NOT_FOUND, ErrorCode.FORBIDDEN)
  movements(
    @Ctx() ctx: AccessContext,
    @idParam() id: string,
    @ZodQuery(movementsQuerySchema) query: Omit<MovementFilter, 'scope' | 'warehouseId'>,
  ): Promise<Paginated<MovementDto>> {
    return this.warehouses.movements(ctx, id, query);
  }

  @Post()
  @RequirePermissions(Permission.WAREHOUSES_MANAGE)
  @ApiOperation({ summary: 'Ombor yaratish' })
  @ApiErrorResponses(ErrorCode.VALIDATION_ERROR, ErrorCode.NAME_TAKEN, ErrorCode.FORBIDDEN)
  create(
    @Ctx() ctx: AccessContext,
    @ZodBody(warehouseCreateSchema) body: WarehouseCreateInput,
    @Req() req: Request,
  ): Promise<WarehouseDto> {
    return this.warehouses.create(ctx, body, requestMeta(req));
  }

  @Patch(':id')
  @RequirePermissions(Permission.WAREHOUSES_MANAGE)
  @ApiOperation({ summary: 'Ombor nomi va manzilini tahrirlash' })
  @ApiErrorResponses(ErrorCode.VALIDATION_ERROR, ErrorCode.NOT_FOUND, ErrorCode.NAME_TAKEN)
  update(
    @Ctx() ctx: AccessContext,
    @idParam() id: string,
    @ZodBody(warehouseUpdateSchema) body: WarehouseUpdateInput,
    @Req() req: Request,
  ): Promise<WarehouseDto> {
    return this.warehouses.update(ctx, id, body, requestMeta(req));
  }

  @Patch(':id/status')
  @RequirePermissions(Permission.WAREHOUSES_MANAGE)
  @ApiOperation({ summary: 'Omborni faollashtirish yoki nofaol qilish' })
  @ApiErrorResponses(ErrorCode.VALIDATION_ERROR, ErrorCode.NOT_FOUND, ErrorCode.FORBIDDEN)
  setStatus(
    @Ctx() ctx: AccessContext,
    @idParam() id: string,
    @ZodBody(warehouseStatusSchema) body: WarehouseStatusInput,
    @Req() req: Request,
  ): Promise<WarehouseDto> {
    return this.warehouses.setStatus(ctx, id, body.status, requestMeta(req));
  }
}
