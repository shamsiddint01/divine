import { CalendarClock, Pencil, Phone, Receipt, ShoppingBag, Wallet } from 'lucide-react';
import { Permission } from '@divine/shared';
import { useHasAnyPermission } from '@/features/session/hooks/use-permissions';
import { useState } from 'react';
import { useParams } from 'react-router';
import { SaleDetailSheet } from '@/features/sales/components/SaleDetailSheet';
import { t } from '@/i18n/uz';
import { useListParams } from '@/shared/hooks/use-list-params';
import { divideMoney } from '@/shared/lib/decimal';
import {
  formatCompactMoney,
  formatDate,
  formatDateTime,
  formatPhone,
  formatRelative,
  initials,
} from '@/shared/lib/format';
import { DataPagination } from '@/shared/components/DataPagination';
import { type Column, DataTable } from '@/shared/components/DataTable';
import { EmptyState } from '@/shared/components/EmptyState';
import { DetailErrorPage } from '@/shared/components/DetailErrorPage';
import { MoneyText } from '@/shared/components/MoneyText';
import { PageHeader } from '@/shared/components/PageHeader';
import { StatCard } from '@/shared/components/StatCard';
import { Avatar, AvatarFallback } from '@/shared/ui/avatar';
import { Button } from '@/shared/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/shared/ui/card';
import { Skeleton } from '@/shared/ui/skeleton';
import type { SaleDto } from '@/shared/types/api';
import { useCustomer, useCustomerPurchases } from '../api/customers';
import { CustomerFormDialog } from '../components/CustomerFormDialog';

export function CustomerDetailPage() {
  const { id = '' } = useParams();
  const { data: c, isPending, error, refetch } = useCustomer(id);
  const list = useListParams({ defaultSort: 'soldAt:desc', defaultPageSize: 10 });
  const purchases = useCustomerPurchases(id, list.query);
  const [editOpen, setEditOpen] = useState(false);
  const canManage = useHasAnyPermission([Permission.CUSTOMERS_MANAGE]);
  const [saleId, setSaleId] = useState<string | null>(null);

  if (error)
    return (
      <DetailErrorPage
        error={error}
        sectionLabel={t.nav.customers}
        sectionTo="/customers"
        onRetry={() => refetch()}
      />
    );

  const columns: Column<SaleDto>[] = [
    {
      key: 'number',
      header: t.sales.history.col.number,
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
      hideBelow: 'sm',
      cell: (s) => <span className="tabular-nums">{formatDateTime(s.soldAt)}</span>,
    },
    {
      key: 'items',
      header: t.sales.history.col.items,
      cell: (s) => (
        <span className="block max-w-80 text-muted-foreground sm:truncate">
          {s.items?.map((i) => i.productName).join(', ')}
        </span>
      ),
    },
    {
      key: 'warehouse',
      header: t.sales.history.col.warehouse,
      hideBelow: 'xl',
      cell: (s) => s.warehouse.name,
    },
    {
      key: 'total',
      header: t.sales.history.col.total,
      align: 'right',
      cell: (s) => <MoneyText value={s.totalAmount} className="font-medium" />,
    },
  ];

  return (
    <>
      <PageHeader
        breadcrumbs={[
          { label: t.nav.customers, to: '/customers' },
          { label: c?.name ?? t.common.loading },
        ]}
        title={c?.name ?? t.common.loading}
        actions={
          c && canManage ? (
            <Button variant="outline" onClick={() => setEditOpen(true)}>
              <Pencil />
              {t.common.edit}
            </Button>
          ) : null
        }
      />
      <div className="grid gap-4 lg:grid-cols-[320px_minmax(0,1fr)]">
        <Card className="gap-4">
          <CardHeader>
            <CardTitle>{t.customers.detail.info}</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            {isPending || !c ? (
              <Skeleton className="h-40 w-full" />
            ) : (
              <>
                <div className="flex items-center gap-3">
                  <Avatar className="size-12">
                    <AvatarFallback className="bg-primary/10 text-base text-primary">
                      {initials(c.name)}
                    </AvatarFallback>
                  </Avatar>
                  <div>
                    <p className="font-semibold">{c.name}</p>
                    <p className="flex items-center gap-1 text-sm text-muted-foreground tabular-nums">
                      <Phone className="size-3.5" />
                      {formatPhone(c.phone)}
                    </p>
                  </div>
                </div>
                <dl className="space-y-2 text-sm">
                  <div className="flex justify-between gap-2">
                    <dt className="text-muted-foreground">{t.customers.detail.firstSeen}</dt>
                    <dd className="tabular-nums">
                      {c.createdAt ? formatDate(c.createdAt) : t.common.notSet}
                    </dd>
                  </div>
                  <div className="flex justify-between gap-2">
                    <dt className="text-muted-foreground">{t.customers.detail.lastPurchase}</dt>
                    <dd>
                      {c.lastPurchaseAt ? formatRelative(c.lastPurchaseAt) : t.customers.never}
                    </dd>
                  </div>
                </dl>
                {c.notes ? <p className="rounded-md bg-muted/50 p-3 text-sm">{c.notes}</p> : null}
              </>
            )}
          </CardContent>
        </Card>
        <div className="grid content-start gap-4 sm:grid-cols-3">
          <StatCard
            label={t.customers.detail.totalSpent}
            icon={Wallet}
            tone="success"
            loading={isPending}
            value={c ? formatCompactMoney(c.totalSpent ?? '0') : null}
          />
          <StatCard
            label={t.customers.detail.purchaseCount}
            icon={ShoppingBag}
            loading={isPending}
            value={c?.purchaseCount ?? null}
          />
          <StatCard
            label={t.customers.detail.averageCheck}
            icon={Receipt}
            tone="info"
            loading={isPending}
            value={
              c ? formatCompactMoney(divideMoney(c.totalSpent ?? '0', c.purchaseCount ?? 0)) : null
            }
          />
        </div>
      </div>
      <section className="space-y-3">
        <h2 className="flex items-center gap-2 text-base font-semibold sm:text-lg">
          <CalendarClock className="size-5 text-muted-foreground" />
          {t.customers.detail.history}
        </h2>
        <DataTable
          columns={columns}
          rows={purchases.data?.data}
          rowKey={(s) => s.id}
          isLoading={purchases.isPending || purchases.isFetching}
          error={purchases.error}
          onRetry={() => purchases.refetch()}
          onRowClick={(s) => setSaleId(s.id)}
          skeletonRows={5}
          empty={<EmptyState icon={ShoppingBag} title={t.customers.detail.noPurchases} />}
          footer={<DataPagination meta={purchases.data?.meta} onPageChange={list.setPage} />}
        />
      </section>
      <CustomerFormDialog open={editOpen} onOpenChange={setEditOpen} customer={c} />
      <SaleDetailSheet saleId={saleId} onClose={() => setSaleId(null)} />
    </>
  );
}
