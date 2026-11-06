import { Controller, Get, Param } from '@nestjs/common';
import { ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import {
  ErrorCode,
  type FinanceSummaryDto,
  type IncomingReportDetailDto,
  Permission,
  REPORT_DEFINITIONS,
  type ReportResponse,
  type ReportType,
  VALIDATION_MESSAGES_UZ,
} from '@divine/shared';
import { z } from 'zod';
import type { AccessContext } from '../../common/auth/access-context.js';
import { Ctx, RequirePermissions } from '../../common/auth/auth.decorators.js';
import { createListQuerySchema, listFilters } from '../../common/query/list-query.js';
import { ApiErrorResponses } from '../../common/swagger/api-schemas.js';
import { ZodQuery } from '../../common/validation/zod-validation.pipe.js';
import type { ReportQuery } from './reports.repository.js';
import { ReportsService } from './reports.service.js';

/** `ReportDefinition` dan query sxemasi: faqat shu hisobot filtrlari, saralash — uning ustunlari. */
function reportQuerySchema(type: ReportType) {
  const definition = REPORT_DEFINITIONS[type];
  const filters: Record<string, z.ZodType> = {};
  for (const filter of definition.filters) {
    if (filter === 'status') {
      filters.status = listFilters.oneOf(definition.statuses as [string, ...string[]]);
    } else if (filter === 'search') {
      filters.search = listFilters.search();
    } else {
      filters[filter] = listFilters.id();
    }
  }
  const [field, direction] = definition.defaultSort.split(':') as [string, 'asc' | 'desc'];
  return createListQuerySchema({
    sortFields: definition.columns.map((c) => c.key) as [string, ...string[]],
    defaultSort: { field, direction },
    filters: { ...filters, ...(definition.dated ? listFilters.dateRange() : {}) },
  });
}

const financeQuerySchema = z
  .object({ ...listFilters.dateRange(), warehouseId: listFilters.id() })
  .refine((q) => !q.dateFrom || !q.dateTo || q.dateFrom <= q.dateTo, {
    path: ['dateTo'],
    message: VALIDATION_MESSAGES_UZ.dateRangeOrder,
  });

const ERRORS = [ErrorCode.VALIDATION_ERROR, ErrorCode.FORBIDDEN] as const;

/**
 * Hisobotlar (Phase 12, API §13). Barchasi `reports.read` (USER'da yo'q — `403`). Javob: yagona shakl
 * `{ columns, data, meta, summary, groups? }`; `finance-summary` — alohida obyekt.
 */
@ApiTags('Reports')
@Controller('reports')
export class ReportsController {
  constructor(private readonly reports: ReportsService) {}

  @Get('finance-summary')
  @RequirePermissions(Permission.REPORTS_READ)
  @ApiOperation({
    summary: 'Moliyaviy xulosa: tushum, tannarx, foyda, xarajat, kirim, ombor qiymati',
  })
  @ApiOkResponse({ description: 'FinanceSummaryDto' })
  @ApiErrorResponses(...ERRORS)
  finance(
    @Ctx() ctx: AccessContext,
    @ZodQuery(financeQuerySchema) query: z.infer<typeof financeQuerySchema>,
  ): Promise<FinanceSummaryDto> {
    return this.reports.finance(ctx, query);
  }

  @Get('sales')
  @RequirePermissions(Permission.REPORTS_READ)
  @ApiOperation({ summary: 'Sotuvlar hisoboti' })
  @ApiErrorResponses(...ERRORS)
  sales(
    @Ctx() ctx: AccessContext,
    @ZodQuery(reportQuerySchema('sales')) q: ReportQuery,
  ): Promise<ReportResponse> {
    return this.reports.run(ctx, 'sales', q);
  }

  @Get('products')
  @RequirePermissions(Permission.REPORTS_READ)
  @ApiOperation({ summary: 'Mahsulotlar hisoboti (sotilgan / sotilmagan)' })
  @ApiErrorResponses(...ERRORS)
  products(
    @Ctx() ctx: AccessContext,
    @ZodQuery(reportQuerySchema('products')) q: ReportQuery,
  ): Promise<ReportResponse> {
    return this.reports.run(ctx, 'products', q);
  }

  @Get('warehouse-stock')
  @RequirePermissions(Permission.REPORTS_READ)
  @ApiOperation({ summary: 'Ombor qoldig‘i hisoboti (joriy)' })
  @ApiErrorResponses(...ERRORS)
  warehouse(
    @Ctx() ctx: AccessContext,
    @ZodQuery(reportQuerySchema('warehouse')) q: ReportQuery,
  ): Promise<ReportResponse> {
    return this.reports.run(ctx, 'warehouse', q);
  }

  @Get('incoming')
  @RequirePermissions(Permission.REPORTS_READ)
  @ApiOperation({ summary: 'Kirimlar hisoboti' })
  @ApiErrorResponses(...ERRORS)
  incoming(
    @Ctx() ctx: AccessContext,
    @ZodQuery(reportQuerySchema('incoming')) q: ReportQuery,
  ): Promise<ReportResponse> {
    return this.reports.run(ctx, 'incoming', q);
  }

  @Get('incoming/:number')
  @RequirePermissions(Permission.REPORTS_READ)
  @ApiOperation({ summary: 'Kirim hujjatidagi mahsulotlar' })
  @ApiErrorResponses(ErrorCode.FORBIDDEN, ErrorCode.NOT_FOUND)
  incomingDetail(
    @Ctx() ctx: AccessContext,
    @Param('number') number: string,
  ): Promise<IncomingReportDetailDto> {
    return this.reports.incomingDetail(ctx, number);
  }

  @Get('expenses')
  @RequirePermissions(Permission.REPORTS_READ)
  @ApiOperation({ summary: 'Xarajatlar hisoboti (kategoriya bo‘yicha yig‘ma bilan)' })
  @ApiErrorResponses(...ERRORS)
  expenses(
    @Ctx() ctx: AccessContext,
    @ZodQuery(reportQuerySchema('expenses')) q: ReportQuery,
  ): Promise<ReportResponse> {
    return this.reports.run(ctx, 'expenses', q);
  }

  @Get('user-sales')
  @RequirePermissions(Permission.REPORTS_READ)
  @ApiOperation({ summary: 'User sotuvlari hisoboti' })
  @ApiErrorResponses(...ERRORS)
  userSales(
    @Ctx() ctx: AccessContext,
    @ZodQuery(reportQuerySchema('userSales')) q: ReportQuery,
  ): Promise<ReportResponse> {
    return this.reports.run(ctx, 'userSales', q);
  }

  @Get('product-sales')
  @RequirePermissions(Permission.REPORTS_READ)
  @ApiOperation({ summary: 'Mahsulot sotuvlari hisoboti' })
  @ApiErrorResponses(...ERRORS)
  productSales(
    @Ctx() ctx: AccessContext,
    @ZodQuery(reportQuerySchema('productSales')) q: ReportQuery,
  ): Promise<ReportResponse> {
    return this.reports.run(ctx, 'productSales', q);
  }

  @Get('customer-purchases')
  @RequirePermissions(Permission.REPORTS_READ)
  @ApiOperation({ summary: 'Mijoz xaridlari hisoboti' })
  @ApiErrorResponses(...ERRORS)
  customerPurchases(
    @Ctx() ctx: AccessContext,
    @ZodQuery(reportQuerySchema('customerPurchases')) q: ReportQuery,
  ): Promise<ReportResponse> {
    return this.reports.run(ctx, 'customerPurchases', q);
  }
}
