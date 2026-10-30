import { Permission, REPORT_DEFINITIONS, REPORT_TYPES } from '@divine/shared';
import { describe, expect, it, vi } from 'vitest';
import type { AccessContext } from '../../../src/common/auth/access-context.js';
import type { ReportQuery } from '../../../src/modules/reports/reports.repository.js';
import { ReportsService } from '../../../src/modules/reports/reports.service.js';

const ctx = (permissions: Permission[]) =>
  ({ userId: 'u', permissions: new Set(permissions) }) as unknown as AccessContext;
const withoutCost = ctx([Permission.REPORTS_READ]);
const withCost = ctx([Permission.REPORTS_READ, Permission.PRODUCTS_READ_COST]);

function serviceWith() {
  const run = vi.fn().mockResolvedValue({ rows: [], total: 0, summary: {} });
  const finance = vi.fn().mockResolvedValue({
    salesCount: 1,
    revenue: '100.00',
    costOfGoodsSold: '60.00',
    grossProfit: '40.00',
    expenses: '10.00',
    netProfit: '30.00',
    incomingPurchases: '500.00',
    inventoryValueAtCost: '900.00',
  });
  return { service: new ReportsService({ run, finance } as never), run, finance };
}

const query = (sort: string, extra: Partial<ReportQuery> = {}): ReportQuery => {
  const [field, direction] = sort.split(':') as [string, 'asc' | 'desc'];
  return {
    page: 1,
    pageSize: 20,
    sort: { field, direction },
    dateFrom: '2026-10-01',
    dateTo: '2026-10-24',
    ...extra,
  };
};

describe('hisobotlarda tannarx faqat products.read_cost bilan (OWN-06)', () => {
  it.each(REPORT_TYPES)(
    '%s: tannarx/foyda ustunlari va yig‘malari SQL’ga ham so‘ralmaydi',
    async (type) => {
      const { service, run } = serviceWith();
      const definition = REPORT_DEFINITIONS[type];
      const visible = definition.columns.find((c) => !c.cost)!;
      const res = await service.run(withoutCost, type, query(`${visible.key}:asc`));
      const costKeys = definition.columns.filter((c) => c.cost).map((c) => c.key);
      expect(res.columns.map((c) => c.key)).toEqual(
        definition.columns.filter((c) => !c.cost).map((c) => c.key),
      );
      expect(res.columns.some((c) => 'cost' in c)).toBe(false);
      const [, , columns, summary] = run.mock.calls[0]!;
      const requested = columns.map((c: { key: string }) => c.key);
      for (const key of costKeys) expect(requested).not.toContain(key);
      expect(summary.some((s: { cost?: boolean }) => s.cost)).toBe(false);
    },
  );

  it('tannarx ustuni bo‘yicha saralash ruxsatsiz — 400; ruxsat bilan — o‘tadi', async () => {
    const { service } = serviceWith();
    await expect(service.run(withoutCost, 'sales', query('profit:desc'))).rejects.toMatchObject({
      code: 'VALIDATION_ERROR',
      details: [{ field: 'sort' }],
    });
    await expect(service.run(withCost, 'sales', query('profit:desc'))).resolves.toBeDefined();
  });

  it('moliyaviy xulosa: ruxsatsiz — faqat tushum va xarajat; ombor tanlansa xarajat/sof foyda null (D-21)', async () => {
    const { service } = serviceWith();
    expect(
      await service.finance(withoutCost, { dateFrom: '2026-10-01', dateTo: '2026-10-24' }),
    ).toEqual({
      period: { dateFrom: '2026-10-01', dateTo: '2026-10-24' },
      warehouseId: null,
      salesCount: 1,
      revenue: '100.00',
      expenses: '10.00',
    });
    expect(
      await service.finance(withCost, {
        dateFrom: '2026-10-01',
        dateTo: '2026-10-24',
        warehouseId: 'w',
      }),
    ).toMatchObject({
      expenses: null,
      netProfit: null,
      grossProfit: '40.00',
      inventoryValueAtCost: '900.00',
    });
  });

  it('sanasiz hisobot (ombor qoldig‘i) sana parametrlarini e’tiborsiz qoldiradi; sanali hisobot ularsiz — 400', async () => {
    const { service, run } = serviceWith();
    await service.run(
      withCost,
      'warehouse',
      query('stock:desc', { dateFrom: undefined, dateTo: undefined }),
    );
    expect(run.mock.calls[0]![1]).toMatchObject({ dateFrom: undefined, dateTo: undefined });
    await expect(
      service.run(withCost, 'sales', query('soldAt:desc', { dateFrom: undefined })),
    ).rejects.toMatchObject({ details: [{ field: 'dateFrom' }] });
  });
});
