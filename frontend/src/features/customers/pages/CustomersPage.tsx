import { ChevronRight, Plus, SearchX, UserRound } from 'lucide-react';
import { Permission } from '@divine/shared';
import { useHasAnyPermission } from '@/features/session/hooks/use-permissions';
import { useState } from 'react';
import { useNavigate } from 'react-router';
import { t } from '@/i18n/uz';
import { useListParams } from '@/shared/hooks/use-list-params';
import { formatPhone, formatRelative, initials } from '@/shared/lib/format';
import { DataPagination } from '@/shared/components/DataPagination';
import { type Column, DataTable } from '@/shared/components/DataTable';
import { EmptyState } from '@/shared/components/EmptyState';
import { MoneyText } from '@/shared/components/MoneyText';
import { PageHeader } from '@/shared/components/PageHeader';
import { SearchInput } from '@/shared/components/SearchInput';
import { Avatar, AvatarFallback } from '@/shared/ui/avatar';
import { Button } from '@/shared/ui/button';
import type { CustomerDto } from '@/shared/types/api';
import { useCustomers } from '../api/customers';
import { CustomerFormDialog } from '../components/CustomerFormDialog';

export function CustomersPage() {
  const navigate = useNavigate();
  const list = useListParams({ defaultSort: 'lastPurchaseAt:desc' });
  const { data, isPending, isFetching, error, refetch } = useCustomers(list.query);
  const canCreate = useHasAnyPermission([Permission.CUSTOMERS_CREATE]);
  const [formOpen, setFormOpen] = useState(false);

  const columns: Column<CustomerDto>[] = [
    {
      key: 'name',
      header: t.customers.col.name,
      sortKey: 'name',
      cell: (c) => (
        <div className="flex items-center gap-3">
          <Avatar className="size-8">
            <AvatarFallback className="bg-primary/10 text-primary">
              {initials(c.name)}
            </AvatarFallback>
          </Avatar>
          <span className="block max-w-64 truncate font-medium" title={c.name}>
            {c.name}
          </span>
        </div>
      ),
    },
    {
      key: 'phone',
      header: t.customers.col.phone,
      hideBelow: 'sm',
      cell: (c) => <span className="tabular-nums">{formatPhone(c.phone)}</span>,
    },
    {
      key: 'purchaseCount',
      header: t.customers.col.purchaseCount,
      sortKey: 'purchaseCount',
      align: 'right',
      hideBelow: 'xl',
      cell: (c) => <span className="tabular-nums">{c.purchaseCount ?? 0}</span>,
    },
    {
      key: 'totalSpent',
      header: t.customers.col.totalSpent,
      sortKey: 'totalSpent',
      align: 'right',
      cell: (c) => <MoneyText value={c.totalSpent} className="font-medium" />,
    },
    {
      key: 'lastPurchaseAt',
      header: t.customers.col.lastPurchase,
      sortKey: 'lastPurchaseAt',
      hideBelow: 'xl',
      cell: (c) => (
        <span className="text-muted-foreground">
          {c.lastPurchaseAt ? formatRelative(c.lastPurchaseAt) : t.customers.never}
        </span>
      ),
    },
    {
      key: 'open',
      header: '',
      align: 'right',
      className: 'w-28',
      hideBelow: 'xl',
      cell: () => (
        <span className="inline-flex items-center gap-1 text-sm text-primary">
          {t.common.details}
          <ChevronRight className="size-4" />
        </span>
      ),
    },
  ];

  return (
    <>
      <PageHeader
        title={t.nav.customers}
        description={t.customers.description}
        actions={
          canCreate ? (
            <Button onClick={() => setFormOpen(true)}>
              <Plus />
              {t.customers.add}
            </Button>
          ) : null
        }
      />
      <SearchInput
        value={list.search}
        onChange={list.setSearch}
        placeholder={t.customers.searchPlaceholder}
      />
      <DataTable
        columns={columns}
        rows={data?.data}
        rowKey={(c) => c.id}
        isLoading={isPending || isFetching}
        error={error}
        onRetry={() => refetch()}
        sort={list.sort}
        onSortChange={list.setSort}
        onRowClick={(c) => navigate(`/customers/${c.id}`)}
        empty={
          list.search ? (
            <EmptyState
              icon={SearchX}
              title={t.customers.noResults}
              description={t.table.noResultsHint}
            />
          ) : (
            <EmptyState
              icon={UserRound}
              title={t.customers.emptyTitle}
              description={t.customers.emptyDescription}
              action={
                canCreate ? (
                  <Button onClick={() => setFormOpen(true)}>
                    <Plus />
                    {t.customers.add}
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
      <CustomerFormDialog open={formOpen} onOpenChange={setFormOpen} />
    </>
  );
}
