import { AlertTriangle, BellRing, HandCoins, Plus, SearchX, Users } from 'lucide-react';
import { useState } from 'react';
import type { CreditDto } from '@divine/shared';
import { t } from '@/i18n/uz';
import { DataPagination } from '@/shared/components/DataPagination';
import { type Column, DataTable } from '@/shared/components/DataTable';
import { EmptyState } from '@/shared/components/EmptyState';
import { FilterBar } from '@/shared/components/FilterBar';
import { FilterSelect } from '@/shared/components/FilterSelect';
import { MoneyText } from '@/shared/components/MoneyText';
import { PageHeader } from '@/shared/components/PageHeader';
import { SearchInput } from '@/shared/components/SearchInput';
import { StatCard } from '@/shared/components/StatCard';
import { useListParams } from '@/shared/hooks/use-list-params';
import { formatCompactMoney, formatDate, formatDateTime, formatMoney } from '@/shared/lib/format';
import { Button } from '@/shared/ui/button';
import { useCreditReminders, useCredits } from '../api/credits';
import { CreditDetailSheet } from '../components/CreditDetailSheet';
import { CreditFormDialog } from '../components/CreditFormDialog';
import { CreditStatusBadge } from '../components/CreditStatusBadge';

/** Nasiya (D-24): faqat `credits.manage` (ADMIN) — bo'lim sotuvchiga ko'rinmaydi, server ham `403`. */
export function CreditsPage() {
  const list = useListParams({
    defaultSort: 'next:asc',
    filterKeys: ['status'] as const,
  });
  const { data, isPending, isFetching, error, refetch } = useCredits(list.query);
  const { data: reminders } = useCreditReminders();
  const [formOpen, setFormOpen] = useState(false);
  const [openId, setOpenId] = useState<string | null>(null);

  const columns: Column<CreditDto>[] = [
    {
      key: 'debtor',
      header: t.credits.col.debtor,
      cell: (c) => (
        <div className="min-w-0">
          <p className="truncate font-medium">{c.debtorName}</p>
          <p className="text-xs text-muted-foreground">
            {c.number}
            {c.debtorPhone ? ` · ${c.debtorPhone}` : ''}
          </p>
        </div>
      ),
    },
    {
      key: 'takenAt',
      header: t.credits.col.takenAt,
      sortKey: 'takenAt',
      hideBelow: 'lg',
      cell: (c) => <span className="tabular-nums">{formatDateTime(c.takenAt)}</span>,
    },
    {
      key: 'amount',
      header: t.credits.col.amount,
      align: 'right',
      hideBelow: 'xl',
      cell: (c) => <MoneyText value={c.amount} />,
    },
    {
      key: 'remaining',
      header: t.credits.col.remaining,
      sortKey: 'remainingAmount',
      align: 'right',
      cell: (c) => <MoneyText value={c.remainingAmount} className="font-medium" />,
    },
    {
      key: 'next',
      header: t.credits.col.next,
      sortKey: 'next',
      hideBelow: 'sm',
      cell: (c) =>
        c.next ? (
          <div>
            <p className="tabular-nums">{formatDate(c.next.dueDate)}</p>
            <MoneyText value={c.next.amount} className="text-xs text-muted-foreground" />
          </div>
        ) : (
          <span className="text-muted-foreground">{t.common.notSet}</span>
        ),
    },
    {
      key: 'status',
      header: t.credits.col.status,
      hideBelow: 'sm',
      cell: (c) => <CreditStatusBadge status={c.status} />,
    },
  ];

  const addButton = (
    <Button onClick={() => setFormOpen(true)}>
      <Plus />
      {t.credits.add}
    </Button>
  );

  return (
    <>
      <PageHeader title={t.nav.credits} description={t.credits.description} actions={addButton} />

      {reminders && reminders.length > 0 ? (
        <section
          aria-label={t.credits.reminders.title}
          className="rounded-xl border border-warning/30 bg-warning/5 p-3 sm:p-4"
        >
          <h2 className="flex items-center gap-2 text-sm font-semibold">
            <BellRing className="size-4 text-warning" aria-hidden />
            {t.credits.reminders.title}
          </h2>
          <ul className="mt-2 space-y-1">
            {reminders.map((r) => (
              <li key={r.creditId}>
                <button
                  type="button"
                  className="text-left text-sm hover:underline"
                  onClick={() => setOpenId(r.creditId)}
                >
                  {t.credits.reminders.item(
                    r.debtorName,
                    formatDate(r.dueDate),
                    formatMoney(r.amount),
                  )}
                </button>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 sm:gap-4">
        <StatCard
          className="col-span-2 sm:col-span-1"
          label={t.credits.summary.remaining}
          icon={HandCoins}
          loading={isPending}
          value={data ? formatCompactMoney(data.summary.remainingAmount) : null}
        />
        <StatCard
          label={t.credits.summary.active}
          icon={Users}
          tone="info"
          loading={isPending}
          value={data ? String(data.summary.activeCount) : null}
        />
        <StatCard
          label={t.credits.summary.overdue}
          icon={AlertTriangle}
          tone="warning"
          loading={isPending}
          value={data ? String(data.summary.overdueCount) : null}
        />
      </div>

      <FilterBar
        search={
          <SearchInput
            value={list.search}
            onChange={list.setSearch}
            placeholder={t.credits.searchPlaceholder}
          />
        }
        active={list.activeFilterCount > (list.search ? 1 : 0)}
      >
        <FilterSelect
          value={list.filters.status}
          onChange={(v) => list.setFilter('status', v)}
          allLabel={t.credits.allStatuses}
          options={(['ACTIVE', 'OVERDUE', 'PAID'] as const).map((s) => ({
            value: s,
            label: t.credits.status[s],
          }))}
        />
      </FilterBar>

      <DataTable
        columns={columns}
        rows={data?.data}
        rowKey={(c) => c.id}
        isLoading={isPending || isFetching}
        error={error}
        onRetry={() => refetch()}
        sort={list.sort}
        onSortChange={list.setSort}
        onRowClick={(c) => setOpenId(c.id)}
        empty={
          list.activeFilterCount ? (
            <EmptyState
              icon={SearchX}
              title={t.table.noResults}
              description={t.table.noResultsHint}
            />
          ) : (
            <EmptyState
              icon={HandCoins}
              title={t.credits.emptyTitle}
              description={t.credits.emptyDescription}
              action={addButton}
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

      <CreditFormDialog open={formOpen} onOpenChange={setFormOpen} />
      <CreditDetailSheet creditId={openId} onOpenChange={(open) => !open && setOpenId(null)} />
    </>
  );
}
