import { PackagePlus, Plus, SearchX } from 'lucide-react';
import { Permission } from '@divine/shared';
import { Link, useNavigate } from 'react-router';
import { useHasAnyPermission } from '@/features/session/hooks/use-permissions';
import { useWarehouses } from '@/features/warehouses/api/warehouses';
import { t } from '@/i18n/uz';
import { useListParams } from '@/shared/hooks/use-list-params';
import { formatDate } from '@/shared/lib/format';
import { DataPagination } from '@/shared/components/DataPagination';
import { type Column, DataTable } from '@/shared/components/DataTable';
import { DateRangeFilter } from '@/shared/components/DateRangeFilter';
import { EmptyState } from '@/shared/components/EmptyState';
import { FilterSelect } from '@/shared/components/FilterSelect';
import { MoneyText, QtyText } from '@/shared/components/MoneyText';
import { PageHeader } from '@/shared/components/PageHeader';
import { SearchInput } from '@/shared/components/SearchInput';
import { StatusBadge } from '@/shared/components/StatusBadge';
import { Button } from '@/shared/ui/button';
import type { IncomingDto } from '@/shared/types/api';
import { useIncomingList } from '../api/incoming';

export function IncomingPage() {
  const navigate = useNavigate();
  const list = useListParams({
    defaultSort: 'date:desc',
    filterKeys: ['status', 'warehouseId', 'dateFrom', 'dateTo'] as const,
  });
  const { data, isPending, isFetching, error, refetch } = useIncomingList(list.query);
  const { data: warehouses } = useWarehouses();
  const canManage = useHasAnyPermission([Permission.INCOMING_MANAGE]);

  const columns: Column<IncomingDto>[] = [
    {
      key: 'number',
      header: t.incoming.col.number,
      cell: (d) => (
        <div>
          <span className="font-mono text-xs font-medium">{d.number}</span>
          {/* Telefonda sana va ombor shu yerda (alohida ustunlar sig'maydi) */}
          <p className="mt-0.5 text-xs text-muted-foreground sm:hidden">
            <span className="tabular-nums">{formatDate(d.date)}</span> · {d.warehouseName}
          </p>
        </div>
      ),
    },
    {
      key: 'date',
      header: t.incoming.col.date,
      sortKey: 'date',
      hideBelow: 'sm',
      cell: (d) => <span className="tabular-nums">{formatDate(d.date)}</span>,
    },
    {
      key: 'warehouse',
      header: t.incoming.col.warehouse,
      hideBelow: 'sm',
      cell: (d) => d.warehouseName,
    },
    {
      key: 'items',
      header: t.incoming.col.items,
      align: 'right',
      hideBelow: 'xl',
      cell: (d) => <span className="tabular-nums">{t.common.positions(d.itemsCount)}</span>,
    },
    {
      key: 'qty',
      header: t.incoming.col.totalQuantity,
      sortKey: 'totalQuantity',
      align: 'right',
      cell: (d) => <QtyText value={d.totalQuantity} className="font-medium" />,
    },
    {
      key: 'amount',
      header: t.incoming.col.totalAmount,
      sortKey: 'totalAmount',
      align: 'right',
      hideBelow: 'sm',
      cell: (d) => <MoneyText value={d.totalAmount} />,
    },
    {
      key: 'by',
      header: t.incoming.col.createdBy,
      hideBelow: '2xl',
      cell: (d) => (
        <span className="text-muted-foreground">{d.createdBy.fullName ?? d.createdBy.login}</span>
      ),
    },
    {
      key: 'status',
      header: t.incoming.col.status,
      cell: (d) => <StatusBadge status={d.status} />,
    },
  ];

  return (
    <>
      <PageHeader
        title={t.nav.incoming}
        description={t.incoming.description}
        actions={
          canManage ? (
            <Button asChild>
              <Link to="/incoming/new">
                <Plus />
                {t.incoming.add}
              </Link>
            </Button>
          ) : null
        }
      />
      <div className="flex flex-col gap-2 lg:flex-row lg:flex-wrap lg:items-center">
        <SearchInput
          value={list.search}
          onChange={list.setSearch}
          placeholder={t.incoming.searchPlaceholder}
        />
        <DateRangeFilter
          value={{ from: list.filters.dateFrom, to: list.filters.dateTo }}
          onChange={(r) => {
            list.setFilter('dateFrom', r.from);
            list.setFilter('dateTo', r.to);
          }}
        />
        <FilterSelect
          value={list.filters.warehouseId}
          onChange={(v) => list.setFilter('warehouseId', v)}
          allLabel={t.incoming.allWarehouses}
          options={(warehouses ?? []).map((w) => ({ value: w.id, label: w.name }))}
        />
        <FilterSelect
          value={list.filters.status}
          onChange={(v) => list.setFilter('status', v)}
          allLabel={t.incoming.allStatuses}
          className="sm:w-44"
          options={(['DRAFT', 'CONFIRMED', 'CANCELLED'] as const).map((s) => ({
            value: s,
            label: t.status[s],
          }))}
        />
        {list.activeFilterCount > 0 ? (
          <Button variant="ghost" onClick={list.reset}>
            {t.common.clearFilters}
          </Button>
        ) : null}
      </div>
      <DataTable
        columns={columns}
        rows={data?.data}
        rowKey={(d) => d.id}
        isLoading={isPending || isFetching}
        error={error}
        onRetry={() => refetch()}
        sort={list.sort}
        onSortChange={list.setSort}
        onRowClick={(d) => navigate(`/incoming/${d.id}`)}
        empty={
          list.activeFilterCount ? (
            <EmptyState
              icon={SearchX}
              title={t.table.noResults}
              description={t.table.noResultsHint}
            />
          ) : (
            <EmptyState
              icon={PackagePlus}
              title={t.incoming.emptyTitle}
              description={t.incoming.emptyDescription}
            />
          )
        }
        footer={
          <DataPagination
            meta={data?.meta}
            onPageChange={list.setPage}
            onPageSizeChange={list.setPageSize}
          />
        }
      />
    </>
  );
}
