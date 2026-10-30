import { Controller, Get, HttpCode, Patch, Post, Req } from '@nestjs/common';
import { ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import {
  ErrorCode,
  INCOMING_STATUSES,
  type IncomingCreateInput,
  incomingCreateSchema,
  type IncomingDto,
  type IncomingUpdateInput,
  incomingUpdateSchema,
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
import type { ListIncomingQuery } from './incoming.repository.js';
import { IncomingService } from './incoming.service.js';

const listIncomingQuerySchema = createListQuerySchema({
  sortFields: ['date', 'createdAt', 'totalQuantity', 'totalAmount'],
  defaultSort: { field: 'date', direction: 'desc' },
  filters: {
    search: listFilters.search(),
    status: listFilters.oneOf(INCOMING_STATUSES),
    warehouseId: listFilters.id(),
    productId: listFilters.id(),
    createdBy: listFilters.id(),
    ...listFilters.dateRange(),
  },
});

const idParam = () => ZodParam('id', uuidSchema);

/**
 * Kirim (Phase 8, API §9). O'qish — `incoming.read`; qoralama yaratish, tahrirlash, bekor qilish —
 * `incoming.manage`; tasdiqlash (qoldiq ↑) — `incoming.confirm`. Ombor doirasi va kelgan narxi —
 * service'da (`warehouseScope`, `products.read_cost`).
 */
@ApiTags('Incoming')
@Controller('incoming')
export class IncomingController {
  constructor(private readonly incoming: IncomingService) {}

  @Get()
  @RequirePermissions(Permission.INCOMING_READ)
  @ApiOperation({ summary: 'Kirimlar ro‘yxati (qidiruv, filtrlar, saralash, pagination)' })
  @ApiOkResponse({ description: 'Paginated<IncomingDto> (qatorlarsiz)' })
  @ApiErrorResponses(ErrorCode.VALIDATION_ERROR, ErrorCode.FORBIDDEN)
  list(
    @Ctx() ctx: AccessContext,
    @ZodQuery(listIncomingQuerySchema) query: ListIncomingQuery,
  ): Promise<Paginated<IncomingDto>> {
    return this.incoming.list(ctx, query);
  }

  @Get(':id')
  @RequirePermissions(Permission.INCOMING_READ)
  @ApiOperation({ summary: 'Kirim hujjati (qatorlar bilan)' })
  @ApiErrorResponses(ErrorCode.NOT_FOUND, ErrorCode.FORBIDDEN)
  get(@Ctx() ctx: AccessContext, @idParam() id: string): Promise<IncomingDto> {
    return this.incoming.get(ctx, id);
  }

  @Post()
  @RequirePermissions(Permission.INCOMING_MANAGE)
  @ApiOperation({ summary: 'Qoralama kirim yaratish (totallarni server hisoblaydi)' })
  @ApiErrorResponses(
    ErrorCode.VALIDATION_ERROR,
    ErrorCode.NOT_FOUND,
    ErrorCode.WAREHOUSE_INACTIVE,
    ErrorCode.PRODUCT_INACTIVE,
    ErrorCode.INVALID_QUANTITY,
  )
  create(
    @Ctx() ctx: AccessContext,
    @ZodBody(incomingCreateSchema) body: IncomingCreateInput,
    @Req() req: Request,
  ): Promise<IncomingDto> {
    return this.incoming.create(ctx, body, requestMeta(req));
  }

  @Patch(':id')
  @RequirePermissions(Permission.INCOMING_MANAGE)
  @ApiOperation({ summary: 'Qoralamani tahrirlash (`items` berilsa — to‘liq almashtiriladi)' })
  @ApiErrorResponses(ErrorCode.VALIDATION_ERROR, ErrorCode.NOT_FOUND, ErrorCode.INCOMING_NOT_DRAFT)
  update(
    @Ctx() ctx: AccessContext,
    @idParam() id: string,
    @ZodBody(incomingUpdateSchema) body: IncomingUpdateInput,
    @Req() req: Request,
  ): Promise<IncomingDto> {
    return this.incoming.update(ctx, id, body, requestMeta(req));
  }

  @Post(':id/confirm')
  @HttpCode(200)
  @RequirePermissions(Permission.INCOMING_CONFIRM)
  @ApiOperation({ summary: 'Tasdiqlash: qoldiq ↑ va ledger (atomic, takroriy so‘rov — 409)' })
  @ApiErrorResponses(
    ErrorCode.NOT_FOUND,
    ErrorCode.INCOMING_NOT_DRAFT,
    ErrorCode.INCOMING_EMPTY,
    ErrorCode.PRODUCT_INACTIVE,
    ErrorCode.WAREHOUSE_INACTIVE,
  )
  confirm(
    @Ctx() ctx: AccessContext,
    @idParam() id: string,
    @Req() req: Request,
  ): Promise<IncomingDto> {
    return this.incoming.confirm(ctx, id, requestMeta(req));
  }

  @Post(':id/cancel')
  @HttpCode(200)
  @RequirePermissions(Permission.INCOMING_MANAGE)
  @ApiOperation({ summary: 'Qoralamani bekor qilish' })
  @ApiErrorResponses(ErrorCode.NOT_FOUND, ErrorCode.INCOMING_NOT_DRAFT)
  cancel(
    @Ctx() ctx: AccessContext,
    @idParam() id: string,
    @Req() req: Request,
  ): Promise<IncomingDto> {
    return this.incoming.cancel(ctx, id, requestMeta(req));
  }
}
