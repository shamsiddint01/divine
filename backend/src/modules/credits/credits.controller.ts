import { Controller, Get, Post, Req } from '@nestjs/common';
import { ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import {
  type CreditCreateInput,
  creditCreateSchema,
  type CreditDetailDto,
  type CreditPaymentInput,
  creditPaymentSchema,
  type CreditReminderDto,
  type CreditsListResponse,
  ErrorCode,
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
import { CreditsService, type ListCreditsQuery } from './credits.service.js';

const listCreditsQuerySchema = createListQuerySchema({
  sortFields: ['next', 'takenAt', 'remainingAmount'],
  defaultSort: { field: 'next', direction: 'asc' },
  filters: {
    search: listFilters.search(),
    status: listFilters.oneOf(['ACTIVE', 'OVERDUE', 'PAID'] as const),
  },
});

const idParam = () => ZodParam('id', uuidSchema);

/** Nasiya (D-24): barcha endpointlar faqat `credits.manage` (ADMIN) — sotuvchiga `403`. */
@ApiTags('Credits')
@Controller('credits')
export class CreditsController {
  constructor(private readonly credits: CreditsService) {}

  @Get()
  @RequirePermissions(Permission.CREDITS_MANAGE)
  @ApiOperation({ summary: 'Nasiyalar ro‘yxati va yig‘ma (qoldiq, muddati o‘tganlar)' })
  @ApiOkResponse({ description: 'CreditsListResponse' })
  @ApiErrorResponses(ErrorCode.VALIDATION_ERROR, ErrorCode.FORBIDDEN)
  list(@ZodQuery(listCreditsQuerySchema) query: ListCreditsQuery): Promise<CreditsListResponse> {
    return this.credits.list(query);
  }

  @Get('reminders')
  @RequirePermissions(Permission.CREDITS_MANAGE)
  @ApiOperation({ summary: 'Eslatmalar: ertaga to‘lovi borlar' })
  @ApiErrorResponses(ErrorCode.FORBIDDEN)
  reminders(): Promise<CreditReminderDto[]> {
    return this.credits.reminders();
  }

  @Get(':id')
  @RequirePermissions(Permission.CREDITS_MANAGE)
  @ApiOperation({ summary: 'Nasiya: to‘lov jadvali va to‘lovlar' })
  @ApiErrorResponses(ErrorCode.NOT_FOUND, ErrorCode.FORBIDDEN)
  get(@idParam() id: string): Promise<CreditDetailDto> {
    return this.credits.get(id);
  }

  @Post()
  @RequirePermissions(Permission.CREDITS_MANAGE)
  @ApiOperation({ summary: 'Nasiya qo‘shish (jadvalni server teng bo‘lib hisoblaydi)' })
  @ApiErrorResponses(ErrorCode.VALIDATION_ERROR, ErrorCode.FORBIDDEN)
  create(
    @Ctx() ctx: AccessContext,
    @ZodBody(creditCreateSchema) body: CreditCreateInput,
    @Req() req: Request,
  ): Promise<CreditDetailDto> {
    return this.credits.create(ctx, body, requestMeta(req));
  }

  @Post(':id/payments')
  @RequirePermissions(Permission.CREDITS_MANAGE)
  @ApiOperation({ summary: 'To‘lov yozish (yetmagani keyingisiga, ortig‘i keyingisidan)' })
  @ApiErrorResponses(
    ErrorCode.VALIDATION_ERROR,
    ErrorCode.NOT_FOUND,
    ErrorCode.CREDIT_OVERPAID,
    ErrorCode.FORBIDDEN,
  )
  addPayment(
    @Ctx() ctx: AccessContext,
    @idParam() id: string,
    @ZodBody(creditPaymentSchema) body: CreditPaymentInput,
    @Req() req: Request,
  ): Promise<CreditDetailDto> {
    return this.credits.addPayment(ctx, id, body, requestMeta(req));
  }
}
