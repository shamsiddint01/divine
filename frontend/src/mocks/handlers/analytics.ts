import {
  type DashboardSummaryDto,
  type FinanceSummaryDto,
  type IncomingReportDetailDto,
  type MyDashboardSummaryDto,
  ProductUnit,
  REPORT_DEFINITIONS,
  REPORT_MAX_DAYS,
  type ReportDefinition,
  type ReportGroupItem,
  type ReportResponse,
  type ReportType,
  type SalesTrendPoint,
  type TopProductDto,
  VALIDATION_MESSAGES_UZ as M,
  buildPaginationMeta,
  createSortSchema,
  dateOnlySchema,
  inclusiveDays,
  paginationQuerySchema,
  reportTypeByPath,
  searchQuerySchema,
  uuidSchema,
  visibleReportParts,
} from '@divine/shared';
import { z } from '@/shared/forms/zod';
import {
  addQty,
  compareQty,
  divideMoney,
  lineTotal,
  subMoney,
  sumMoney,
  sumQty,
} from '@/shared/lib/decimal';
import { db } from '../db';
import { mockToday, nowIso } from '../lib/clock';
import { formatDocNumber, getStock, getTotalStock } from '../inventory';
import { fail, num, route, validate, type Query } from '../lib/http';
import { addDays, dateOnlyInRange, inDateRange, tashkentDate } from '../lib/time';
import { currentCan, thresholdOf, userRef } from '../mappers';
import type { MockState, SaleRow } from '../state';

// Backend bilan bir xil shartnoma (Phase 12, API §13, §14, §18, D-21): o'sha ruxsatlar, shared
// `REPORT_DEFINITIONS`, majburiy sana oralig'i (≤ 366 kun), tannarx ustunlari faqat `products.read_cost`.

function requireCan(permission: Parameters<typeof currentCan>[1]) {
  if (!currentCan(db(), permission)) fail(403, 'FORBIDDEN');
}

const emptyToUndefined = (value: unknown) =>
  typeof value === 'string' && value.trim() === '' ? undefined : value;
const optionalId = z.preprocess(emptyToUndefined, uuidSchema.optional());
const dateRange = {
  dateFrom: z.preprocess(emptyToUndefined, dateOnlySchema.optional()),
  dateTo: z.preprocess(emptyToUndefined, dateOnlySchema.optional()),
};
const rangeOrder = (q: { dateFrom?: unknown; dateTo?: unknown }, ctx: z.RefinementCtx) => {
  if (typeof q.dateFrom === 'string' && typeof q.dateTo === 'string' && q.dateFrom > q.dateTo) {
    ctx.addIssue({ code: 'custom', path: ['dateTo'], message: M.dateRangeOrder });
  }
};

/** Backend `reportQuerySchema` aksi: faqat shu hisobot filtrlari, saralash — uning ustunlari. */
function reportQuerySchema(definition: ReportDefinition) {
  const filters: Record<string, z.ZodType> = {};
  for (const filter of definition.filters) {
    if (filter === 'status') {
      filters.status = z.preprocess(
        emptyToUndefined,
        z.enum(definition.statuses as [string, ...string[]]).optional(),
      );
    } else if (filter === 'search') {
      filters.search = searchQuerySchema;
    } else {
      filters[filter] = optionalId;
    }
  }
  const [field = '', direction] = definition.defaultSort.split(':') as [string, 'asc' | 'desc'];
  return paginationQuerySchema
    .extend({
      sort: createSortSchema(definition.columns.map((c) => c.key) as [string, ...string[]], {
        field,
        direction,
      }),
      ...filters,
      ...(definition.dated ? dateRange : {}),
    })
    .superRefine(rangeOrder);
}

interface ReportQuery {
  page: number;
  pageSize: number;
  sort: { field: string; direction: 'asc' | 'desc' };
  dateFrom?: string;
  dateTo?: string;
  productId?: string;
  userId?: string;
  warehouseId?: string;
  groupId?: string;
  customerId?: string;
  categoryId?: string;
  status?: string;
  search?: string;
}

function validationError(field: string, message: string): never {
  return fail(400, 'VALIDATION_ERROR', [{ field, message }]);
}

/** D-21: ikkala sana majburiy, oraliq ≤ 366 kun (backend `assertRange`). */
function assertRange(q: { dateFrom?: string; dateTo?: string }): {
  dateFrom: string;
  dateTo: string;
} {
  if (!q.dateFrom || !q.dateTo) {
    fail(400, 'VALIDATION_ERROR', [
      ...(q.dateFrom ? [] : [{ field: 'dateFrom', message: M.reportDateRequired }]),
      ...(q.dateTo ? [] : [{ field: 'dateTo', message: M.reportDateRequired }]),
    ]);
  }
  if (inclusiveDays(q.dateFrom, q.dateTo) > REPORT_MAX_DAYS) {
    validationError('dateTo', M.reportRangeTooLong(REPORT_MAX_DAYS));
  }
  return { dateFrom: q.dateFrom, dateTo: q.dateTo };
}

// ─── Dashboard ──────────────────────────────────────────────────────────────

const UNIT_ORDER = Object.values(ProductUnit);

function totals(sales: SaleRow[]) {
  return {
    soldQuantity: sumQty(sales.map((x) => x.totalQuantity)),
    salesAmount: sumMoney(sales.map((x) => x.totalAmount)),
    salesCount: sales.length,
  };
}

route('GET', '/dashboard/summary', (): DashboardSummaryDto => {
  requireCan('dashboard.admin');
  const s = db();
  const today = mockToday();
  const yesterday = addDays(today, -1);
  const todaySales = s.sales.filter((x) => tashkentDate(x.soldAt) === today);
  const yesterdaySales = s.sales.filter((x) => tashkentDate(x.soldAt) === yesterday);

  const byUnit = new Map<string, string>();
  const byProduct = new Map<string, string>();
  for (const [key, quantity] of Object.entries(s.stock)) {
    const productId = key.split('|')[1] ?? '';
    const unit = s.products.find((p) => p.id === productId)?.unit;
    if (!unit) continue;
    byUnit.set(unit, addQty(byUnit.get(unit) ?? '0', quantity));
    byProduct.set(productId, addQty(byProduct.get(productId) ?? '0', quantity));
  }
  // Kam qoldiq (BUSINESS-RULES §4, A-15): ACTIVE mahsulot, barcha omborlardagi jami ≤ chegara.
  const lowItems = s.products
    .filter((p) => p.status === 'ACTIVE')
    .map((p) => ({ p, stock: getTotalStock(s, p.id), threshold: sumQty([thresholdOf(s, p)]) }))
    .filter((x) => compareQty(x.stock, x.threshold) <= 0)
    .sort(
      (a, b) =>
        num(a.stock) / Math.max(num(a.threshold), 1) -
          num(b.stock) / Math.max(num(b.threshold), 1) ||
        a.p.name.localeCompare(b.p.name, 'uz') ||
        a.p.id.localeCompare(b.p.id),
    );
  return {
    asOf: nowIso(),
    businessDate: today,
    today: totals(todaySales),
    yesterday: { salesAmount: sumMoney(yesterdaySales.map((x) => x.totalAmount)) },
    allTime: totals(s.sales),
    warehouse: {
      totalQuantity: sumQty(Object.values(s.stock)),
      byUnit: UNIT_ORDER.filter((unit) => byUnit.has(unit)).map((unit) => ({
        unit,
        quantity: byUnit.get(unit) ?? '0.000',
      })),
      productCount: [...byProduct.values()].filter((q) => compareQty(q, '0') > 0).length,
    },
    lowStock: {
      count: lowItems.length,
      items: lowItems.slice(0, 6).map((x) => ({
        productId: x.p.id,
        name: x.p.name,
        unit: x.p.unit,
        stock: x.stock,
        threshold: x.threshold,
      })),
    },
    users: {
      active: s.users.filter((u) => u.status === 'ACTIVE').length,
      total: s.users.length,
      soldToday: new Set(todaySales.map((x) => x.userId)).size,
    },
  };
});

/** API §18: davr — 7, 14 yoki 30 kun (standart 30). */
const daysSchema = z
  .enum(['7', '14', '30'])
  .optional()
  .transform((value) => Number(value ?? 30));

route('GET', '/dashboard/sales-trend', ({ query }): SalesTrendPoint[] => {
  requireCan('dashboard.admin');
  const { days } = validate(z.object({ days: daysSchema }), query);
  const s = db();
  const today = mockToday();
  const byDay = new Map<string, SaleRow[]>();
  for (const sale of s.sales) {
    const day = tashkentDate(sale.soldAt);
    byDay.set(day, [...(byDay.get(day) ?? []), sale]);
  }
  return Array.from({ length: days }, (_, i) => {
    const date = addDays(today, i - days + 1);
    const list = byDay.get(date) ?? [];
    return { date, amount: sumMoney(list.map((x) => x.totalAmount)), count: list.length };
  });
});

route('GET', '/dashboard/top-products', ({ query }): TopProductDto[] => {
  requireCan('dashboard.admin');
  const { days, limit } = validate(
    z.object({
      days: daysSchema,
      limit: z.coerce.number().int().min(1).max(20).optional().default(5),
    }),
    query,
  );
  const s = db();
  const today = mockToday();
  const from = addDays(today, -(days - 1));
  const agg = new Map<string, { qty: string; amount: string }>();
  for (const sale of s.sales.filter((x) => inDateRange(x.soldAt, from, today))) {
    for (const i of sale.items) {
      const a = agg.get(i.productId) ?? { qty: '0', amount: '0' };
      agg.set(i.productId, {
        qty: addQty(a.qty, i.quantity),
        amount: sumMoney([a.amount, lineTotal(i.quantity, i.unitPrice)]),
      });
    }
  }
  return [...agg.entries()]
    .map(([productId, a]) => {
      const p = s.products.find((x) => x.id === productId);
      return {
        productId,
        name: p?.name ?? '—',
        unit: p?.unit ?? 'DONA',
        quantity: a.qty,
        amount: a.amount,
      };
    })
    .sort(
      (a, b) =>
        num(b.amount) - num(a.amount) ||
        num(b.quantity) - num(a.quantity) ||
        a.name.localeCompare(b.name, 'uz') ||
        a.productId.localeCompare(b.productId),
    )
    .slice(0, limit);
});

/** Sotuvchining bugungi ko'rsatkichlari (OWN-08) va unga ruxsat etilgan faol omborlar. */
route('GET', '/dashboard/my-summary', (): MyDashboardSummaryDto => {
  requireCan('dashboard.own');
  const s = db();
  const today = mockToday();
  const me = s.users.find((u) => u.id === s.currentUserId);
  const readAll = currentCan(s, 'warehouses.read_all');
  const own = s.sales.filter((x) => x.userId === me?.id && tashkentDate(x.soldAt) === today);
  return {
    businessDate: today,
    today: totals(own),
    warehouses: s.warehouses
      .filter((w) => w.status === 'ACTIVE' && (readAll || me?.warehouseIds.includes(w.id)))
      .sort((a, b) => a.name.toLowerCase().localeCompare(b.name.toLowerCase()))
      .map((w) => ({ id: w.id, name: w.name })),
  };
});

// ─── Hisobotlar ─────────────────────────────────────────────────────────────

/** `_k` — barqaror saralash kaliti (backenddagi kabi); javobga chiqmaydi. */
type Row = Record<string, string | number | null> & { _k: string };

interface ReportRows {
  rows: Row[];
  /** Yig'ma: `labelKey` → qiymat (butun filtr bo'yicha). */
  summary: (rows: Row[]) => Record<string, string>;
}

const userName = (s: MockState, id: string) => {
  const u = s.users.find((x) => x.id === id);
  return u ? (u.fullName ?? u.login) : '—';
};
const warehouseName = (s: MockState, id: string) =>
  s.warehouses.find((x) => x.id === id)?.name ?? '—';
const groupName = (s: MockState, id: string) => s.groups.find((x) => x.id === id)?.name ?? '—';
const money = (rows: Row[], key: string) => sumMoney(rows.map((r) => String(r[key] ?? '0')));
const qty = (rows: Row[], key: string) => sumQty(rows.map((r) => String(r[key] ?? '0')));

/** Backend `salesWhere`: sana (Toshkent kunlari), user, ombor, mijoz, mahsulot qatnashgan sotuvlar. */
function salesWhere(s: MockState, q: ReportQuery, opts: { productLines?: boolean } = {}) {
  return s.sales.filter(
    (x) =>
      inDateRange(x.soldAt, q.dateFrom, q.dateTo) &&
      (!q.userId || x.userId === q.userId) &&
      (!q.warehouseId || x.warehouseId === q.warehouseId) &&
      (!q.customerId || x.customerId === q.customerId) &&
      (!q.productId || opts.productLines || x.items.some((i) => i.productId === q.productId)),
  );
}

interface LineAgg {
  qty: string;
  revenue: string;
  cost: string;
}

function aggregateLines(sales: SaleRow[], keep: (productId: string) => boolean) {
  const agg = new Map<string, LineAgg>();
  for (const sale of sales) {
    for (const i of sale.items) {
      if (!keep(i.productId)) continue;
      const a = agg.get(i.productId) ?? { qty: '0', revenue: '0', cost: '0' };
      agg.set(i.productId, {
        qty: addQty(a.qty, i.quantity),
        revenue: sumMoney([a.revenue, lineTotal(i.quantity, i.unitPrice)]),
        cost: sumMoney([a.cost, lineTotal(i.quantity, i.unitCost)]),
      });
    }
  }
  return agg;
}

const BUILDERS: Record<ReportType, (s: MockState, q: ReportQuery) => ReportRows> = {
  sales: (s, q) => ({
    rows: salesWhere(s, q).map((x) => ({
      _k: x.id,
      soldAt: x.soldAt,
      number: formatDocNumber('S', x.number),
      customer: x.customerName,
      seller: userName(s, x.userId),
      warehouse: warehouseName(s, x.warehouseId),
      quantity: x.totalQuantity,
      revenue: x.totalAmount,
      cost: x.totalCost,
      profit: subMoney(x.totalAmount, x.totalCost),
    })),
    summary: (rows) => ({
      count: String(rows.length),
      revenue: money(rows, 'revenue'),
      cost: money(rows, 'cost'),
      profit: money(rows, 'profit'),
    }),
  }),

  products: (s, q) => {
    const sold = aggregateLines(salesWhere(s, { ...q, productId: undefined }), () => true);
    const received = new Map<string, string>();
    for (const m of s.movements) {
      if (m.type !== 'INCOMING' || !inDateRange(m.createdAt, q.dateFrom, q.dateTo)) continue;
      if (q.warehouseId && m.warehouseId !== q.warehouseId) continue;
      received.set(m.productId, addQty(received.get(m.productId) ?? '0', m.quantity));
    }
    const rows = s.products
      .filter(
        (p) => (!q.productId || p.id === q.productId) && (!q.groupId || p.groupId === q.groupId),
      )
      .map((p) => {
        const a = sold.get(p.id);
        return {
          _k: p.id,
          product: p.name,
          group: groupName(s, p.groupId),
          received: sumQty([received.get(p.id) ?? '0']),
          sold: sumQty([a?.qty ?? '0']),
          stock: q.warehouseId ? getStock(s, q.warehouseId, p.id) : getTotalStock(s, p.id),
          revenue: sumMoney([a?.revenue ?? '0']),
          profit: a ? subMoney(a.revenue, a.cost) : '0.00',
        };
      })
      .filter((r) =>
        q.status === 'sold'
          ? compareQty(r.sold, '0') > 0
          : q.status === 'unsold'
            ? compareQty(r.sold, '0') === 0
            : true,
      );
    return {
      rows,
      summary: (all) => ({
        count: String(all.length),
        quantity: qty(all, 'sold'),
        revenue: money(all, 'revenue'),
        profit: money(all, 'profit'),
      }),
    };
  },

  warehouse: (s, q) => {
    const rows = Object.entries(s.stock)
      .map(([key, stockRaw]) => {
        const [warehouseId = '', productId = ''] = key.split('|');
        const p = s.products.find((x) => x.id === productId);
        if (!p) return null;
        if (q.warehouseId && warehouseId !== q.warehouseId) return null;
        if (q.productId && productId !== q.productId) return null;
        if (q.groupId && p.groupId !== q.groupId) return null;
        const stock = sumQty([stockRaw]);
        // Holat — shu ombordagi qoldiq mahsulot chegarasi bilan (min_stock yoki global sozlama, A-15).
        const status =
          compareQty(stock, '0') <= 0
            ? 'outOfStock'
            : compareQty(stock, thresholdOf(s, p)) <= 0
              ? 'lowStock'
              : 'inStock';
        return {
          _k: `${warehouseId}${productId}`,
          warehouse: warehouseName(s, warehouseId),
          product: p.name,
          group: groupName(s, p.groupId),
          stock,
          stockValue: lineTotal(stock, p.costPrice),
          saleValue: lineTotal(stock, p.salePrice ?? p.wholesalePrice ?? '0'),
          status,
        };
      })
      .filter(
        (r): r is NonNullable<typeof r> => r !== null && (!q.status || r.status === q.status),
      );
    return {
      rows,
      summary: (all) => ({
        count: String(all.length),
        quantity: qty(all, 'stock'),
        stockValue: money(all, 'stockValue'),
      }),
    };
  },

  incoming: (s, q) => {
    const rows = s.incoming
      .filter(
        (d) =>
          dateOnlyInRange(d.date, q.dateFrom, q.dateTo) &&
          (!q.warehouseId || d.warehouseId === q.warehouseId) &&
          (!q.userId || d.createdBy === q.userId) &&
          (!q.status || d.status === q.status) &&
          (!q.productId || d.items.some((i) => i.productId === q.productId)),
      )
      .map((d) => ({
        _k: d.id,
        date: d.date,
        number: formatDocNumber('K', d.number),
        warehouse: warehouseName(s, d.warehouseId),
        itemsCount: d.items.length,
        quantity: sumQty(d.items.map((i) => i.quantity)),
        amount: sumMoney(d.items.map((i) => lineTotal(i.quantity, i.costPrice))),
        status: d.status,
      }));
    return {
      rows,
      // Kirim jami (miqdor, summa) — faqat tasdiqlangan hujjatlar (BUSINESS-RULES §4).
      summary: (all) => {
        const confirmed = all.filter((r) => r.status === 'CONFIRMED');
        return {
          count: String(all.length),
          quantity: qty(confirmed, 'quantity'),
          amount: money(confirmed, 'amount'),
        };
      },
    };
  },

  expenses: (s, q) => ({
    rows: s.expenses
      .filter(
        (e) =>
          !e.deletedAt &&
          dateOnlyInRange(e.date, q.dateFrom, q.dateTo) &&
          (!q.categoryId || e.categoryId === q.categoryId) &&
          (!q.userId || e.createdBy === q.userId),
      )
      .map((e) => ({
        _k: e.id,
        date: e.date,
        category: s.expenseCategories.find((c) => c.id === e.categoryId)?.name ?? '—',
        note: e.note,
        amount: sumMoney([e.amount]),
      })),
    summary: (all) => ({ count: String(all.length), expenses: money(all, 'amount') }),
  }),

  userSales: (s, q) => {
    const sales = salesWhere(s, q);
    const rows = s.users
      .filter((u) => !q.userId || u.id === q.userId)
      .map((u) => {
        const own = sales.filter((x) => x.userId === u.id);
        const revenue = sumMoney(own.map((x) => x.totalAmount));
        return {
          _k: u.id,
          seller: u.fullName ?? u.login,
          salesCount: own.length,
          quantity: sumQty(own.map((x) => x.totalQuantity)),
          revenue,
          averageCheck: divideMoney(revenue, own.length),
          profit: subMoney(revenue, sumMoney(own.map((x) => x.totalCost))),
        };
      })
      .filter((r) => r.salesCount > 0 || Boolean(q.userId));
    return {
      rows,
      summary: (all) => ({
        count: String(all.reduce((n, r) => n + Number(r.salesCount), 0)),
        revenue: money(all, 'revenue'),
        profit: money(all, 'profit'),
      }),
    };
  },

  productSales: (s, q) => {
    const product = (id: string) => s.products.find((p) => p.id === id);
    const agg = aggregateLines(
      salesWhere(s, q, { productLines: true }),
      (id) =>
        (!q.productId || id === q.productId) && (!q.groupId || product(id)?.groupId === q.groupId),
    );
    return {
      rows: [...agg.entries()].map(([productId, a]) => {
        const p = product(productId);
        return {
          _k: productId,
          product: p?.name ?? '—',
          group: p ? groupName(s, p.groupId) : '—',
          quantity: a.qty,
          revenue: a.revenue,
          cost: a.cost,
          profit: subMoney(a.revenue, a.cost),
        };
      }),
      summary: (all) => ({
        count: String(all.length),
        revenue: money(all, 'revenue'),
        profit: money(all, 'profit'),
      }),
    };
  },

  customerPurchases: (s, q) => {
    const search = q.search?.toLocaleLowerCase('uz');
    const digits = q.search?.replace(/\D/g, '') ?? '';
    const matches = (name: string, phone: string | null) =>
      !search ||
      name.toLocaleLowerCase('uz').includes(search) ||
      (digits.length >= 3 && Boolean(phone?.includes(digits)));
    const agg = new Map<string, SaleRow[]>();
    for (const sale of salesWhere(s, q)) {
      agg.set(sale.customerId, [...(agg.get(sale.customerId) ?? []), sale]);
    }
    const rows = s.customers
      .filter((c) => agg.has(c.id) && matches(c.name, c.phone))
      .map((c) => {
        const list = agg.get(c.id) ?? [];
        const amount = sumMoney(list.map((x) => x.totalAmount));
        return {
          _k: c.id,
          customer: c.name,
          phone: c.phone,
          purchases: list.length,
          amount,
          averageCheck: divideMoney(amount, list.length),
          lastPurchase: list.reduce((last, x) => (x.soldAt > last ? x.soldAt : last), ''),
        };
      });
    return {
      rows,
      summary: (all) => ({ count: String(all.length), amount: money(all, 'amount') }),
    };
  },
};

/** `ORDER BY r.<key> <dir> NULLS LAST, r._k <dir>` — backend bilan bir xil tartib. */
function sortRows(rows: Row[], key: string, kind: string, direction: 'asc' | 'desc'): Row[] {
  const factor = direction === 'desc' ? -1 : 1;
  const numeric = kind === 'money' || kind === 'quantity' || kind === 'integer';
  return [...rows].sort((a, b) => {
    const va = a[key];
    const vb = b[key];
    if (va === null || va === undefined) return vb === null || vb === undefined ? 0 : 1;
    if (vb === null || vb === undefined) return -1;
    const diff = numeric
      ? Number(va) - Number(vb)
      : String(va).localeCompare(String(vb), 'uz', { numeric: true });
    return (diff || a._k.localeCompare(b._k)) * factor;
  });
}

function groupsOf(rows: Row[]): ReportGroupItem[] {
  const map = new Map<string, Row[]>();
  for (const r of rows) {
    const label = String(r.category);
    map.set(label, [...(map.get(label) ?? []), r]);
  }
  return [...map.entries()]
    .map(([label, list]) => ({ label, count: list.length, amount: money(list, 'amount') }))
    .sort((a, b) => Number(b.amount) - Number(a.amount) || a.label.localeCompare(b.label, 'uz'));
}

function runReport(type: ReportType, query: Query): ReportResponse {
  const s = db();
  const definition = REPORT_DEFINITIONS[type];
  const parsed = validate(reportQuerySchema(definition), query) as ReportQuery;
  const { columns, summary: summaryDefs } = visibleReportParts(
    definition,
    currentCan(s, 'products.read_cost'),
  );
  const sortColumn = columns.find((c) => c.key === parsed.sort.field);
  if (!sortColumn) validationError('sort', M.invalidSort);
  const q = definition.dated
    ? { ...parsed, ...assertRange(parsed) }
    : { ...parsed, dateFrom: undefined, dateTo: undefined };

  const { rows, summary } = BUILDERS[type](s, q);
  const sorted = sortRows(rows, sortColumn.key, sortColumn.kind, q.sort.direction);
  const start = (q.page - 1) * q.pageSize;
  const totalsByKey = summary(rows);
  return {
    columns,
    // Faqat ko'rinadigan ustunlar — tannarx qiymatlari javobga umuman tushmaydi (OWN-06).
    data: sorted
      .slice(start, start + q.pageSize)
      .map((row) => Object.fromEntries(columns.map((c) => [c.key, row[c.key] ?? null]))),
    meta: buildPaginationMeta(q.page, q.pageSize, rows.length),
    summary: summaryDefs.map((d) => ({
      labelKey: d.labelKey,
      kind: d.kind,
      value: totalsByKey[d.labelKey] ?? '0',
    })),
    ...(definition.grouped ? { groups: groupsOf(rows) } : {}),
  };
}

const financeQuerySchema = z
  .object({ ...dateRange, warehouseId: optionalId })
  .superRefine(rangeOrder);

/**
 * Moliyaviy xulosa (REQ-103, BUSINESS-RULES §4). Xarajatlar omborga bog'lanmagan — ombor tanlansa
 * `expenses` va `netProfit` — `null` (D-21). Tannarxga oid kalitlar faqat `products.read_cost` bilan.
 */
route('GET', '/reports/finance-summary', ({ query }): FinanceSummaryDto => {
  requireCan('reports.read');
  const parsed = validate(financeQuerySchema, query);
  const range = assertRange(parsed);
  const s = db();
  const w = parsed.warehouseId;
  const sales = s.sales.filter(
    (x) => inDateRange(x.soldAt, range.dateFrom, range.dateTo) && (!w || x.warehouseId === w),
  );
  const revenue = sumMoney(sales.map((x) => x.totalAmount));
  const cost = sumMoney(sales.map((x) => x.totalCost));
  const expenses = sumMoney(
    s.expenses
      .filter((e) => !e.deletedAt && dateOnlyInRange(e.date, range.dateFrom, range.dateTo))
      .map((e) => e.amount),
  );
  const base: FinanceSummaryDto = {
    period: range,
    warehouseId: w ?? null,
    salesCount: sales.length,
    revenue,
    expenses: w ? null : expenses,
  };
  if (!currentCan(s, 'products.read_cost')) return base;
  const grossProfit = subMoney(revenue, cost);
  const incomingPurchases = sumMoney(
    s.incoming
      .filter(
        (d) =>
          d.status === 'CONFIRMED' &&
          dateOnlyInRange(d.date, range.dateFrom, range.dateTo) &&
          (!w || d.warehouseId === w),
      )
      .flatMap((d) => d.items.map((i) => lineTotal(i.quantity, i.costPrice))),
  );
  const inventoryValueAtCost = sumMoney(
    Object.entries(s.stock).flatMap(([key, quantity]) => {
      const [warehouseId, productId] = key.split('|');
      const p = s.products.find((x) => x.id === productId);
      return p && (!w || warehouseId === w) ? [lineTotal(quantity, p.costPrice)] : [];
    }),
  );
  return {
    ...base,
    costOfGoodsSold: cost,
    grossProfit,
    netProfit: w ? null : subMoney(grossProfit, expenses),
    incomingPurchases,
    inventoryValueAtCost,
  };
});

route('GET', '/reports/incoming/:number', ({ params }): IncomingReportDetailDto => {
  requireCan('reports.read');
  const s = db();
  const doc = s.incoming.find((d) => formatDocNumber('K', d.number) === params.number);
  if (!doc) fail(404, 'NOT_FOUND');
  const canReadCost = currentCan(s, 'products.read_cost');
  const items = doc.items
    .map((i) => {
      const p = s.products.find((x) => x.id === i.productId);
      return {
        productId: i.productId,
        productName: i.productName ?? p?.name ?? '—',
        barcode: i.barcode ?? p?.barcode ?? null,
        unit: p?.unit ?? 'DONA',
        quantity: i.quantity,
        ...(canReadCost
          ? { costPrice: i.costPrice, lineTotal: lineTotal(i.quantity, i.costPrice) }
          : {}),
      };
    })
    .sort((a, b) => a.productName.localeCompare(b.productName));
  return {
    number: formatDocNumber('K', doc.number),
    date: doc.date,
    warehouse: warehouseName(s, doc.warehouseId),
    status: doc.status,
    notes: doc.notes,
    createdBy: userRef(s, doc.createdBy),
    totalQuantity: sumQty(doc.items.map((i) => i.quantity)),
    ...(canReadCost
      ? { totalAmount: sumMoney(doc.items.map((i) => lineTotal(i.quantity, i.costPrice))) }
      : {}),
    items,
  };
});

route('GET', '/reports/:path', ({ params, query }): ReportResponse => {
  const type = reportTypeByPath(params.path ?? '');
  if (!type) fail(404, 'NOT_FOUND');
  requireCan('reports.read');
  return runReport(type, query);
});
