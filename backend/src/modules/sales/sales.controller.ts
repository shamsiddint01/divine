import { Controller, Get, Headers, Post, Req, Res } from '@nestjs/common';
import { ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import {
  ErrorCode,
  IDEMPOTENCY_HEADER,
  idempotencyKeySchema,
  Permission,
  type SaleCreateInput,
  saleCreateSchema,
  type SaleDto,
  type SalesListResponse,
  uuidSchema,
  VALIDATION_MESSAGES_UZ,
} from '@divine/shared';
import type { Request, Response } from 'express';
import type { AccessContext } from '../../common/auth/access-context.js';
import {
  Ctx,
  RequireAnyPermission,
  RequirePermissions,
} from '../../common/auth/auth.decorators.js';
import { AppError } from '../../common/errors/app-error.js';
import { createListQuerySchema, listFilters } from '../../common/query/list-query.js';
import { ApiErrorResponses } from '../../common/swagger/api-schemas.js';
import { ZodBody, ZodParam, ZodQuery } from '../../common/validation/zod-validation.pipe.js';
import { requestMeta } from '../auth/auth.http.js';
import type { SaleFilter, SalePage } from './sales.repository.js';
import { SalesService } from './sales.service.js';

const listSalesQuerySchema = createListQuerySchema({
  sortFields: ['soldAt', 'totalAmount', 'number'],
  defaultSort: { field: 'soldAt', direction: 'desc' },
  filters: {
    search: listFilters.search(),
    userId: listFilters.id(),
    warehouseId: listFilters.id(),
    customerId: listFilters.id(),
    productId: listFilters.id(),
    ...listFilters.dateRange(),
  },
});

/** `Idempotency-Key` header: yo'q → `400 IDEMPOTENCY_KEY_REQUIRED`; UUID emas → `400 VALIDATION_ERROR`. */
function parseIdempotencyKey(value: string | undefined): string {
  if (!value?.trim()) throw new AppError(ErrorCode.IDEMPOTENCY_KEY_REQUIRED);
  const parsed = idempotencyKeySchema.safeParse(value.trim());
  if (!parsed.success) {
    throw new AppError(ErrorCode.VALIDATION_ERROR, {
      details: [
        { field: IDEMPOTENCY_HEADER, message: VALIDATION_MESSAGES_UZ.idempotencyKeyFormat },
      ],
    });
  }
  return parsed.data;
}

/**
 * Sotuvlar (Phase 10, API §11). Yaratish — `sales.create` (+ ombor ownership, OWN-02); o'qish —
 * `sales.read_all` yoki `sales.read_own` (USER — faqat o'ziniki, OWN-04/05).
 */
@ApiTags('Sales')
@Controller('sales')
export class SalesController {
  constructor(private readonly sales: SalesService) {}

  @Post()
  @RequirePermissions(Permission.SALES_CREATE)
  @ApiOperation({ summary: 'Sotuv yaratish (atomic, idempotent; narx serverda)' })
  @ApiOkResponse({ description: '201 — yangi sotuv; 200 — shu kalit bilan avval yaratilgan sotuv' })
  @ApiErrorResponses(
    ErrorCode.VALIDATION_ERROR,
    ErrorCode.IDEMPOTENCY_KEY_REQUIRED,
    ErrorCode.IDEMPOTENCY_KEY_REUSED,
    ErrorCode.INSUFFICIENT_STOCK,
    ErrorCode.WAREHOUSE_ACCESS_DENIED,
    ErrorCode.WAREHOUSE_INACTIVE,
    ErrorCode.PRODUCT_INACTIVE,
    ErrorCode.INVALID_QUANTITY,
    ErrorCode.NOT_FOUND,
  )
  async create(
    @Ctx() ctx: AccessContext,
    @Headers('idempotency-key') idempotencyKey: string | undefined,
    @ZodBody(saleCreateSchema) body: SaleCreateInput,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ): Promise<SaleDto> {
    const key = parseIdempotencyKey(idempotencyKey);
    const { sale, created } = await this.sales.create(ctx, key, body, requestMeta(req));
    res.status(created ? 201 : 200);
    return sale;
  }

  @Get()
  @RequireAnyPermission(Permission.SALES_READ_ALL, Permission.SALES_READ_OWN)
  @ApiOperation({ summary: 'Sotuvlar ro‘yxati (filtrlar + yig‘ma)' })
  @ApiOkResponse({ description: 'SalesListResponse' })
  @ApiErrorResponses(ErrorCode.VALIDATION_ERROR, ErrorCode.FORBIDDEN)
  list(
    @Ctx() ctx: AccessContext,
    @ZodQuery(listSalesQuerySchema) query: SaleFilter & SalePage,
  ): Promise<SalesListResponse> {
    const { page, pageSize, sort, ...filter } = query;
    return this.sales.list(ctx, filter, { page, pageSize, sort });
  }

  @Get(':id')
  @RequireAnyPermission(Permission.SALES_READ_ALL, Permission.SALES_READ_OWN)
  @ApiOperation({ summary: 'Sotuv (qatorlar bilan)' })
  @ApiErrorResponses(ErrorCode.NOT_FOUND, ErrorCode.FORBIDDEN)
  get(@Ctx() ctx: AccessContext, @ZodParam('id', uuidSchema) id: string): Promise<SaleDto> {
    return this.sales.get(ctx, id);
  }
}
