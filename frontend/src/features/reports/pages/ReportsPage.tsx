import {
  BarChart3,
  Boxes,
  Landmark,
  PackagePlus,
  Receipt,
  SearchX,
  ShoppingBag,
  UserRound,
  Users,
  Wallet,
  type LucideIcon,
} from 'lucide-react';
import type { ReactNode } from 'react';
import { useSearchParams } from 'react-router';
import { REPORT_DEFINITIONS, type ReportFilter } from '@divine/shared';
import { useExpenseCategories } from '@/features/expenses/api/expenses';
import { useGroupOptions } from '@/features/product-groups/api/groups';
import { ProductCombobox } from '@/features/products/components/ProductCombobox';
import { useUserOptions } from '@/features/users/api/users';
import { useWarehouses } from '@/features/warehouses/api/warehouses';
import { t } from '@/i18n/uz';
import { useListParams } from '@/shared/hooks/use-list-params';
import { ApiError } from '@/shared/lib/api-client';
import {
  formatDate,
  formatDateTime,
  formatInteger,
  formatMoney,
  formatQuantity,
  todayInTashkent,
} from '@/shared/lib/format';
import { cn } from '@/shared/lib/utils';
import { DataPagination } from '@/shared/components/DataPagination';
import { type Column, DataTable } from '@/shared/components/DataTable';
import { DateRangeFilter } from '@/shared/components/DateRangeFilter';
import { EmptyState } from '@/shared/components/EmptyState';
import { ErrorState } from '@/shared/components/ErrorState';
import { type FilterOption, FilterSelect } from '@/shared/components/FilterSelect';
import { PageHeader } from '@/shared/components/PageHeader';
import { SearchInput } from '@/shared/components/SearchInput';
import { StatusBadge } from '@/shared/components/StatusBadge';
import { Button } from '@/shared/ui/button';
import { Card } from '@/shared/ui/card';
import { Skeleton } from '@/shared/ui/skeleton';
import type {
  FinanceSummaryDto,
  ReportColumn,
  ReportGroupItem,
  ReportSummaryItem,
  ReportType,
} from '@/shared/types/api';
import { useFinanceSummary, useReport } from '../api/reports';

type Tab = ReportType | 'finance';

const TABS: { type: Tab; icon: LucideIcon }[] = [
  { type: 'sales', icon: Receipt },
  { type: 'products', icon: ShoppingBag },
  { type: 'warehouse', icon: Boxes },
  { type: 'incoming', icon: PackagePlus },
  { type: 'expenses', icon: Wallet },
  { type: 'userSales', icon: Users },
  { type: 'productSales', icon: BarChart3 },
  { type: 'customerPurchases', icon: UserRound },
  { type: 'finance', icon: Landmark },
];

const tabTitle = (type: Tab) =>
  type === 'finance' ? t.reports.finance.title : t.reports.types[type];
const tabHint = (type: Tab) =>
  type === 'finance' ? t.reports.finance.hint : t.reports.hints[type];

const STATUS_LABELS: Record<string, string> = {
  sold: t.reports.filters.sold,
  unsold: t.reports.filters.unsold,
  inStock: t.status.inStock,
  lowStock: t.status.lowStock,
  outOfStock: t.status.outOfStock,
  DRAFT: t.status.DRAFT,
  CONFIRMED: t.status.CONFIRMED,
  CANCELLED: t.status.CANCELLED,
};

/** URL'dagi filtr kalitlari (`search` — `q` orqali `useListParams`da). */
const FILTER_KEYS = [
  'dateFrom',
  'dateTo',
  'productId',
  'userId',
  'warehouseId',
  'groupId',
  'categoryId',
  'status',
] as const;

/** Keng hisobotlarda ikkinchi darajali ustunlar tor ekranda yashiriladi (to'liq — ≥1536px). */
const COLUMN_PRIORITY: Record<string, Column<Record<string, string | number | null>>['hideBelow']> =
  {
    cost: '2xl',
    warehouse: '2xl',
    group: '2xl',
    saleValue: '2xl',
    received: 'xl',
    averageCheck: 'xl',
    note: 'xl',
    phone: 'xl',
    seller: 'xl',
  };

const label = (key: string) => (t.reports.col as Record<string, string>)[key] ?? key;
const kpiLabel = (key: string) => (t.reports.kpi as Record<string, string>)[key] ?? key;

/** D-21: sana tanlanmagan bo'lsa — joriy oy (1-sanadan bugungacha, Toshkent). */
function currentMonth(): { from: string; to: string } {
  const today = todayInTashkent();
  return { from: `${today.slice(0, 8)}01`, to: today };
}

/** Validatsiya xatosida server bergan aniq sabab (masalan, "oraliq 366 kundan oshmasin"). */
function errorText(error: Error | null): Error | null {
  if (error instanceof ApiError && error.details[0]?.message) {
    return new Error(error.details[0].message);
  }
  return error;
}

function renderCell(col: ReportColumn, value: string | number | null) {
  if (value === null || value === undefined || value === '')
    return <span className="text-muted-foreground">{t.common.notSet}</span>;
  switch (col.kind) {
    case 'money':
      return <span className="tabular-nums">{formatMoney(String(value))}</span>;
    case 'quantity':
      return <span className="tabular-nums">{formatQuantity(String(value))}</span>;
    case 'integer':
      return <span className="tabular-nums">{formatInteger(Number(value))}</span>;
    case 'date':
      return <span className="tabular-nums">{formatDate(String(value))}</span>;
    case 'datetime':
      return <span className="tabular-nums">{formatDateTime(String(value))}</span>;
    case 'status':
      return <StatusBadge status={String(value)} />;
    default:
      return (
        <span className="block max-w-72 truncate" title={String(value)}>
          {String(value)}
        </span>
      );
  }
}

function SummaryValue({ item }: { item: ReportSummaryItem }) {
  if (item.kind === 'money') return <>{formatMoney(item.value)}</>;
  if (item.kind === 'quantity') return <>{formatQuantity(item.value)}</>;
  return <>{formatInteger(Number(item.value))}</>;
}

function SummaryTile({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div
      role="group"
      aria-label={title}
      className="rounded-lg bg-muted/40 px-3 py-2.5 sm:px-4 sm:py-3"
    >
      <p className="text-[11px] leading-snug text-muted-foreground sm:text-xs">{title}</p>
      <div className="mt-0.5 text-sm font-semibold break-words tabular-nums sm:text-lg">
        {children}
      </div>
    </div>
  );
}

function ExpenseGroups({ groups }: { groups: ReportGroupItem[] }) {
  if (groups.length === 0) return null;
  return (
    <div className="space-y-2 border-t pt-4">
      <p className="text-sm font-medium">{t.reports.byCategory}</p>
      <ul className="grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
        {groups.map((g) => (
          <li
            key={g.label}
            className="flex items-center justify-between gap-3 rounded-lg border px-3 py-2 text-sm"
          >
            <span className="min-w-0">
              <span className="block truncate font-medium">{g.label}</span>
              <span className="block text-xs text-muted-foreground">
                {t.reports.records(g.count)}
              </span>
            </span>
            <span className="shrink-0 font-medium tabular-nums">{formatMoney(g.amount)}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

const FINANCE_ITEMS: { key: keyof FinanceSummaryDto; integer?: boolean }[] = [
  { key: 'salesCount', integer: true },
  { key: 'revenue' },
  { key: 'costOfGoodsSold' },
  { key: 'grossProfit' },
  { key: 'expenses' },
  { key: 'netProfit' },
  { key: 'incomingPurchases' },
  { key: 'inventoryValueAtCost' },
];

/** Moliyaviy xulosa: tannarxga oid kalitlar javobda bo'lmasa (`products.read_cost` yo'q) — ko'rsatilmaydi. */
function FinancePanel({ data, loading }: { data?: FinanceSummaryDto; loading: boolean }) {
  if (loading || !data) {
    return (
      <div className="grid gap-3 border-t pt-4 sm:grid-cols-2 xl:grid-cols-4">
        {Array.from({ length: 4 }, (_, i) => (
          <Skeleton key={i} className="h-16" />
        ))}
      </div>
    );
  }
  const items = FINANCE_ITEMS.filter((item) => item.key in data);
  const hiddenByWarehouse = data.expenses === null;
  return (
    <div className="space-y-3 border-t pt-4">
      <div className="grid grid-cols-2 gap-2 sm:gap-3 xl:grid-cols-4">
        {items.map(({ key, integer }) => {
          const value = data[key] as string | number | null;
          return (
            <SummaryTile
              key={key}
              title={t.reports.finance.items[key as keyof typeof t.reports.finance.items]}
            >
              {value === null ? (
                <span className="text-muted-foreground">{t.common.notSet}</span>
              ) : integer ? (
                formatInteger(Number(value))
              ) : (
                formatMoney(String(value))
              )}
            </SummaryTile>
          );
        })}
      </div>
      {hiddenByWarehouse ? (
        <p className="text-sm text-muted-foreground">{t.reports.finance.notByWarehouse}</p>
      ) : null}
      {'inventoryValueAtCost' in data ? (
        <p className="text-xs text-muted-foreground">{t.reports.finance.inventoryNow}</p>
      ) : null}
    </div>
  );
}

export function ReportsPage() {
  const [params, setParams] = useSearchParams();
  const requested = params.get('report');
  const active: Tab = TABS.find((r) => r.type === requested)?.type ?? 'sales';
  const definition = active === 'finance' ? null : REPORT_DEFINITIONS[active];
  const has = (filter: ReportFilter | 'date') =>
    active === 'finance'
      ? filter === 'date' || filter === 'warehouseId'
      : filter === 'date'
        ? definition!.dated
        : definition!.filters.includes(filter);

  const list = useListParams({ defaultSort: '', filterKeys: FILTER_KEYS });
  const month = currentMonth();
  const dateFrom = list.filters.dateFrom || month.from;
  const dateTo = list.filters.dateTo || month.to;

  const query: Record<string, string | number> = { page: list.page, pageSize: list.pageSize };
  if (list.sort) query.sort = list.sort;
  if (has('date')) Object.assign(query, { dateFrom, dateTo });
  for (const key of FILTER_KEYS) {
    if (key === 'dateFrom' || key === 'dateTo') continue;
    if (has(key) && list.filters[key]) query[key] = list.filters[key];
  }
  if (has('search') && list.search) query.search = list.search;

  const report = useReport(active === 'finance' ? 'sales' : active, query, active !== 'finance');
  const finance = useFinanceSummary(
    { dateFrom, dateTo, warehouseId: list.filters.warehouseId || undefined },
    active === 'finance',
  );
  const { data: users } = useUserOptions(has('userId'));
  const { data: warehouses } = useWarehouses();
  const { data: groups } = useGroupOptions();
  const { data: categories } = useExpenseCategories();

  const selectReport = (type: Tab) =>
    setParams(type === 'sales' ? {} : { report: type }, { replace: true });

  const data = report.data;
  const columns: Column<Record<string, string | number | null>>[] = (data?.columns ?? []).map(
    (c) => ({
      key: c.key,
      header: label(c.labelKey),
      sortKey: c.key,
      align: c.align,
      hideBelow: COLUMN_PRIORITY[c.key],
      cell: (row) => renderCell(c, row[c.key] ?? null),
    }),
  );
  const statusOptions: FilterOption[] = (definition?.statuses ?? []).map((value) => ({
    value,
    label: STATUS_LABELS[value] ?? value,
  }));

  return (
    <>
      <PageHeader title={t.nav.reports} description={t.reports.description} />

      <div
        className="grid grid-cols-3 gap-2 sm:grid-cols-2 sm:gap-3 lg:grid-cols-3"
        role="tablist"
        aria-label={t.nav.reports}
      >
        {TABS.map((r) => {
          const Icon = r.icon;
          const selected = r.type === active;
          return (
            <button
              key={r.type}
              type="button"
              role="tab"
              aria-selected={selected}
              onClick={() => selectReport(r.type)}
              className={cn(
                // Telefonda 3 ustun: ikonka tepada, nom ostida, izoh yashirin (sig'maydi)
                'flex flex-col items-center gap-1.5 rounded-xl border bg-card p-2.5 text-center transition-all hover:border-primary/40 hover:shadow-sm focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:outline-none sm:flex-row sm:items-start sm:gap-3 sm:p-4 sm:text-left',
                selected && 'border-primary ring-1 ring-primary',
              )}
            >
              <span
                className={cn(
                  'flex size-8 shrink-0 items-center justify-center rounded-lg sm:size-9',
                  selected
                    ? 'bg-primary text-primary-foreground'
                    : 'bg-muted text-muted-foreground',
                )}
              >
                <Icon className="size-[18px]" />
              </span>
              <span className="min-w-0">
                <span className="block text-xs leading-tight font-semibold sm:text-sm">
                  {tabTitle(r.type)}
                </span>
                <span className="block text-xs text-muted-foreground max-sm:hidden">
                  {tabHint(r.type)}
                </span>
              </span>
            </button>
          );
        })}
      </div>

      <Card className="gap-4 p-4">
        <div className="flex flex-col gap-2 lg:flex-row lg:flex-wrap lg:items-center">
          {has('date') ? (
            <DateRangeFilter
              value={{ from: dateFrom, to: dateTo }}
              onChange={(r) => {
                // Sana majburiy (D-21): tozalansa — yana joriy oy.
                list.setFilter('dateFrom', r.from ?? '');
                list.setFilter('dateTo', r.to ?? '');
              }}
            />
          ) : null}
          {has('search') ? (
            <SearchInput
              value={list.search}
              onChange={list.setSearch}
              placeholder={t.reports.filters.searchCustomer}
              className="sm:w-64"
            />
          ) : null}
          {has('productId') ? (
            <ProductCombobox
              value={list.filters.productId}
              onChange={(p) => list.setFilter('productId', p?.id ?? '')}
              clearLabel={t.reports.filters.allProducts}
              aria-label={t.reports.filters.allProducts}
              includeArchived
              className="sm:w-56"
            />
          ) : null}
          {has('groupId') ? (
            <FilterSelect
              value={list.filters.groupId}
              onChange={(v) => list.setFilter('groupId', v)}
              allLabel={t.reports.filters.allGroups}
              options={(groups ?? []).map((g) => ({ value: g.id, label: g.name }))}
            />
          ) : null}
          {has('categoryId') ? (
            <FilterSelect
              value={list.filters.categoryId}
              onChange={(v) => list.setFilter('categoryId', v)}
              allLabel={t.reports.filters.allCategories}
              options={(categories ?? []).map((c) => ({ value: c.id, label: c.name }))}
            />
          ) : null}
          {has('userId') ? (
            <FilterSelect
              value={list.filters.userId}
              onChange={(v) => list.setFilter('userId', v)}
              allLabel={t.reports.filters.allUsers}
              options={(users ?? []).map((u) => ({ value: u.id, label: u.fullName ?? u.login }))}
            />
          ) : null}
          {has('warehouseId') ? (
            <FilterSelect
              value={list.filters.warehouseId}
              onChange={(v) => list.setFilter('warehouseId', v)}
              allLabel={t.reports.filters.allWarehouses}
              options={(warehouses ?? []).map((w) => ({ value: w.id, label: w.name }))}
            />
          ) : null}
          {has('status') && statusOptions.length > 0 ? (
            <FilterSelect
              value={list.filters.status}
              onChange={(v) => list.setFilter('status', v)}
              allLabel={t.reports.filters.allStatuses}
              options={statusOptions}
            />
          ) : null}
          {list.activeFilterCount > 0 ? (
            <Button variant="ghost" onClick={list.reset}>
              {t.common.clearFilters}
            </Button>
          ) : null}
        </div>

        {active === 'finance' ? (
          finance.error && !finance.data ? (
            <ErrorState
              message={errorText(finance.error)?.message ?? t.errors.unexpected}
              onRetry={() => finance.refetch()}
            />
          ) : (
            <FinancePanel data={finance.data} loading={finance.isPending} />
          )
        ) : (
          <>
            <div className="grid grid-cols-2 gap-2 border-t pt-4 sm:gap-3 xl:grid-cols-4">
              {report.isPending
                ? Array.from({ length: 4 }, (_, i) => <Skeleton key={i} className="h-16" />)
                : data?.summary.map((s) => (
                    <SummaryTile key={s.labelKey} title={kpiLabel(s.labelKey)}>
                      <SummaryValue item={s} />
                    </SummaryTile>
                  ))}
            </div>
            {data?.groups ? <ExpenseGroups groups={data.groups} /> : null}
          </>
        )}
      </Card>

      {active === 'finance' ? null : (
        <DataTable
          mobileCards
          columns={columns}
          rows={data?.data}
          rowKey={(row) => Object.values(row).join('|')}
          isLoading={report.isPending || report.isFetching}
          error={errorText(report.error)}
          onRetry={() => report.refetch()}
          sort={list.sort}
          onSortChange={list.setSort}
          empty={
            <EmptyState
              icon={SearchX}
              title={t.reports.empty}
              description={t.table.noResultsHint}
            />
          }
          footer={
            <DataPagination
              meta={data?.meta}
              onPageChange={list.setPage}
              onPageSizeChange={list.setPageSize}
            />
          }
        />
      )}
    </>
  );
}
