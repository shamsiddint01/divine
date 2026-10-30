import { describe, expect, it } from 'vitest';
import { settingsUpdateSchema } from '../validation/settings.js';
import {
  inclusiveDays,
  REPORT_DEFINITIONS,
  REPORT_PATHS,
  REPORT_TYPES,
  reportTypeByPath,
  visibleReportParts,
} from './index.js';

describe('hisobot ta’riflari (API §13, REQ-110)', () => {
  it('8 ta hisobot, har biri noyob yo‘l bilan; standart saralash — ko‘rinadigan (tannarxsiz) ustun', () => {
    expect(REPORT_TYPES).toHaveLength(8);
    expect(new Set(Object.values(REPORT_PATHS)).size).toBe(8);
    for (const type of REPORT_TYPES) {
      const definition = REPORT_DEFINITIONS[type];
      expect(reportTypeByPath(REPORT_PATHS[type])).toBe(type);
      const [field] = definition.defaultSort.split(':');
      const column = definition.columns.find((c) => c.key === field);
      expect(column, type).toBeDefined();
      expect(column?.cost, type).toBeUndefined();
      expect(definition.filters.includes('status')).toBe(Boolean(definition.statuses?.length));
    }
    expect(reportTypeByPath('finance-summary')).toBeUndefined();
  });

  it('tannarx belgisi: foyda, tannarx, ombor tannarxi, kirim summasi — ruxsatsiz ko‘rinmaydi', () => {
    const hidden = (type: (typeof REPORT_TYPES)[number]) =>
      REPORT_DEFINITIONS[type].columns.filter((c) => c.cost).map((c) => c.key);
    expect(hidden('sales')).toEqual(['cost', 'profit']);
    expect(hidden('warehouse')).toEqual(['stockValue']);
    expect(hidden('incoming')).toEqual(['amount']);
    expect(hidden('expenses')).toEqual([]);
    const parts = visibleReportParts(REPORT_DEFINITIONS.sales, false);
    expect(parts.columns.map((c) => c.key)).not.toContain('profit');
    expect(parts.summary.map((s) => s.labelKey)).toEqual(['count', 'revenue']);
    expect(visibleReportParts(REPORT_DEFINITIONS.sales, true).summary).toHaveLength(4);
  });

  it('sana oralig‘i kunlari (ikkala chegara ham kiradi), kabisa yili bilan', () => {
    expect(inclusiveDays('2026-10-01', '2026-10-01')).toBe(1);
    expect(inclusiveDays('2025-01-01', '2026-01-01')).toBe(366);
    expect(inclusiveDays('2028-01-01', '2028-12-31')).toBe(366);
  });
});

describe('sozlamalar sxemasi (API §16, D-21)', () => {
  it('faqat 3 ta maydon, qisman; chegara ≥ 0 va ≤ 3 kasr', () => {
    expect(settingsUpdateSchema.parse({ lowStockDefaultThreshold: ' 0 ' })).toEqual({
      lowStockDefaultThreshold: '0',
    });
    for (const body of [
      {},
      { legalName: 'MChJ' },
      { defaultWarehouseId: null },
      { lowStockDefaultThreshold: '-1' },
      { lowStockDefaultThreshold: '1.2345' },
      { currencyLabel: '' },
    ]) {
      expect(settingsUpdateSchema.safeParse(body).success).toBe(false);
    }
  });
});
