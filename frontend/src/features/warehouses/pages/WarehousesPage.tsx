import { Permission } from '@divine/shared';
import {
  ArrowRight,
  Boxes,
  MapPin,
  Pencil,
  Plus,
  Power,
  PowerOff,
  SearchX,
  Warehouse,
} from 'lucide-react';
import { useState } from 'react';
import { Link } from 'react-router';
import { toast } from 'sonner';
import { useHasAnyPermission } from '@/features/session/hooks/use-permissions';
import { t } from '@/i18n/uz';
import { useListParams } from '@/shared/hooks/use-list-params';
import { formatCompactMoney, formatQuantity } from '@/shared/lib/format';
import { toastError } from '@/shared/lib/mutation';
import { ConfirmDialog } from '@/shared/components/ConfirmDialog';
import { DataPagination } from '@/shared/components/DataPagination';
import { EmptyState } from '@/shared/components/EmptyState';
import { ErrorState } from '@/shared/components/ErrorState';
import { FilterSelect } from '@/shared/components/FilterSelect';
import { PageHeader } from '@/shared/components/PageHeader';
import { SearchInput } from '@/shared/components/SearchInput';
import { StatusBadge } from '@/shared/components/StatusBadge';
import { Button } from '@/shared/ui/button';
import { Card } from '@/shared/ui/card';
import { Skeleton } from '@/shared/ui/skeleton';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/shared/ui/tooltip';
import type { WarehouseListItemDto } from '@/shared/types/api';
import { useSetWarehouseStatus, useWarehouseList } from '../api/warehouses';
import { WarehouseFormDialog } from '../components/WarehouseFormDialog';

function WarehouseCard({
  w,
  canManage,
  onEdit,
  onToggleStatus,
}: {
  w: WarehouseListItemDto;
  canManage: boolean;
  onEdit: () => void;
  onToggleStatus: () => void;
}) {
  const active = w.status === 'ACTIVE';
  return (
    <Card className="gap-0 overflow-hidden p-0 transition-shadow hover:shadow-md">
      <div className="flex items-start justify-between gap-3 p-4 sm:p-5">
        <div className="flex min-w-0 gap-3">
          <span className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
            <Warehouse className="size-5" />
          </span>
          <div className="min-w-0">
            <Link
              to={`/warehouses/${w.id}`}
              className="block truncate font-semibold hover:underline"
            >
              {w.name}
            </Link>
            {/* Telefonda manzil to'liq (qatorga o'tadi), keng ekranda — bir qatorda */}
            <p className="mt-0.5 flex items-start gap-1 text-xs text-muted-foreground sm:items-center sm:truncate">
              <MapPin className="mt-0.5 size-3 shrink-0 sm:mt-0" />
              <span className="sm:truncate">{w.address ?? t.common.notSet}</span>
            </p>
          </div>
        </div>
        <StatusBadge status={w.status} />
      </div>
      <div className="grid grid-cols-3 divide-x border-y bg-muted/30">
        <div className="p-3 sm:p-4">
          <p className="text-xs text-muted-foreground">{t.warehouses.productCount}</p>
          <p className="mt-1 text-base font-semibold tabular-nums sm:text-lg">{w.productCount ?? 0}</p>
        </div>
        <div className="p-3 sm:p-4">
          <p className="text-xs text-muted-foreground">{t.warehouses.totalStock}</p>
          <p className="mt-1 text-base font-semibold tabular-nums sm:text-lg">
            {formatQuantity(w.totalQuantity ?? '0')}
          </p>
        </div>
        <div className="p-3 sm:p-4">
          <p className="text-xs text-muted-foreground">{t.warehouses.lowStockCount}</p>
          <p
            className={`mt-1 text-base font-semibold tabular-nums sm:text-lg ${(w.lowStockCount ?? 0) > 0 ? 'text-warning' : ''}`}
          >
            {w.lowStockCount ?? 0}
          </p>
        </div>
      </div>
      {/* Telefonda qiymat va tugmalar ikki qatorda — aks holda tugma karta chetidan chiqadi */}
      <div className="flex flex-col gap-2 p-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="text-sm">
          {w.stockValue !== undefined ? (
            <>
              <span className="text-muted-foreground">{t.warehouses.stockValue}: </span>
              <span className="font-medium tabular-nums">{formatCompactMoney(w.stockValue)}</span>
            </>
          ) : null}
        </div>
        <div className="flex items-center justify-end gap-1">
          {canManage ? (
            <>
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="size-8"
                    onClick={onEdit}
                    aria-label={t.common.edit}
                  >
                    <Pencil />
                  </Button>
                </TooltipTrigger>
                <TooltipContent>{t.common.edit}</TooltipContent>
              </Tooltip>
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="size-8"
                    onClick={onToggleStatus}
                    aria-label={active ? t.warehouses.deactivate : t.warehouses.activate}
                  >
                    {active ? <PowerOff /> : <Power />}
                  </Button>
                </TooltipTrigger>
                <TooltipContent>
                  {active ? t.warehouses.deactivate : t.warehouses.activate}
                </TooltipContent>
              </Tooltip>
            </>
          ) : null}
          <Button asChild size="sm" variant="secondary">
            <Link to={`/warehouses/${w.id}`}>
              {t.warehouses.open}
              <ArrowRight />
            </Link>
          </Button>
        </div>
      </div>
    </Card>
  );
}

const CARD_PAGE_SIZES = [12, 24, 48, 96];
const CARD_PAGE_SIZE = 12;

export function WarehousesPage() {
  // Kartochkalar 1/2/3 ustunli to'rda — sahifa hajmi 2 va 3 ga bo'linadi (server-side pagination).
  const list = useListParams({
    defaultSort: 'createdAt:asc',
    defaultPageSize: CARD_PAGE_SIZE,
    filterKeys: ['status'] as const,
  });
  const { data, isPending, error, refetch } = useWarehouseList(list.query);
  const canManage = useHasAnyPermission([Permission.WAREHOUSES_MANAGE]);
  const setStatus = useSetWarehouseStatus();
  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<WarehouseListItemDto | null>(null);
  const [deactivating, setDeactivating] = useState<WarehouseListItemDto | null>(null);

  const changeStatus = async (w: WarehouseListItemDto, status: 'ACTIVE' | 'INACTIVE') => {
    try {
      await setStatus.mutateAsync({ id: w.id, status });
      toast.success(
        status === 'ACTIVE' ? t.warehouses.activatedToast : t.warehouses.deactivatedToast,
      );
    } catch (e) {
      toastError(e);
      throw e;
    }
  };

  const rows = data?.data;
  return (
    <>
      <PageHeader
        title={t.nav.warehouses}
        description={t.warehouses.description}
        actions={
          canManage ? (
            <Button
              onClick={() => {
                setEditing(null);
                setFormOpen(true);
              }}
            >
              <Plus />
              {t.warehouses.add}
            </Button>
          ) : null
        }
      />
      <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap">
        <SearchInput
          value={list.search}
          onChange={list.setSearch}
          placeholder={t.warehouses.searchPlaceholder}
        />
        <FilterSelect
          value={list.filters.status}
          onChange={(v) => list.setFilter('status', v)}
          allLabel={t.warehouses.allStatuses}
          options={[
            { value: 'ACTIVE', label: t.status.ACTIVE },
            { value: 'INACTIVE', label: t.status.INACTIVE },
          ]}
        />
      </div>
      {error ? (
        <ErrorState message={error.message} onRetry={() => refetch()} />
      ) : isPending || !rows ? (
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {Array.from({ length: 3 }, (_, i) => (
            <Skeleton key={i} className="h-56" />
          ))}
        </div>
      ) : rows.length === 0 ? (
        list.activeFilterCount ? (
          <EmptyState
            icon={SearchX}
            title={t.warehouses.noResults}
            description={t.table.noResultsHint}
          />
        ) : (
          <EmptyState icon={Boxes} title={t.warehouses.emptyList} />
        )
      ) : (
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {rows.map((w) => (
            <WarehouseCard
              key={w.id}
              w={w}
              canManage={canManage}
              onEdit={() => {
                setEditing(w);
                setFormOpen(true);
              }}
              onToggleStatus={() =>
                w.status === 'ACTIVE'
                  ? setDeactivating(w)
                  : void changeStatus(w, 'ACTIVE').catch(() => undefined)
              }
            />
          ))}
        </div>
      )}
      {rows && rows.length > 0 ? (
        <DataPagination
          meta={data?.meta}
          onPageChange={list.setPage}
          onPageSizeChange={list.setPageSize}
          pageSizes={CARD_PAGE_SIZES}
        />
      ) : null}
      <WarehouseFormDialog open={formOpen} onOpenChange={setFormOpen} warehouse={editing} />
      <ConfirmDialog
        open={deactivating !== null}
        onOpenChange={(open) => {
          if (!open) setDeactivating(null);
        }}
        title={t.warehouses.deactivateTitle}
        description={deactivating ? t.warehouses.deactivateDescription(deactivating.name) : ''}
        confirmLabel={t.warehouses.deactivate}
        destructive
        onConfirm={() => (deactivating ? changeStatus(deactivating, 'INACTIVE') : undefined)}
      />
    </>
  );
}
