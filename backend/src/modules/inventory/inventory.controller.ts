import { Controller, Get, Req } from '@nestjs/common';
import { ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import {
  ErrorCode,
  type MovementDto,
  type Paginated,
  Permission,
  type ReconciliationResult,
} from '@divine/shared';
import type { Request } from 'express';
import type { AccessContext } from '../../common/auth/access-context.js';
import { Ctx, RequirePermissions } from '../../common/auth/auth.decorators.js';
import { createListQuerySchema, listFilters } from '../../common/query/list-query.js';
import { ApiErrorResponses } from '../../common/swagger/api-schemas.js';
import { ZodQuery } from '../../common/validation/zod-validation.pipe.js';
import { requestMeta } from '../auth/auth.http.js';
import type { MovementFilter } from './inventory.repository.js';
import { InventoryService } from './inventory.service.js';

const MOVEMENT_KINDS = ['INCOMING', 'SALE'] as const;

/** Harakatlar filtri — `/inventory/movements` va `/warehouses/:id/movements` uchun umumiy. */
export const movementFilters = {
  search: listFilters.search(),
  productId: listFilters.id(),
  userId: listFilters.id(),
  movementType: listFilters.oneOf(MOVEMENT_KINDS),
  referenceType: listFilters.oneOf(MOVEMENT_KINDS),
  ...listFilters.dateRange(),
};

const listMovementsQuerySchema = createListQuerySchema({
  sortFields: ['createdAt'],
  defaultSort: { field: 'createdAt', direction: 'desc' },
  filters: { ...movementFilters, warehouseId: listFilters.id() },
});

/** Inventar (Phase 7, API §8): ledger va reconciliation — faqat ADMIN permission'lari. */
@ApiTags('Inventory')
@Controller('inventory')
export class InventoryController {
  constructor(private readonly inventory: InventoryService) {}

  @Get('movements')
  @RequirePermissions(Permission.INVENTORY_READ)
  @ApiOperation({ summary: 'Inventar harakatlari (o‘zgarmas ledger)' })
  @ApiOkResponse({ description: 'Paginated<MovementDto>' })
  @ApiErrorResponses(ErrorCode.VALIDATION_ERROR, ErrorCode.FORBIDDEN)
  movements(
    @Ctx() ctx: AccessContext,
    @ZodQuery(listMovementsQuerySchema) query: Omit<MovementFilter, 'scope'>,
  ): Promise<Paginated<MovementDto>> {
    return this.inventory.listMovements(ctx, query);
  }

  @Get('reconciliation')
  @RequirePermissions(Permission.INVENTORY_RECONCILE)
  @ApiOperation({ summary: 'Qoldiq va ledger solishtiruvi (faqat o‘qiydi, audit qilinadi)' })
  @ApiOkResponse({ description: 'ReconciliationResult' })
  @ApiErrorResponses(ErrorCode.FORBIDDEN)
  reconciliation(@Ctx() ctx: AccessContext, @Req() req: Request): Promise<ReconciliationResult> {
    return this.inventory.reconcile(ctx.userId, 'api', requestMeta(req));
  }
}
