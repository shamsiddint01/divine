import { Controller, Get, Patch, Post, Req } from '@nestjs/common';
import { ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import {
  barcodeSchema,
  ErrorCode,
  type Paginated,
  Permission,
  PRODUCT_STATUSES,
  type ProductCreateInput,
  productCreateSchema,
  type ProductDto,
  type ProductStatusInput,
  productStatusSchema,
  type ProductSummaryDto,
  type ProductUpdateInput,
  productUpdateSchema,
  uuidSchema,
} from '@divine/shared';
import type { Request } from 'express';
import { z } from 'zod';
import type { AccessContext } from '../../common/auth/access-context.js';
import { Ctx, RequirePermissions } from '../../common/auth/auth.decorators.js';
import { createListQuerySchema, listFilters } from '../../common/query/list-query.js';
import { ApiErrorResponses } from '../../common/swagger/api-schemas.js';
import { ZodBody, ZodParam, ZodQuery } from '../../common/validation/zod-validation.pipe.js';
import { requestMeta } from '../auth/auth.http.js';
import type { ListProductsQuery } from './products.repository.js';
import { ProductsService } from './products.service.js';

const listProductsQuerySchema = createListQuerySchema({
  sortFields: ['name', 'group', 'stock', 'received', 'sold', 'costPrice', 'salePrice', 'createdAt'],
  defaultSort: { field: 'name', direction: 'asc' },
  filters: {
    search: listFilters.search(),
    groupId: listFilters.id(),
    warehouseId: listFilters.id(),
    status: listFilters.oneOf(PRODUCT_STATUSES),
    stock: listFilters.oneOf(['low', 'out']),
  },
});

const lookupQuerySchema = z.object({
  barcode: barcodeSchema,
  warehouseId: listFilters.id(),
});

const idParam = () => ZodParam('id', uuidSchema);

/**
 * Mahsulotlar (Phase 6, API §6). Barcha javoblar `toProductDto` orqali: `costPrice` faqat
 * `products.read_cost` bilan (OWN-06). `lookup` — `:id` dan OLDIN (aks holda id sifatida ushlanardi).
 */
@ApiTags('Products')
@Controller('products')
export class ProductsController {
  constructor(private readonly products: ProductsService) {}

  @Get()
  @RequirePermissions(Permission.PRODUCTS_READ)
  @ApiOperation({
    summary: 'Mahsulotlar: qidiruv (nom yoki shtrix-kod), filtr, saralash, pagination',
  })
  @ApiOkResponse({ description: 'Paginated<ProductDto>' })
  @ApiErrorResponses(ErrorCode.VALIDATION_ERROR, ErrorCode.WAREHOUSE_ACCESS_DENIED)
  list(
    @Ctx() ctx: AccessContext,
    @ZodQuery(listProductsQuerySchema) query: ListProductsQuery,
  ): Promise<Paginated<ProductDto>> {
    return this.products.list(ctx, query);
  }

  @Get('lookup')
  @RequirePermissions(Permission.PRODUCTS_READ)
  @ApiOperation({ summary: 'Shtrix-kod bo‘yicha faol mahsulot (skaner)' })
  @ApiErrorResponses(ErrorCode.NOT_FOUND, ErrorCode.WAREHOUSE_ACCESS_DENIED)
  lookup(
    @Ctx() ctx: AccessContext,
    @ZodQuery(lookupQuerySchema) query: z.infer<typeof lookupQuerySchema>,
  ): Promise<ProductDto> {
    return this.products.lookup(ctx, query.barcode, query.warehouseId);
  }

  @Get(':id')
  @RequirePermissions(Permission.PRODUCTS_READ)
  @ApiOperation({ summary: 'Mahsulot' })
  @ApiErrorResponses(ErrorCode.NOT_FOUND)
  get(@Ctx() ctx: AccessContext, @idParam() id: string): Promise<ProductDto> {
    return this.products.get(ctx, id);
  }

  @Get(':id/summary')
  @RequirePermissions(Permission.PRODUCTS_READ_COST)
  @ApiOperation({ summary: 'Mahsulot tafsiloti: tushum, kelgan narxi, foyda, oxirgi sotuvlar' })
  @ApiErrorResponses(ErrorCode.NOT_FOUND, ErrorCode.FORBIDDEN)
  summary(@Ctx() ctx: AccessContext, @idParam() id: string): Promise<ProductSummaryDto> {
    return this.products.summary(ctx, id);
  }

  @Post()
  @RequirePermissions(Permission.PRODUCTS_MANAGE)
  @ApiOperation({ summary: 'Mahsulot yaratish (ixtiyoriy boshlang‘ich qoldiq bilan)' })
  @ApiErrorResponses(
    ErrorCode.VALIDATION_ERROR,
    ErrorCode.BARCODE_TAKEN,
    ErrorCode.NOT_FOUND,
    ErrorCode.PRODUCT_GROUP_INACTIVE,
    ErrorCode.FORBIDDEN,
    ErrorCode.WAREHOUSE_INACTIVE,
    ErrorCode.INVALID_QUANTITY,
  )
  create(
    @Ctx() ctx: AccessContext,
    @ZodBody(productCreateSchema) body: ProductCreateInput,
    @Req() req: Request,
  ): Promise<ProductDto> {
    return this.products.create(ctx, body, requestMeta(req));
  }

  @Patch(':id')
  @RequirePermissions(Permission.PRODUCTS_MANAGE)
  @ApiOperation({ summary: 'Mahsulotni tahrirlash (tarixiy hujjatlar o‘zgarmaydi)' })
  @ApiErrorResponses(
    ErrorCode.VALIDATION_ERROR,
    ErrorCode.BARCODE_TAKEN,
    ErrorCode.NOT_FOUND,
    ErrorCode.PRODUCT_GROUP_INACTIVE,
  )
  update(
    @Ctx() ctx: AccessContext,
    @idParam() id: string,
    @ZodBody(productUpdateSchema) body: ProductUpdateInput,
    @Req() req: Request,
  ): Promise<ProductDto> {
    return this.products.update(ctx, id, body, requestMeta(req));
  }

  @Post(':id/stock')
  @RequirePermissions(Permission.INCOMING_MANAGE, Permission.INCOMING_CONFIRM)
  @ApiOperation({ summary: 'Qoldiq qo‘shish (tasdiqlangan kirim hujjati; ledger, audit)' })
  @ApiErrorResponses(
    ErrorCode.VALIDATION_ERROR,
    ErrorCode.NOT_FOUND,
    ErrorCode.WAREHOUSE_INACTIVE,
    ErrorCode.PRODUCT_INACTIVE,
    ErrorCode.INVALID_QUANTITY,
  )
  addStock(
    @Ctx() ctx: AccessContext,
    @idParam() id: string,
    @ZodBody(stockReceiptSchema) body: StockReceiptInput,
    @Req() req: Request,
  ): Promise<ProductDto> {
    return this.products.addStock(ctx, id, body, requestMeta(req));
  }

  @Patch(':id/status')
  @RequirePermissions(Permission.PRODUCTS_MANAGE)
  @ApiOperation({ summary: 'Faollashtirish / arxivlash (INACTIVE)' })
  @ApiErrorResponses(ErrorCode.VALIDATION_ERROR, ErrorCode.NOT_FOUND)
  setStatus(
    @Ctx() ctx: AccessContext,
    @idParam() id: string,
    @ZodBody(productStatusSchema) body: ProductStatusInput,
    @Req() req: Request,
  ): Promise<ProductDto> {
    return this.products.setStatus(ctx, id, body.status, requestMeta(req));
  }
}
