import { Injectable } from '@nestjs/common';
import type {
  DashboardSummaryDto,
  MyDashboardSummaryDto,
  SalesTrendPoint,
  TopProductDto,
} from '@divine/shared';
import { type AccessContext, warehouseScope } from '../../common/auth/access-context.js';
import { Clock } from '../../common/time/clock.js';
import {
  nextDate,
  tashkentDayRange,
  tashkentToday,
  zonedDayStart,
} from '../../common/time/tashkent-time.js';
import { DashboardRepository, type Range } from './dashboard.repository.js';

/** `date`dan `days` kun oldingi sana (`days = 0` — o'zi). */
function minusDays(date: string, days: number): string {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() - days);
  return d.toISOString().slice(0, 10);
}

const dayRange = (date: string): Range => {
  const { start, end } = tashkentDayRange(date);
  return { from: start, to: end };
};

/**
 * Dashboard (Phase 12, API §14, §18; REQ-030, REQ-031, AC-24, D-21). "Bugun" — serverning `Clock`i
 * bo'yicha Toshkent kuni. Tannarx va foyda dashboard'da yo'q.
 */
@Injectable()
export class DashboardService {
  constructor(
    private readonly repository: DashboardRepository,
    private readonly clock: Clock,
  ) {}

  async summary(): Promise<DashboardSummaryDto> {
    const now = this.clock.now();
    const today = tashkentToday(now);
    const data = await this.repository.summary(dayRange(today), dayRange(minusDays(today, 1)));
    return { asOf: now.toISOString(), businessDate: today, ...data };
  }

  trend(days: number): Promise<SalesTrendPoint[]> {
    const today = tashkentToday(this.clock.now());
    const first = minusDays(today, days - 1);
    return this.repository.trend(first, today, this.period(first, today));
  }

  top(days: number, limit: number): Promise<TopProductDto[]> {
    const today = tashkentToday(this.clock.now());
    return this.repository.top(this.period(minusDays(today, days - 1), today), limit);
  }

  async mySummary(ctx: AccessContext): Promise<MyDashboardSummaryDto> {
    const today = tashkentToday(this.clock.now());
    const { totals, warehouses } = await this.repository.mySummary(
      dayRange(today),
      ctx.userId,
      warehouseScope(ctx),
    );
    return {
      businessDate: today,
      today: {
        salesCount: totals.count,
        soldQuantity: totals.quantity,
        salesAmount: totals.amount,
      },
      warehouses,
    };
  }

  /** `[first 00:00, last+1 00:00)` Toshkent. */
  private period(first: string, last: string): Range {
    return { from: zonedDayStart(first), to: zonedDayStart(nextDate(last)) };
  }
}
