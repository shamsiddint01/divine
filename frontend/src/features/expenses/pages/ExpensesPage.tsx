import { MoreHorizontal, Pencil, Plus, SearchX, Tags, Trash2, Wallet } from 'lucide-react';
import { useState } from 'react';
import { toast } from 'sonner';
import { t } from '@/i18n/uz';
import { useListParams } from '@/shared/hooks/use-list-params';
import { formatCompactMoney, formatDate } from '@/shared/lib/format';
import { toastError } from '@/shared/lib/mutation';
import { ConfirmDialog } from '@/shared/components/ConfirmDialog';
import { DataPagination } from '@/shared/components/DataPagination';
import { type Column, DataTable } from '@/shared/components/DataTable';
import { DateRangeFilter } from '@/shared/components/DateRangeFilter';
import { EmptyState } from '@/shared/components/EmptyState';
import { FilterBar } from '@/shared/components/FilterBar';
import { FilterSelect } from '@/shared/components/FilterSelect';
import { MoneyText } from '@/shared/components/MoneyText';
import { PageHeader } from '@/shared/components/PageHeader';
import { SearchInput } from '@/shared/components/SearchInput';
import { StatCard } from '@/shared/components/StatCard';
import { Badge } from '@/shared/ui/badge';
import { Button } from '@/shared/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/shared/ui/dropdown-menu';
import type { ExpenseDto } from '@/shared/types/api';
import { Permission } from '@divine/shared';
import { useHasAnyPermission } from '@/features/session/hooks/use-permissions';
import { useDeleteExpense, useExpenseCategories, useExpenses } from '../api/expenses';
import { ExpenseCategoriesDialog } from '../components/ExpenseCategoriesDialog';
import { ExpenseFormDialog } from '../components/ExpenseFormDialog';

/**
 * `expenses.read` — to'liq ro'yxat (admin); tahrirlash, o'chirish va kategoriyalar — `expenses.manage`.
 * Faqat `expenses.create` (sotuvchi, D-12) — faqat yangi xarajat qo'shish: ro'yxat, summalar, tahrirlash
 * va o'chirish ko'rinmaydi (so'rov ham yuborilmaydi). Kategoriya majburiy (D-19): faol kategoriya
 * bo'lmasa, xarajat qo'shib bo'lmaydi va sahifa buni tushuntiradi.
 */
export function ExpensesPage() {
  const canRead = useHasAnyPermission([Permission.EXPENSES_READ]);
  return canRead ? <ExpensesRegister /> : <ExpenseCreateOnly />;
}

function ExpenseCreateOnly() {
  const [formOpen, setFormOpen] = useState(false);
  const { data: categories } = useExpenseCategories();
  const noCategories = categories !== undefined && categories.length === 0;
  const addButton = (
    <Button onClick={() => setFormOpen(true)} disabled={!categories || noCategories}>
      <Plus />
      {t.expenses.add}
    </Button>
  );
  return (
    <>
      <PageHeader
        title={t.nav.expenses}
        description={t.expenses.createOnly.description}
        actions={addButton}
      />
      <div className="rounded-xl border bg-card">
        {noCategories ? (
          <EmptyState
            icon={Tags}
            title={t.expenses.createOnly.noCategoriesTitle}
            description={t.expenses.createOnly.noCategoriesHint}
          />
        ) : (
          <EmptyState
            icon={Wallet}
            title={t.expenses.createOnly.title}
            description={t.expenses.createOnly.hint}
            action={addButton}
          />
        )}
      </div>
      <ExpenseFormDialog open={formOpen} onOpenChange={setFormOpen} />
    </>
  );
}

function ExpensesRegister() {
  const list = useListParams({
    defaultSort: 'date:desc',
    filterKeys: ['categoryId', 'dateFrom', 'dateTo'] as const,
  });
  const { data, isPending, isFetching, error, refetch } = useExpenses(list.query);
  const { data: categories } = useExpenseCategories();
  const remove = useDeleteExpense();
  const canManage = useHasAnyPermission([Permission.EXPENSES_MANAGE]);
  const [categoriesOpen, setCategoriesOpen] = useState(false);
  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<ExpenseDto | null>(null);
  const [deleting, setDeleting] = useState<ExpenseDto | null>(null);

  const openCreate = () => {
    setEditing(null);
    setFormOpen(true);
  };

  const columns: Column<ExpenseDto>[] = [
    {
      key: 'date',
      header: t.expenses.col.date,
      sortKey: 'date',
      hideBelow: 'sm',
      cell: (e) => <span className="tabular-nums">{formatDate(e.date)}</span>,
    },
    {
      key: 'category',
      header: t.expenses.col.category,
      cell: (e) => (
        <div>
          <Badge variant="outline" className="max-w-full whitespace-normal">
            {e.category.name}
          </Badge>
          {/* Telefonda sana shu yerda (alohida ustun sig'maydi) */}
          <p className="mt-0.5 text-xs text-muted-foreground sm:hidden tabular-nums">
            {formatDate(e.date)}
          </p>
        </div>
      ),
    },
    {
      key: 'note',
      header: t.expenses.col.note,
      hideBelow: 'xl',
      cell: (e) => (
        <span className="block max-w-80 truncate text-muted-foreground">
          {e.note ?? t.common.notSet}
        </span>
      ),
    },
    {
      key: 'amount',
      header: t.expenses.col.amount,
      sortKey: 'amount',
      align: 'right',
      cell: (e) => <MoneyText value={e.amount} className="font-medium" />,
    },
    {
      key: 'by',
      header: t.expenses.col.createdBy,
      hideBelow: '2xl',
      cell: (e) => (
        <span className="text-muted-foreground">{e.createdBy.fullName ?? e.createdBy.login}</span>
      ),
    },
  ];
  if (canManage) {
    columns.push({
      key: 'actions',
      header: '',
      align: 'right',
      className: 'w-12',
      cell: (e) => (
        <div onClick={(ev) => ev.stopPropagation()}>
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
              <DropdownMenuItem
                onSelect={() => {
                  setEditing(e);
                  setFormOpen(true);
                }}
              >
                <Pencil />
                {t.common.edit}
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem variant="destructive" onSelect={() => setDeleting(e)}>
                <Trash2 />
                {t.common.delete}
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      ),
    });
  }

  return (
    <>
      <PageHeader
        title={t.nav.expenses}
        description={t.expenses.description}
        actions={
          <>
            {canManage ? (
              <Button variant="outline" onClick={() => setCategoriesOpen(true)}>
                <Tags />
                {t.expenses.categories.open}
              </Button>
            ) : null}
            <Button onClick={openCreate}>
              <Plus />
              {t.expenses.add}
            </Button>
          </>
        }
      />
      <div className="grid gap-4 sm:grid-cols-3">
        <StatCard
          label={t.expenses.summary.total}
          icon={Wallet}
          loading={isPending}
          value={data ? formatCompactMoney(data.summary.totalAmount) : null}
          hint={data ? t.common.items(data.summary.count) : null}
        />
      </div>
      <FilterBar
        search={
          <SearchInput
            value={list.search}
            onChange={list.setSearch}
            placeholder={t.expenses.searchPlaceholder}
          />
        }
        active={list.activeFilterCount > (list.search ? 1 : 0)}
      >
        <DateRangeFilter
          value={{ from: list.filters.dateFrom, to: list.filters.dateTo }}
          onChange={(r) => {
            list.setFilter('dateFrom', r.from);
            list.setFilter('dateTo', r.to);
          }}
        />
        <FilterSelect
          value={list.filters.categoryId}
          onChange={(v) => list.setFilter('categoryId', v)}
          allLabel={t.expenses.allCategories}
          options={(categories ?? []).map((c) => ({
            value: c.id,
            label:
              c.isActive === false ? `${c.name} ${t.expenses.categories.inactiveSuffix}` : c.name,
          }))}
        />
        {list.activeFilterCount > 0 ? (
          <Button variant="ghost" onClick={list.reset}>
            {t.common.clearFilters}
          </Button>
        ) : null}
      </FilterBar>
      <DataTable
        columns={columns}
        rows={data?.data}
        rowKey={(e) => e.id}
        isLoading={isPending || isFetching}
        error={error}
        onRetry={() => refetch()}
        sort={list.sort}
        onSortChange={list.setSort}
        onRowClick={
          canManage
            ? (e) => {
                setEditing(e);
                setFormOpen(true);
              }
            : undefined
        }
        empty={
          list.activeFilterCount ? (
            <EmptyState
              icon={SearchX}
              title={t.table.noResults}
              description={t.table.noResultsHint}
            />
          ) : (
            <EmptyState
              icon={Wallet}
              title={t.expenses.emptyTitle}
              description={t.expenses.emptyDescription}
              action={
                <Button onClick={openCreate}>
                  <Plus />
                  {t.expenses.add}
                </Button>
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
      <ExpenseFormDialog open={formOpen} onOpenChange={setFormOpen} expense={editing} />
      {canManage ? (
        <ExpenseCategoriesDialog open={categoriesOpen} onOpenChange={setCategoriesOpen} />
      ) : null}
      <ConfirmDialog
        open={Boolean(deleting)}
        onOpenChange={(open) => !open && setDeleting(null)}
        title={t.expenses.deleteTitle}
        description={t.expenses.deleteDescription}
        confirmLabel={t.common.delete}
        destructive
        onConfirm={async () => {
          if (!deleting) return;
          try {
            await remove.mutateAsync(deleting.id);
            toast.success(t.expenses.deleted);
          } catch (e) {
            toastError(e);
            throw e;
          }
        }}
      />
    </>
  );
}
