import { Controller, Get } from '@nestjs/common';
import { ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import {
  type DashboardSummaryDto,
  ErrorCode,
  type MyDashboardSummaryDto,
  Permission,
  type SalesTrendPoint,
  type TopProductDto,
} from '@divine/shared';
import { z } from 'zod';
import type { AccessContext } from '../../common/auth/access-context.js';
import { Ctx, RequirePermissions } from '../../common/auth/auth.decorators.js';
import { ApiErrorResponses } from '../../common/swagger/api-schemas.js';
import { ZodQuery } from '../../common/validation/zod-validation.pipe.js';
import { DashboardService } from './dashboard.service.js';

/** API §18: grafik va top mahsulotlar davri — 7, 14 yoki 30 kun (standart 30). */
const daysSchema = z
  .enum(['7', '14', '30'])
  .optional()
  .transform((value) => Number(value ?? 30));

const trendQuerySchema = z.object({ days: daysSchema });
const topQuerySchema = z.object({
  days: daysSchema,
  limit: z.coerce.number().int().min(1).max(20).optional().default(5),
});

/**
 * Dashboard (Phase 12, API §14). Admin ko'rsatkichlari — `dashboard.admin`; sotuvchi — faqat o'zining
 * bugungi ko'rsatkichlari (`dashboard.own`, OWN-08).
 */
@ApiTags('Dashboard')
@Controller('dashboard')
export class DashboardController {
  constructor(private readonly dashboard: DashboardService) {}

  @Get('summary')
  @RequirePermissions(Permission.DASHBOARD_ADMIN)
  @ApiOperation({
    summary: 'Admin dashboard KPI’lari (bugun, kecha, jami, ombor, kam qoldiq, userlar)',
  })
  @ApiOkResponse({ description: 'DashboardSummaryDto' })
  @ApiErrorResponses(ErrorCode.FORBIDDEN)
  summary(): Promise<DashboardSummaryDto> {
    return this.dashboard.summary();
  }

  @Get('sales-trend')
  @RequirePermissions(Permission.DASHBOARD_ADMIN)
  @ApiOperation({ summary: 'Kunlik savdo grafigi (7/14/30 kun, Toshkent kunlari)' })
  @ApiErrorResponses(ErrorCode.VALIDATION_ERROR, ErrorCode.FORBIDDEN)
  trend(@ZodQuery(trendQuerySchema) query: { days: number }): Promise<SalesTrendPoint[]> {
    return this.dashboard.trend(query.days);
  }

  @Get('top-products')
  @RequirePermissions(Permission.DASHBOARD_ADMIN)
  @ApiOperation({ summary: 'Eng ko‘p sotilgan mahsulotlar (summa bo‘yicha)' })
  @ApiErrorResponses(ErrorCode.VALIDATION_ERROR, ErrorCode.FORBIDDEN)
  top(@ZodQuery(topQuerySchema) query: { days: number; limit: number }): Promise<TopProductDto[]> {
    return this.dashboard.top(query.days, query.limit);
  }

  @Get('my-summary')
  @RequirePermissions(Permission.DASHBOARD_OWN)
  @ApiOperation({ summary: 'O‘zining bugungi sotuv ko‘rsatkichlari va omborlari' })
  @ApiOkResponse({ description: 'MyDashboardSummaryDto' })
  @ApiErrorResponses(ErrorCode.FORBIDDEN)
  mySummary(@Ctx() ctx: AccessContext): Promise<MyDashboardSummaryDto> {
    return this.dashboard.mySummary(ctx);
  }
}
