import {
  Eye,
  MoreHorizontal,
  PackagePlus,
  Pencil,
  Plus,
  Power,
  PowerOff,
  SearchX,
} from 'lucide-react';
import { Permission } from '@divine/shared';
import { useState } from 'react';
import { toast } from 'sonner';
import { useGroupOptions } from '@/features/product-groups/api/groups';
import { useHasAnyPermission } from '@/features/session/hooks/use-permissions';
import { useWarehouses } from '@/features/warehouses/api/warehouses';
import { t } from '@/i18n/uz';
import { useListParams } from '@/shared/hooks/use-list-params';
import { compareQty } from '@/shared/lib/decimal';
import { toastError } from '@/shared/lib/mutation';
import { cn } from '@/shared/lib/utils';
import { ConfirmDialog } from '@/shared/components/ConfirmDialog';
import { DataPagination } from '@/shared/components/DataPagination';
import { type Column, DataTable } from '@/shared/components/DataTable';
import { EmptyState } from '@/shared/components/EmptyState';
import { FilterSelect } from '@/shared/components/FilterSelect';
import { MoneyText, QtyText } from '@/shared/components/MoneyText';
import { PageHeader } from '@/shared/components/PageHeader';
import { SearchInput } from '@/shared/components/SearchInput';
import { StatusBadge } from '@/shared/components/StatusBadge';
import { Button } from '@/shared/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/shared/ui/dropdown-menu';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/shared/ui/tooltip';
import type { ProductDto } from '@/shared/types/api';
import { useProducts, useSetProductStatus } from '../api/products';
import { ProductDetailSheet } from '../components/ProductDetailSheet';
import { ProductFormDialog } from '../components/ProductFormDialog';

export function ProductsPage() {
  const list = useListParams({
    defaultSort: 'name:asc',
    filterKeys: ['groupId', 'warehouseId', 'status', 'stock'] as const,
  });
  const { data, isPending, isFetching, error, refetch } = useProducts(list.query);
  const { data: groups } = useGroupOptions();
  const { data: warehouses } = useWarehouses();
  const setStatus = useSetProductStatus();
  // Faqat UX: backend kelgan narxini ruxsatsiz userga umuman bermaydi (OWN-06).
  const canReadCost = useHasAnyPermission([Permission.PRODUCTS_READ_COST]);
  const canManage = useHasAnyPermission([Permission.PRODUCTS_MANAGE]);

  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<ProductDto | null>(null);
  const [detailId, setDetailId] = useState<string | null>(null);
  const [deactivating, setDeactivating] = useState<ProductDto | null>(null);

  const openCreate = () => {
    setEditing(null);
    setFormOpen(true);
  };
  const openEdit = (p: ProductDto) => {
    setDetailId(null);
    setEditing(p);
    setFormOpen(true);
  };
  const changeStatus = async (p: ProductDto, status: 'ACTIVE' | 'INACTIVE') => {
    try {
      await setStatus.mutateAsync({ id: p.id, status });
      toast.success(
        status === 'ACTIVE'
          ? t.products.statusChange.activated
          : t.products.statusChange.deactivated,
      );
    } catch (e) {
      toastError(e);
      throw e;
    }
  };

  const allColumns: Column<ProductDto>[] = [
    {
      key: 'name',
      header: t.products.col.name,
      sortKey: 'name',
      cell: (p) => (
        <div className="sm:max-w-64 sm:min-w-40">
          <p className="font-medium max-sm:line-clamp-2 sm:truncate">{p.name}</p>
          {/* Tor ekranda guruh va shtrix-kod shu yerda; keng ekranda — alohida ustunlarda */}
          <p className="text-xs text-muted-foreground sm:truncate 2xl:hidden">
            {p.groupName}
            {p.barcode ? <span className="font-mono"> · {p.barcode}</span> : null}
          </p>
          <p className="hidden text-xs text-muted-foreground 2xl:block">{t.unitNames[p.unit]}</p>
        </div>
      ),
    },
    {
      key: 'group',
      header: t.products.col.group,
      sortKey: 'group',
      hideBelow: '2xl',
      cell: (p) => <span className="text-muted-foreground">{p.groupName}</span>,
    },
    {
      key: 'barcode',
      header: t.products.col.barcode,
      hideBelow: '2xl',
      cell: (p) =>
        p.barcode ? (
          <span className="font-mono text-xs">{p.barcode}</span>
        ) : (
          <span className="text-muted-foreground">{t.common.notSet}</span>
        ),
    },
    {
      key: 'warehouse',
      header: t.products.col.warehouse,
      hideBelow: 'xl',
      cell: (p) => {
        const [first] = p.warehouses;
        if (!first) return <span className="text-muted-foreground">{t.products.noWarehouse}</span>;
        return (
          <Tooltip>
            <TooltipTrigger asChild>
              <span className="block max-w-32 truncate">{first.warehouseName}</span>
            </TooltipTrigger>
            <TooltipContent>
              {p.warehouses.map((w) => (
                <p key={w.warehouseId}>
                  {w.warehouseName}: <QtyText value={w.quantity} unit={p.unit} />
                </p>
              ))}
            </TooltipContent>
          </Tooltip>
        );
      },
    },
    {
      key: 'received',
      header: t.products.col.received,
      sortKey: 'received',
      align: 'right',
      hideBelow: '2xl',
      cell: (p) => <QtyText value={p.received} />,
    },
    {
      key: 'sold',
      header: t.products.col.sold,
      sortKey: 'sold',
      align: 'right',
      hideBelow: 'xl',
      cell: (p) => <QtyText value={p.sold} />,
    },
    {
      key: 'stock',
      header: t.products.col.stock,
      sortKey: 'stock',
      align: 'right',
      cell: (p) => (
        <span
          className={cn(
            'font-medium',
            compareQty(p.stock, '0') <= 0
              ? 'text-destructive'
              : p.isLowStock
                ? 'text-warning'
                : undefined,
          )}
        >
          <QtyText value={p.stock} unit={p.unit} />
          {/* Telefonda sotuv narxi shu yerda (alohida ustun sig'maydi) */}
          <MoneyText value={p.salePrice} className="block text-xs font-normal text-foreground sm:hidden" />
        </span>
      ),
    },
    {
      key: 'costPrice',
      header: t.products.col.costPrice,
      sortKey: 'costPrice',
      align: 'right',
      hideBelow: '2xl',
      cell: (p) => <MoneyText value={p.costPrice} muted />,
    },
    {
      key: 'salePrice',
      header: t.products.col.salePrice,
      sortKey: 'salePrice',
      align: 'right',
      hideBelow: 'sm',
      cell: (p) => <MoneyText value={p.salePrice} className="font-medium" />,
    },
    {
      key: 'status',
      header: t.products.col.status,
      hideBelow: 'sm',
      cell: (p) =>
        p.status === 'ACTIVE' && p.isLowStock ? (
          <StatusBadge status={compareQty(p.stock, '0') <= 0 ? 'outOfStock' : 'lowStock'} />
        ) : (
          <StatusBadge status={p.status} />
        ),
    },
    {
      key: 'actions',
      header: '',
      align: 'right',
      className: 'w-12',
      cell: (p) => (
        <div onClick={(e) => e.stopPropagation()}>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                variant="ghost"
                size="icon"
                className="size-8"
                aria-label={t.common.openActions}
              >
                <MoreHorizontal />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem onSelect={() => setDetailId(p.id)}>
                <Eye />
                {t.common.view}
              </DropdownMenuItem>
              <DropdownMenuItem onSelect={() => openEdit(p)}>
                <Pencil />
                {t.common.edit}
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              {p.status === 'ACTIVE' ? (
                <DropdownMenuItem variant="destructive" onSelect={() => setDeactivating(p)}>
                  <PowerOff />
                  {t.products.statusChange.deactivate}
                </DropdownMenuItem>
              ) : (
                <DropdownMenuItem onSelect={() => changeStatus(p, 'ACTIVE').catch(() => undefined)}>
                  <Power />
                  {t.products.statusChange.activate}
                </DropdownMenuItem>
              )}
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      ),
    },
  ];

  const columns = allColumns.filter(
    (c) => (c.key !== 'costPrice' || canReadCost) && (c.key !== 'actions' || canManage),
  );
  const filtered = list.activeFilterCount > 0;

  return (
    <>
      <PageHeader
        title={t.nav.products}
        description={t.products.description}
        actions={
          canManage ? (
            <Button onClick={openCreate}>
              <Plus />
              {t.products.add}
            </Button>
          ) : null
        }
      />

      <div className="flex flex-col gap-2 lg:flex-row lg:flex-wrap lg:items-center">
        <SearchInput
          value={list.search}
          onChange={list.setSearch}
          placeholder={t.products.searchPlaceholder}
          className="lg:w-80"
        />
        <FilterSelect
          value={list.filters.groupId}
          onChange={(v) => list.setFilter('groupId', v)}
          allLabel={t.products.allGroups}
          options={(groups ?? []).map((g) => ({ value: g.id, label: g.name }))}
        />
        <FilterSelect
          value={list.filters.warehouseId}
          onChange={(v) => list.setFilter('warehouseId', v)}
          allLabel={t.products.allWarehouses}
          options={(warehouses ?? []).map((w) => ({ value: w.id, label: w.name }))}
        />
        {canManage ? (
          <FilterSelect
            value={list.filters.status}
            onChange={(v) => list.setFilter('status', v)}
            allLabel={t.products.allStatuses}
            className="sm:w-40"
            options={[
              { value: 'ACTIVE', label: t.status.ACTIVE },
              { value: 'INACTIVE', label: t.status.INACTIVE },
            ]}
          />
        ) : null}
        <FilterSelect
          value={list.filters.stock}
          onChange={(v) => list.setFilter('stock', v)}
          allLabel={t.products.stockAll}
          className="sm:w-48"
          options={[
            { value: 'low', label: t.products.stockLow },
            { value: 'out', label: t.products.stockOut },
          ]}
        />
        {filtered ? (
          <Button variant="ghost" onClick={list.reset}>
            {t.common.clearFilters}
          </Button>
        ) : null}
      </div>

      <DataTable
        columns={columns}
        rows={data?.data}
        rowKey={(p) => p.id}
        isLoading={isPending || isFetching}
        error={error}
        onRetry={() => refetch()}
        sort={list.sort}
        onSortChange={list.setSort}
        onRowClick={(p) => setDetailId(p.id)}
        selectedKey={detailId}
        empty={
          filtered ? (
            <EmptyState
              icon={SearchX}
              title={t.products.noResults}
              description={t.table.noResultsHint}
              action={
                <Button variant="outline" onClick={list.reset}>
                  {t.common.clearFilters}
                </Button>
              }
            />
          ) : (
            <EmptyState
              icon={PackagePlus}
              title={t.products.emptyTitle}
              description={t.products.emptyDescription}
              action={
                canManage ? (
                  <Button onClick={openCreate}>
                    <Plus />
                    {t.products.add}
                  </Button>
                ) : undefined
              }
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

      <ProductFormDialog open={formOpen} onOpenChange={setFormOpen} product={editing} />
      <ProductDetailSheet
        productId={detailId}
        onOpenChange={(open) => !open && setDetailId(null)}
        onEdit={openEdit}
      />
      <ConfirmDialog
        open={Boolean(deactivating)}
        onOpenChange={(open) => !open && setDeactivating(null)}
        title={t.products.statusChange.deactivateTitle}
        description={t.products.statusChange.deactivateDescription}
        confirmLabel={t.products.statusChange.deactivate}
        destructive
        onConfirm={() => (deactivating ? changeStatus(deactivating, 'INACTIVE') : undefined)}
      />
    </>
  );
}
