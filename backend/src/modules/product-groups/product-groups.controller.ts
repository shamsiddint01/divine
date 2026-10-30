import { Controller, Delete, Get, HttpCode, Patch, Post, Req } from '@nestjs/common';
import { ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import {
  ErrorCode,
  type Paginated,
  Permission,
  type ProductGroupCreateInput,
  productGroupCreateSchema,
  type ProductGroupDto,
  type ProductGroupUpdateInput,
  productGroupUpdateSchema,
  uuidSchema,
} from '@divine/shared';
import type { Request } from 'express';
import { type AccessContext, hasPermission } from '../../common/auth/access-context.js';
import { Ctx, RequirePermissions } from '../../common/auth/auth.decorators.js';
import { createListQuerySchema, listFilters } from '../../common/query/list-query.js';
import { ApiErrorResponses } from '../../common/swagger/api-schemas.js';
import { ZodBody, ZodParam, ZodQuery } from '../../common/validation/zod-validation.pipe.js';
import { requestMeta } from '../auth/auth.http.js';
import type { ListGroupsQuery } from './product-groups.repository.js';
import { ProductGroupsService } from './product-groups.service.js';

const listGroupsQuerySchema = createListQuerySchema({
  sortFields: ['name', 'productCount', 'createdAt'],
  defaultSort: { field: 'name', direction: 'asc' },
  filters: { search: listFilters.search(), isActive: listFilters.boolean() },
});

const idParam = () => ZodParam('id', uuidSchema);

/**
 * Mahsulot guruhlari (Phase 6, API §5). O'qish — `product_groups.read` (USER ham: sotuv ekranidagi
 * filtr; USER faqat faol guruhlarni ko'radi), o'zgartirish — `product_groups.manage`.
 */
@ApiTags('Product groups')
@Controller('product-groups')
export class ProductGroupsController {
  constructor(private readonly groups: ProductGroupsService) {}

  @Get()
  @RequirePermissions(Permission.PRODUCT_GROUPS_READ)
  @ApiOperation({ summary: 'Guruhlar ro‘yxati (qidiruv, holat, saralash, pagination)' })
  @ApiOkResponse({ description: 'Paginated<ProductGroupDto>' })
  @ApiErrorResponses(ErrorCode.VALIDATION_ERROR, ErrorCode.FORBIDDEN)
  list(
    @Ctx() ctx: AccessContext,
    @ZodQuery(listGroupsQuerySchema) query: ListGroupsQuery,
  ): Promise<Paginated<ProductGroupDto>> {
    const canManage = hasPermission(ctx, Permission.PRODUCT_GROUPS_MANAGE);
    return this.groups.list(canManage ? query : { ...query, isActive: true });
  }

  @Get(':id')
  @RequirePermissions(Permission.PRODUCT_GROUPS_MANAGE)
  @ApiOperation({ summary: 'Guruh ma’lumotlari' })
  @ApiErrorResponses(ErrorCode.NOT_FOUND, ErrorCode.FORBIDDEN)
  get(@idParam() id: string): Promise<ProductGroupDto> {
    return this.groups.get(id);
  }

  @Post()
  @RequirePermissions(Permission.PRODUCT_GROUPS_MANAGE)
  @ApiOperation({ summary: 'Guruh yaratish' })
  @ApiErrorResponses(ErrorCode.VALIDATION_ERROR, ErrorCode.NAME_TAKEN, ErrorCode.FORBIDDEN)
  create(
    @Ctx() ctx: AccessContext,
    @ZodBody(productGroupCreateSchema) body: ProductGroupCreateInput,
    @Req() req: Request,
  ): Promise<ProductGroupDto> {
    return this.groups.create(ctx, body, requestMeta(req));
  }

  @Patch(':id')
  @RequirePermissions(Permission.PRODUCT_GROUPS_MANAGE)
  @ApiOperation({ summary: 'Guruhni tahrirlash yoki arxivlash (`isActive`)' })
  @ApiErrorResponses(ErrorCode.VALIDATION_ERROR, ErrorCode.NOT_FOUND, ErrorCode.NAME_TAKEN)
  update(
    @Ctx() ctx: AccessContext,
    @idParam() id: string,
    @ZodBody(productGroupUpdateSchema) body: ProductGroupUpdateInput,
    @Req() req: Request,
  ): Promise<ProductGroupDto> {
    return this.groups.update(ctx, id, body, requestMeta(req));
  }

  @Delete(':id')
  @RequirePermissions(Permission.PRODUCT_GROUPS_MANAGE)
  @HttpCode(204)
  @ApiOperation({ summary: 'Mahsulotsiz guruhni o‘chirish' })
  @ApiErrorResponses(ErrorCode.NOT_FOUND, ErrorCode.ENTITY_IN_USE)
  async delete(
    @Ctx() ctx: AccessContext,
    @idParam() id: string,
    @Req() req: Request,
  ): Promise<void> {
    await this.groups.delete(ctx, id, requestMeta(req));
  }
}
