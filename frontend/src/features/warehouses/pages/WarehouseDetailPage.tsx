import {
  AlertTriangle,
  ArrowDownToLine,
  ArrowUpFromLine,
  Boxes,
  MapPin,
  PackageX,
  SearchX,
  Wallet,
} from 'lucide-react';
import { Permission } from '@divine/shared';
import { Link, useParams, useSearchParams } from 'react-router';
import { useGroupOptions } from '@/features/product-groups/api/groups';
import { useHasAnyPermission } from '@/features/session/hooks/use-permissions';
import { t } from '@/i18n/uz';
import { useListParams } from '@/shared/hooks/use-list-params';
import { compareQty } from '@/shared/lib/decimal';
import { formatCompactMoney, formatDateTime, formatQuantity } from '@/shared/lib/format';
import { cn } from '@/shared/lib/utils';
import { DataPagination } from '@/shared/components/DataPagination';
import { type Column, DataTable } from '@/shared/components/DataTable';
import { DateRangeFilter } from '@/shared/components/DateRangeFilter';
import { EmptyState } from '@/shared/components/EmptyState';
import { DetailErrorPage } from '@/shared/components/DetailErrorPage';
import { FilterSelect } from '@/shared/components/FilterSelect';
import { MoneyText, QtyText } from '@/shared/components/MoneyText';
import { PageHeader } from '@/shared/components/PageHeader';
import { SearchInput } from '@/shared/components/SearchInput';
import { StatCard } from '@/shared/components/StatCard';
import { StatusBadge } from '@/shared/components/StatusBadge';
import { Badge } from '@/shared/ui/badge';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/shared/ui/tabs';
import type { MovementDto, StockRowDto } from '@/shared/types/api';
import { useWarehouse, useWarehouseMovements, useWarehouseStock } from '../api/warehouses';

function StockTab({ warehouseId }: { warehouseId: string }) {
  const list = useListParams({
    defaultSort: 'productName:asc',
    filterKeys: ['groupId', 'stock'] as const,
  });
  const { data, isPending, isFetching, error, refetch } = useWarehouseStock(
    warehouseId,
    list.query,
  );
  const { data: groups } = useGroupOptions();
  const canReadCost = useHasAnyPermission([Permission.PRODUCTS_READ_COST]);

  const columns: Column<StockRowDto>[] = [
    {
      key: 'productName',
      header: t.products.col.name,
      sortKey: 'productName',
      cell: (r) => (
        <div className="sm:min-w-40">
          <p className="max-w-72 font-medium max-sm:line-clamp-2 sm:truncate" title={r.productName}>
            {r.productName}
          </p>
          <p className="text-xs text-muted-foreground">
            {r.groupName}
            {r.barcode ? <span className="font-mono"> · {r.barcode}</span> : null}
          </p>
        </div>
      ),
    },
    {
      key: 'quantity',
      header: t.products.col.stock,
      sortKey: 'quantity',
      align: 'right',
      cell: (r) => (
        <span
          className={cn(
            'font-medium',
            compareQty(r.quantity, '0') <= 0 ? 'text-destructive' : r.isLowStock && 'text-warning',
          )}
        >
          <QtyText value={r.quantity} unit={r.unit} />
        </span>
      ),
    },
    {
      key: 'min',
      header: t.products.form.minStock,
      align: 'right',
      hideBelow: 'xl',
      cell: (r) => <QtyText value={r.minStock} className="text-muted-foreground" />,
    },
    {
      key: 'cost',
      header: t.products.col.costPrice,
      align: 'right',
      hideBelow: '2xl',
      cell: (r) => <MoneyText value={r.costPrice ?? null} muted />,
    },
    {
      key: 'value',
      header: t.warehouses.stockValue,
      sortKey: 'stockValue',
      align: 'right',
      hideBelow: 'sm',
      cell: (r) => <MoneyText value={r.stockValue ?? null} />,
    },
    {
      key: 'status',
      header: t.common.status,
      cell: (r) => (
        <StatusBadge
          status={
            compareQty(r.quantity, '0') <= 0 ? 'outOfStock' : r.isLowStock ? 'lowStock' : 'inStock'
          }
        />
      ),
    },
    {
      key: 'updated',
      header: t.warehouses.movement.date,
      sortKey: 'updatedAt',
      hideBelow: '2xl',
      cell: (r) => (
        <span className="text-muted-foreground tabular-nums">{formatDateTime(r.updatedAt)}</span>
      ),
    },
  ];
  const visibleColumns = canReadCost
    ? columns
    : columns.filter((c) => c.key !== 'cost' && c.key !== 'value');

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap">
        <SearchInput
          value={list.search}
          onChange={list.setSearch}
          placeholder={t.warehouses.stockSearch}
        />
        <FilterSelect
          value={list.filters.groupId}
          onChange={(v) => list.setFilter('groupId', v)}
          allLabel={t.products.allGroups}
          options={(groups ?? []).map((g) => ({ value: g.id, label: g.name }))}
        />
        <FilterSelect
          value={list.filters.stock}
          onChange={(v) => list.setFilter('stock', v)}
          allLabel={t.products.stockAll}
          options={[
            { value: 'low', label: t.products.stockLow },
            { value: 'out', label: t.products.stockOut },
          ]}
        />
      </div>
      <DataTable
        columns={visibleColumns}
        rows={data?.data}
        rowKey={(r) => r.productId}
        isLoading={isPending || isFetching}
        error={error}
        onRetry={() => refetch()}
        sort={list.sort}
        onSortChange={list.setSort}
        empty={
          list.activeFilterCount ? (
            <EmptyState
              icon={SearchX}
              title={t.products.noResults}
              description={t.table.noResultsHint}
            />
          ) : (
            <EmptyState
              icon={Boxes}
              title={t.warehouses.emptyStock}
              description={t.warehouses.emptyStockHint}
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
    </div>
  );
}

function MovementsTab({ warehouseId }: { warehouseId: string }) {
  const list = useListParams({
    defaultSort: 'createdAt:desc',
    filterKeys: ['movementType', 'dateFrom', 'dateTo'] as const,
    prefix: 'm_',
  });
  const { data, isPending, isFetching, error, refetch } = useWarehouseMovements(
    warehouseId,
    list.query,
  );

  const columns: Column<MovementDto>[] = [
    {
      key: 'date',
      header: t.warehouses.movement.date,
      cell: (m) => <span className="tabular-nums">{formatDateTime(m.createdAt)}</span>,
    },
    {
      key: 'type',
      header: t.warehouses.movement.type,
      cell: (m) =>
        m.movementType === 'INCOMING' ? (
          <Badge variant="success">
            <ArrowDownToLine />
            {t.warehouses.movement.INCOMING}
          </Badge>
        ) : (
          <Badge variant="info">
            <ArrowUpFromLine />
            {t.warehouses.movement.SALE}
          </Badge>
        ),
    },
    {
      key: 'product',
      header: t.warehouses.movement.product,
      cell: (m) => (
        <span
          className="block max-w-64 font-medium max-sm:line-clamp-2 sm:truncate"
          title={m.productName}
        >
          {m.productName}
        </span>
      ),
    },
    {
      key: 'qty',
      header: t.warehouses.movement.quantity,
      align: 'right',
      cell: (m) => (
        <span
          className={cn(
            'font-medium tabular-nums',
            m.quantity.startsWith('-') ? 'text-destructive' : 'text-success',
          )}
        >
          {m.quantity.startsWith('-') ? '' : '+'}
          {formatQuantity(m.quantity)}{' '}
          <span className="text-muted-foreground">{t.units[m.unit]}</span>
        </span>
      ),
    },
    {
      key: 'balance',
      header: t.warehouses.movement.balance,
      align: 'right',
      hideBelow: 'xl',
      cell: (m) => <QtyText value={m.balanceAfter} />,
    },
    {
      key: 'ref',
      header: t.warehouses.movement.reference,
      hideBelow: 'lg',
      cell: (m) =>
        m.movementType === 'INCOMING' ? (
          <Link
            to={`/incoming/${m.referenceId}`}
            className="font-mono text-xs text-primary hover:underline"
          >
            {m.referenceNumber}
          </Link>
        ) : (
          <span className="font-mono text-xs">{m.referenceNumber}</span>
        ),
    },
    {
      key: 'user',
      header: t.warehouses.movement.user,
      hideBelow: '2xl',
      cell: (m) => (
        <span className="text-muted-foreground">{m.createdBy.fullName ?? m.createdBy.login}</span>
      ),
    },
  ];

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap">
        <SearchInput
          value={list.search}
          onChange={list.setSearch}
          placeholder={t.warehouses.stockSearch}
        />
        <FilterSelect
          value={list.filters.movementType}
          onChange={(v) => list.setFilter('movementType', v)}
          allLabel={t.warehouses.movement.allTypes}
          options={[
            { value: 'INCOMING', label: t.warehouses.movement.INCOMING },
            { value: 'SALE', label: t.warehouses.movement.SALE },
          ]}
        />
        <DateRangeFilter
          value={{ from: list.filters.dateFrom, to: list.filters.dateTo }}
          onChange={(r) => {
            list.setFilter('dateFrom', r.from);
            list.setFilter('dateTo', r.to);
          }}
        />
      </div>
      <DataTable
        columns={columns}
        rows={data?.data}
        rowKey={(m) => m.id}
        isLoading={isPending || isFetching}
        error={error}
        onRetry={() => refetch()}
        empty={<EmptyState icon={SearchX} title={t.warehouses.emptyMovements} />}
        footer={
          <DataPagination
            meta={data?.meta}
            onPageChange={list.setPage}
            onPageSizeChange={list.setPageSize}
          />
        }
      />
    </div>
  );
}

export function WarehouseDetailPage() {
  const { id = '' } = useParams();
  const [params, setParams] = useSearchParams();
  const tab = params.get('tab') === 'movements' ? 'movements' : 'stock';
  const { data: w, isPending, error, refetch } = useWarehouse(id);

  if (error)
    return (
      <DetailErrorPage
        error={error}
        sectionLabel={t.nav.warehouses}
        sectionTo="/warehouses"
        onRetry={() => refetch()}
      />
    );

  return (
    <>
      <PageHeader
        breadcrumbs={[
          { label: t.nav.warehouses, to: '/warehouses' },
          { label: w?.name ?? t.common.loading },
        ]}
        title={
          <span className="flex items-center gap-3">
            {w?.name ?? t.common.loading}
            {w ? <StatusBadge status={w.status} /> : null}
          </span>
        }
        description={
          w?.address ? (
            <span className="inline-flex items-center gap-1">
              <MapPin className="size-3.5" />
              {w.address}
            </span>
          ) : null
        }
      />
      {w?.status === 'INACTIVE' ? (
        <p className="flex items-center gap-2 rounded-md bg-warning/10 p-3 text-sm text-warning">
          <AlertTriangle className="size-4 shrink-0" />
          {t.warehouses.inactiveNotice}
        </p>
      ) : null}
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard
          label={t.warehouses.totalStock}
          icon={Boxes}
          loading={isPending}
          value={w ? formatQuantity(w.totalQuantity) : null}
          hint={w ? t.dashboard.kpi.positions(w.productCount) : null}
        />
        <StatCard
          label={t.warehouses.stockValue}
          icon={Wallet}
          tone="info"
          loading={isPending}
          value={w ? (w.stockValue === undefined ? '—' : formatCompactMoney(w.stockValue)) : null}
        />
        <StatCard
          label={t.warehouses.incoming30}
          icon={ArrowDownToLine}
          tone="success"
          loading={isPending}
          value={w ? `+${formatQuantity(w.incoming30)}` : null}
        />
        <StatCard
          label={t.warehouses.outgoing30}
          icon={ArrowUpFromLine}
          tone="default"
          loading={isPending}
          value={w ? `−${formatQuantity(w.outgoing30)}` : null}
          hint={
            w && w.lowStockCount > 0 ? (
              <span className="inline-flex items-center gap-1 text-warning">
                <PackageX className="size-3.5" />
                {t.warehouses.lowStockCount}: {w.lowStockCount}
              </span>
            ) : null
          }
        />
      </div>
      <Tabs
        value={tab}
        onValueChange={(v) => {
          const next = new URLSearchParams(params);
          if (v === 'stock') next.delete('tab');
          else next.set('tab', v);
          setParams(next, { replace: true });
        }}
      >
        <TabsList>
          <TabsTrigger value="stock">{t.warehouses.tabs.stock}</TabsTrigger>
          <TabsTrigger value="movements">{t.warehouses.tabs.movements}</TabsTrigger>
        </TabsList>
        <TabsContent value="stock">
          <StockTab warehouseId={id} />
        </TabsContent>
        <TabsContent value="movements">
          <MovementsTab warehouseId={id} />
        </TabsContent>
      </Tabs>
    </>
  );
}
