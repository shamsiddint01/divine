import { Permission } from '@divine/shared';
import { Receipt, SearchX, TrendingUp, Wallet } from 'lucide-react';
import { useState } from 'react';
import { ProductCombobox } from '@/features/products/components/ProductCombobox';
import { useHasAnyPermission } from '@/features/session/hooks/use-permissions';
import { useUserOptions } from '@/features/users/api/users';
import { useWarehouses } from '@/features/warehouses/api/warehouses';
import { t } from '@/i18n/uz';
import { useListParams } from '@/shared/hooks/use-list-params';
import { formatCompactMoney, formatDateTime, formatQuantity } from '@/shared/lib/format';
import { DataPagination } from '@/shared/components/DataPagination';
import { type Column, DataTable } from '@/shared/components/DataTable';
import { DateRangeFilter } from '@/shared/components/DateRangeFilter';
import { EmptyState } from '@/shared/components/EmptyState';
import { FilterSelect } from '@/shared/components/FilterSelect';
import { MoneyText } from '@/shared/components/MoneyText';
import { SearchInput } from '@/shared/components/SearchInput';
import { StatCard } from '@/shared/components/StatCard';
import { Button } from '@/shared/ui/button';
import type { SaleDto } from '@/shared/types/api';
import { useSales } from '../api/sales';
import { SaleDetailSheet } from './SaleDetailSheet';

export function SalesHistoryView() {
  const list = useListParams({
    defaultSort: 'soldAt:desc',
    filterKeys: ['dateFrom', 'dateTo', 'userId', 'warehouseId', 'productId'] as const,
  });
  const { data, isPending, isFetching, error, refetch } = useSales(list.query);
  // Sotuvchi faqat o'z sotuvlarini ko'radi (OWN-04): user filtri va foyda — faqat ruxsati borlarga.
  const canReadAll = useHasAnyPermission([Permission.SALES_READ_ALL]);
  const canListUsers = useHasAnyPermission([Permission.USERS_READ]);
  const canFilterUsers = canReadAll && canListUsers;
  const canReadCost = useHasAnyPermission([Permission.PRODUCTS_READ_COST]);
  const { data: users } = useUserOptions(canFilterUsers);
  const { data: warehouses } = useWarehouses();
  const [detailId, setDetailId] = useState<string | null>(null);

  const columns: Column<SaleDto>[] = [
    {
      key: 'number',
      header: t.sales.history.col.number,
      sortKey: 'number',
      cell: (s) => (
        <div>
          <span className="font-mono text-xs">{s.number}</span>
          {/* Telefonda sana shu yerda (alohida ustun sig'maydi) */}
          <p className="mt-0.5 text-xs text-muted-foreground sm:hidden tabular-nums">
            {formatDateTime(s.soldAt)}
          </p>
        </div>
      ),
    },
    {
      key: 'date',
      header: t.sales.history.col.date,
      sortKey: 'soldAt',
      hideBelow: 'sm',
      cell: (s) => <span className="tabular-nums">{formatDateTime(s.soldAt)}</span>,
    },
    {
      key: 'customer',
      header: t.sales.history.col.customer,
      cell: (s) => (
        <span
          className="block max-w-56 font-medium max-sm:line-clamp-2 sm:truncate"
          title={s.customer.name}
        >
          {s.customer.name}
        </span>
      ),
    },
    {
      key: 'seller',
      header: t.sales.history.col.seller,
      hideBelow: 'xl',
      cell: (s) => s.user.fullName ?? s.user.login,
    },
    {
      key: 'warehouse',
      header: t.sales.history.col.warehouse,
      hideBelow: '2xl',
      cell: (s) => <span className="text-muted-foreground">{s.warehouse.name}</span>,
    },
    {
      key: 'items',
      header: t.sales.history.col.items,
      align: 'right',
      hideBelow: '2xl',
      cell: (s) => (
        <span className="tabular-nums">
          {t.common.positions(s.itemsCount)} · {formatQuantity(s.totalQuantity)}
        </span>
      ),
    },
    {
      key: 'total',
      header: t.sales.history.col.total,
      sortKey: 'totalAmount',
      align: 'right',
      cell: (s) => <MoneyText value={s.totalAmount} className="font-medium" />,
    },
    {
      key: 'profit',
      header: t.sales.history.col.profit,
      align: 'right',
      hideBelow: 'sm',
      cell: (s) => <MoneyText value={s.grossProfit} className="text-success" />,
    },
  ];
  // Foyda — kelgan narxidan hisoblanadi: faqat `products.read_cost` (backend ham kalitni bermaydi).
  const visibleColumns = canReadCost ? columns : columns.filter((c) => c.key !== 'profit');

  return (
    <div className="space-y-4">
      <div className={`grid gap-2 sm:gap-4 ${canReadCost ? 'grid-cols-3' : 'grid-cols-2'}`}>
        <StatCard
          dense
          label={t.sales.history.summaryCount}
          icon={Receipt}
          loading={isPending}
          value={data?.summary.count ?? null}
        />
        <StatCard
          dense
          label={t.sales.history.summaryAmount}
          icon={Wallet}
          tone="info"
          loading={isPending}
          value={data ? formatCompactMoney(data.summary.totalAmount) : null}
        />
        {canReadCost ? (
          <StatCard
          dense
            label={t.sales.history.summaryProfit}
            icon={TrendingUp}
            tone="success"
            loading={isPending}
            value={data?.summary.grossProfit ? formatCompactMoney(data.summary.grossProfit) : null}
          />
        ) : null}
      </div>
      <div className="flex flex-col gap-2 lg:flex-row lg:flex-wrap lg:items-center">
        <SearchInput
          value={list.search}
          onChange={list.setSearch}
          placeholder={t.sales.history.searchPlaceholder}
        />
        <DateRangeFilter
          value={{ from: list.filters.dateFrom, to: list.filters.dateTo }}
          onChange={(r) => {
            list.setFilter('dateFrom', r.from);
            list.setFilter('dateTo', r.to);
          }}
        />
        <ProductCombobox
          value={list.filters.productId}
          onChange={(p) => list.setFilter('productId', p?.id ?? '')}
          clearLabel={t.reports.filters.allProducts}
          aria-label={t.reports.filters.allProducts}
          includeArchived
          className="sm:w-56"
        />
        {canFilterUsers ? (
          <FilterSelect
            value={list.filters.userId}
            onChange={(v) => list.setFilter('userId', v)}
            allLabel={t.sales.history.allUsers}
            options={(users ?? []).map((u) => ({ value: u.id, label: u.fullName ?? u.login }))}
          />
        ) : null}
        <FilterSelect
          value={list.filters.warehouseId}
          onChange={(v) => list.setFilter('warehouseId', v)}
          allLabel={t.sales.history.allWarehouses}
          options={(warehouses ?? []).map((w) => ({ value: w.id, label: w.name }))}
        />
        {list.activeFilterCount > 0 ? (
          <Button variant="ghost" onClick={list.reset}>
            {t.common.clearFilters}
          </Button>
        ) : null}
      </div>
      <DataTable
        columns={visibleColumns}
        rows={data?.data}
        rowKey={(s) => s.id}
        isLoading={isPending || isFetching}
        error={error}
        onRetry={() => refetch()}
        sort={list.sort}
        onSortChange={list.setSort}
        onRowClick={(s) => setDetailId(s.id)}
        selectedKey={detailId}
        empty={
          <EmptyState
            icon={SearchX}
            title={t.sales.history.emptyTitle}
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
      <SaleDetailSheet saleId={detailId} onClose={() => setDetailId(null)} />
    </div>
  );
}
