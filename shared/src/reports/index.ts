// Hisobotlar ta'riflari (Phase 12, API §13, REQ-110, REQ-111). Bitta manba: backend (`ReportDefinition` —
// SQL generator shu ustunlarni beradi), frontend mock va UI ustun sarlavhalari. Kelajakdagi CSV/XLSX
// exporter ham shu ta'riflardan foydalanadi — endpointlar o'zgarmaydi.
//
// `cost: true` — tannarx yoki undan hisoblanadigan qiymat (foyda, ombor tannarxi, kirim summasi):
// faqat `products.read_cost` bilan qaytadi (OWN-06), aks holda ustun, qiymat va yig'ma umuman yo'q.

export const REPORT_TYPES = [
  'sales',
  'products',
  'warehouse',
  'incoming',
  'expenses',
  'userSales',
  'productSales',
  'customerPurchases',
] as const;
export type ReportType = (typeof REPORT_TYPES)[number];

/** `GET /reports/<path>` (API §13). */
export const REPORT_PATHS: Readonly<Record<ReportType, string>> = {
  sales: 'sales',
  products: 'products',
  warehouse: 'warehouse-stock',
  incoming: 'incoming',
  expenses: 'expenses',
  userSales: 'user-sales',
  productSales: 'product-sales',
  customerPurchases: 'customer-purchases',
};

export const reportTypeByPath = (path: string): ReportType | undefined =>
  REPORT_TYPES.find((type) => REPORT_PATHS[type] === path);

/** D-21: sana filtri bor hisobotlarda oraliq majburiy va ko'pi bilan 366 kun. */
export const REPORT_MAX_DAYS = 366;

export type ReportCellKind =
  'text' | 'money' | 'quantity' | 'integer' | 'date' | 'datetime' | 'status';

export type ReportFilter =
  | 'productId'
  | 'userId'
  | 'warehouseId'
  | 'groupId'
  | 'customerId'
  | 'categoryId'
  | 'status'
  | 'search';

export interface ReportColumn {
  key: string;
  /** Kalit `t.reports.col` lug'atidan (ustun sarlavhasi o'zbekcha). */
  labelKey: string;
  kind: ReportCellKind;
  align?: 'left' | 'right';
}

export interface ReportColumnDef extends ReportColumn {
  cost?: boolean;
}

export interface ReportSummaryItem {
  labelKey: string;
  kind: 'money' | 'quantity' | 'integer';
  value: string;
}

export interface ReportSummaryDef {
  labelKey: string;
  kind: ReportSummaryItem['kind'];
  cost?: boolean;
}

/** Guruhlangan yig'ma (masalan, xarajatlar kategoriya bo'yicha — API §13). */
export interface ReportGroupItem {
  label: string;
  count: number;
  amount: string;
}

export interface ReportDefinition {
  type: ReportType;
  /** `true` — `dateFrom`/`dateTo` majburiy (D-21). */
  dated: boolean;
  filters: readonly ReportFilter[];
  /** `status` filtrining ruxsat etilgan qiymatlari. */
  statuses?: readonly string[];
  columns: readonly ReportColumnDef[];
  summary: readonly ReportSummaryDef[];
  /** Standart saralash (`key:dir`). */
  defaultSort: string;
  /** Kategoriya bo'yicha yig'ma bormi (`groups`). */
  grouped?: boolean;
}

const right = (kind: ReportCellKind) =>
  kind === 'money' || kind === 'quantity' || kind === 'integer' ? 'right' : 'left';
const col = (
  key: string,
  kind: ReportCellKind,
  opts: { labelKey?: string; cost?: boolean } = {},
): ReportColumnDef => ({
  key,
  labelKey: opts.labelKey ?? key,
  kind,
  align: right(kind),
  ...(opts.cost ? { cost: true } : {}),
});
const sum = (labelKey: string, kind: ReportSummaryItem['kind'], cost = false): ReportSummaryDef =>
  cost ? { labelKey, kind, cost: true } : { labelKey, kind };

export const REPORT_DEFINITIONS: Readonly<Record<ReportType, ReportDefinition>> = {
  sales: {
    type: 'sales',
    dated: true,
    filters: ['productId', 'userId', 'warehouseId', 'customerId'],
    columns: [
      col('soldAt', 'datetime', { labelKey: 'date' }),
      col('number', 'text'),
      col('customer', 'text'),
      col('seller', 'text'),
      col('warehouse', 'text'),
      col('quantity', 'quantity'),
      col('revenue', 'money'),
      col('cost', 'money', { cost: true }),
      col('profit', 'money', { cost: true }),
    ],
    summary: [
      sum('count', 'integer'),
      sum('revenue', 'money'),
      sum('cost', 'money', true),
      sum('profit', 'money', true),
    ],
    defaultSort: 'soldAt:desc',
  },
  products: {
    type: 'products',
    dated: true,
    filters: ['productId', 'userId', 'warehouseId', 'groupId', 'status'],
    statuses: ['sold', 'unsold'],
    columns: [
      col('product', 'text'),
      col('group', 'text'),
      col('received', 'quantity'),
      col('sold', 'quantity'),
      col('stock', 'quantity'),
      col('revenue', 'money'),
      col('profit', 'money', { cost: true }),
    ],
    summary: [
      sum('count', 'integer'),
      sum('quantity', 'quantity'),
      sum('revenue', 'money'),
      sum('profit', 'money', true),
    ],
    defaultSort: 'revenue:desc',
  },
  warehouse: {
    type: 'warehouse',
    dated: false,
    filters: ['productId', 'warehouseId', 'groupId', 'status'],
    statuses: ['inStock', 'lowStock', 'outOfStock'],
    columns: [
      col('warehouse', 'text'),
      col('product', 'text'),
      col('group', 'text'),
      col('stock', 'quantity'),
      col('stockValue', 'money', { cost: true }),
      col('saleValue', 'money'),
      col('status', 'status'),
    ],
    summary: [
      sum('count', 'integer'),
      sum('quantity', 'quantity'),
      sum('stockValue', 'money', true),
    ],
    defaultSort: 'stock:desc',
  },
  incoming: {
    type: 'incoming',
    dated: true,
    filters: ['productId', 'warehouseId', 'userId', 'status'],
    statuses: ['DRAFT', 'CONFIRMED', 'CANCELLED'],
    columns: [
      col('date', 'date'),
      col('number', 'text'),
      col('warehouse', 'text'),
      col('itemsCount', 'integer'),
      col('quantity', 'quantity'),
      col('amount', 'money', { cost: true }),
      col('status', 'status'),
    ],
    summary: [sum('count', 'integer'), sum('quantity', 'quantity'), sum('amount', 'money', true)],
    defaultSort: 'date:desc',
  },
  expenses: {
    type: 'expenses',
    dated: true,
    filters: ['categoryId', 'userId'],
    columns: [
      col('date', 'date'),
      col('category', 'text'),
      col('note', 'text'),
      col('amount', 'money'),
    ],
    summary: [sum('count', 'integer'), sum('expenses', 'money')],
    defaultSort: 'date:desc',
    grouped: true,
  },
  userSales: {
    type: 'userSales',
    dated: true,
    filters: ['userId', 'warehouseId', 'productId'],
    columns: [
      col('seller', 'text'),
      col('salesCount', 'integer'),
      col('quantity', 'quantity'),
      col('revenue', 'money'),
      col('averageCheck', 'money'),
      col('profit', 'money', { cost: true }),
    ],
    summary: [sum('count', 'integer'), sum('revenue', 'money'), sum('profit', 'money', true)],
    defaultSort: 'revenue:desc',
  },
  productSales: {
    type: 'productSales',
    dated: true,
    filters: ['productId', 'groupId', 'userId', 'warehouseId'],
    columns: [
      col('product', 'text'),
      col('group', 'text'),
      col('quantity', 'quantity'),
      col('revenue', 'money'),
      col('cost', 'money', { cost: true }),
      col('profit', 'money', { cost: true }),
    ],
    summary: [sum('count', 'integer'), sum('revenue', 'money'), sum('profit', 'money', true)],
    defaultSort: 'revenue:desc',
  },
  customerPurchases: {
    type: 'customerPurchases',
    dated: true,
    filters: ['productId', 'userId', 'warehouseId', 'customerId', 'search'],
    columns: [
      col('customer', 'text'),
      col('phone', 'text'),
      col('purchases', 'integer'),
      col('amount', 'money'),
      col('averageCheck', 'money'),
      col('lastPurchase', 'datetime'),
    ],
    summary: [sum('count', 'integer'), sum('amount', 'money')],
    defaultSort: 'amount:desc',
  },
};

/** Ko'ruvchi uchun ustunlar va yig'ma ta'riflari (tannarxsiz — `cost` belgilanganlari olib tashlanadi). */
export function visibleReportParts(definition: ReportDefinition, canReadCost: boolean) {
  return {
    columns: definition.columns
      .filter((c) => canReadCost || !c.cost)
      .map(({ cost: _cost, ...c }) => c as ReportColumn),
    summary: definition.summary.filter((s) => canReadCost || !s.cost),
  };
}

/** `dateFrom..dateTo` (ikkalasi ham kiradi) kunlar soni. */
export function inclusiveDays(dateFrom: string, dateTo: string): number {
  return (
    Math.round(
      (Date.parse(`${dateTo}T00:00:00Z`) - Date.parse(`${dateFrom}T00:00:00Z`)) / 86_400_000,
    ) + 1
  );
}
