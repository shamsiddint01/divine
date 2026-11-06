import { Injectable } from '@nestjs/common';
import {
  buildPaginationMeta,
  ErrorCode,
  type FinanceSummaryDto,
  type IncomingReportDetailDto,
  inclusiveDays,
  Permission,
  REPORT_DEFINITIONS,
  REPORT_MAX_DAYS,
  type ReportResponse,
  type ReportType,
  VALIDATION_MESSAGES_UZ as M,
  visibleReportParts,
} from '@divine/shared';
import { type AccessContext, hasPermission } from '../../common/auth/access-context.js';
import { AppError } from '../../common/errors/app-error.js';
import { type ReportQuery, ReportsRepository } from './reports.repository.js';

/**
 * Hisobotlar (Phase 12, API §13, REQ-110, REQ-111, D-21). Ruxsat — `reports.read` (controller).
 * Tannarx va undan hisoblanadiganlar (foyda, ombor tannarxi, kirim summasi) — faqat `products.read_cost`:
 * aks holda ustun, qiymat, yig'ma va shu ustun bo'yicha saralash yo'q (OWN-06). Sana filtri bor
 * hisobotlarda oraliq majburiy va ≤ 366 kun (D-21).
 */
@Injectable()
export class ReportsService {
  constructor(private readonly repository: ReportsRepository) {}

  async run(ctx: AccessContext, type: ReportType, query: ReportQuery): Promise<ReportResponse> {
    const definition = REPORT_DEFINITIONS[type];
    const canReadCost = hasPermission(ctx, Permission.PRODUCTS_READ_COST);
    const { columns, summary: summaryDefs } = visibleReportParts(definition, canReadCost);
    if (!columns.some((c) => c.key === query.sort.field)) {
      throw validation('sort', M.invalidSort);
    }
    const q = definition.dated
      ? { ...query, ...assertRange(query) }
      : { ...query, dateFrom: undefined, dateTo: undefined };
    const result = await this.repository.run(
      type,
      q,
      columns,
      summaryDefs,
      Boolean(definition.grouped),
    );
    return {
      columns,
      data: result.rows,
      meta: buildPaginationMeta(q.page, q.pageSize, result.total),
      summary: summaryDefs.map((d) => ({
        labelKey: d.labelKey,
        kind: d.kind,
        value: result.summary[d.labelKey] ?? '0',
      })),
      ...(result.groups ? { groups: result.groups } : {}),
    };
  }

  /** Kirim hisoboti qatorining tafsiloti. Narx va summa — faqat `products.read_cost` (OWN-06). */
  async incomingDetail(ctx: AccessContext, number: string): Promise<IncomingReportDetailDto> {
    const digits = /^K-(\d{1,18})$/.exec(number)?.[1];
    const row = digits ? await this.repository.incomingDetail(BigInt(digits)) : null;
    if (!row) throw new AppError(ErrorCode.NOT_FOUND);
    if (hasPermission(ctx, Permission.PRODUCTS_READ_COST)) return row;
    const { totalAmount: _amount, items, ...rest } = row;
    return {
      ...rest,
      items: items.map(({ costPrice: _cost, lineTotal: _total, ...item }) => item),
    };
  }

  async finance(
    ctx: AccessContext,
    query: { dateFrom?: string; dateTo?: string; warehouseId?: string },
  ): Promise<FinanceSummaryDto> {
    const range = assertRange(query);
    const row = await this.repository.finance({ ...range, warehouseId: query.warehouseId });
    const perWarehouse = Boolean(query.warehouseId);
    const base: FinanceSummaryDto = {
      period: range,
      warehouseId: query.warehouseId ?? null,
      salesCount: row.salesCount,
      revenue: row.revenue,
      // D-21: xarajatlar omborga bog'lanmagan — ombor tanlansa hisoblanmaydi.
      expenses: perWarehouse ? null : row.expenses,
    };
    if (!hasPermission(ctx, Permission.PRODUCTS_READ_COST)) return base;
    return {
      ...base,
      costOfGoodsSold: row.costOfGoodsSold,
      grossProfit: row.grossProfit,
      netProfit: perWarehouse ? null : row.netProfit,
      incomingPurchases: row.incomingPurchases,
      inventoryValueAtCost: row.inventoryValueAtCost,
    };
  }
}

function assertRange(query: { dateFrom?: string; dateTo?: string }): {
  dateFrom: string;
  dateTo: string;
} {
  if (!query.dateFrom || !query.dateTo) {
    throw new AppError(ErrorCode.VALIDATION_ERROR, {
      details: [
        ...(query.dateFrom ? [] : [{ field: 'dateFrom', message: M.reportDateRequired }]),
        ...(query.dateTo ? [] : [{ field: 'dateTo', message: M.reportDateRequired }]),
      ],
    });
  }
  if (inclusiveDays(query.dateFrom, query.dateTo) > REPORT_MAX_DAYS) {
    throw validation('dateTo', M.reportRangeTooLong(REPORT_MAX_DAYS));
  }
  return { dateFrom: query.dateFrom, dateTo: query.dateTo };
}

function validation(field: string, message: string): AppError {
  return new AppError(ErrorCode.VALIDATION_ERROR, { details: [{ field, message }] });
}
