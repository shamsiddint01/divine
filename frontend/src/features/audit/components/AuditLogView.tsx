import { ArrowRight, Loader2, ScrollText, SearchX } from 'lucide-react';
import { useMemo, useState } from 'react';
import { AUDIT_ACTIONS, AUDIT_ENTITY_TYPES } from '@divine/shared';
import { useExpenseCategories } from '@/features/expenses/api/expenses';
import { useGroupOptions } from '@/features/product-groups/api/groups';
import { useUserOptions } from '@/features/users/api/users';
import { useWarehouses } from '@/features/warehouses/api/warehouses';
import { t } from '@/i18n/uz';
import { useListParams } from '@/shared/hooks/use-list-params';
import { ApiError } from '@/shared/lib/api-client';
import { formatDateTime } from '@/shared/lib/format';
import { type Column, DataTable } from '@/shared/components/DataTable';
import { DateRangeFilter } from '@/shared/components/DateRangeFilter';
import { EmptyState } from '@/shared/components/EmptyState';
import { FilterBar } from '@/shared/components/FilterBar';
import { FilterSelect } from '@/shared/components/FilterSelect';
import { SearchInput } from '@/shared/components/SearchInput';
import { Badge } from '@/shared/ui/badge';
import { Button } from '@/shared/ui/button';
import { Card } from '@/shared/ui/card';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/shared/ui/dialog';
import type { AuditLogDto } from '@/shared/types/api';
import { useAuditLogs } from '../api/audit';
import { type AuditLookups, describeMetadata, type MetadataLine } from '../lib/metadata';

const FILTER_KEYS = ['dateFrom', 'dateTo', 'action', 'entityType', 'actorId'] as const;

const actionLabel = (action: string) =>
  (t.audit.actions as Record<string, string>)[action] ?? action;
const entityLabel = (type: string) => (t.audit.entities as Record<string, string>)[type] ?? type;
const actorName = (entry: AuditLogDto) =>
  entry.actor ? (entry.actor.fullName ?? entry.actor.login) : t.audit.system;

function useLookups(): AuditLookups {
  const { data: warehouses } = useWarehouses();
  const { data: users } = useUserOptions();
  const { data: groups } = useGroupOptions();
  const { data: categories } = useExpenseCategories();
  return useMemo(
    () => ({
      warehouse: new Map((warehouses ?? []).map((w) => [w.id, w.name])),
      user: new Map((users ?? []).map((u) => [u.id, u.fullName ?? u.login])),
      group: new Map((groups ?? []).map((g) => [g.id, g.name])),
      category: new Map((categories ?? []).map((c) => [c.id, c.name])),
    }),
    [warehouses, users, groups, categories],
  );
}

function MetadataList({ lines }: { lines: MetadataLine[] }) {
  return (
    <dl className="space-y-1.5 text-sm">
      {lines.map((line) => (
        <div key={line.key}>
          <div className="flex flex-wrap items-baseline gap-x-2">
            <dt className="text-muted-foreground">{line.label}:</dt>
            {line.change ? (
              <dd className="flex flex-wrap items-center gap-1.5 break-all">
                <span className="text-muted-foreground line-through decoration-1">
                  {line.change.from}
                </span>
                <ArrowRight className="size-3.5 shrink-0" aria-label={t.audit.keys.to} />
                <span className="font-medium">{line.change.to}</span>
              </dd>
            ) : line.value !== undefined ? (
              <dd className="font-medium break-all">{line.value}</dd>
            ) : null}
          </div>
          {line.children ? (
            <div className="mt-1.5 border-l pl-3">
              <MetadataList lines={line.children} />
            </div>
          ) : null}
        </div>
      ))}
    </dl>
  );
}

function AuditDetails({
  entry,
  lookups,
  onClose,
}: {
  entry: AuditLogDto | null;
  lookups: AuditLookups;
  onClose: () => void;
}) {
  const lines = entry ? describeMetadata(entry.metadata, lookups) : [];
  return (
    <Dialog open={entry !== null} onOpenChange={(open) => (open ? null : onClose())}>
      <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-lg">
        {entry ? (
          <>
            <DialogHeader>
              <DialogTitle>{actionLabel(entry.action)}</DialogTitle>
              <DialogDescription>
                {formatDateTime(entry.occurredAt)} · {actorName(entry)}
              </DialogDescription>
            </DialogHeader>
            <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1.5 text-sm">
              <dt className="text-muted-foreground">{t.audit.col.entity}:</dt>
              <dd>{entityLabel(entry.entityType)}</dd>
              {entry.entityId ? (
                <>
                  <dt className="text-muted-foreground">{t.audit.entityId}:</dt>
                  <dd className="font-mono text-xs break-all">{entry.entityId}</dd>
                </>
              ) : null}
              <dt className="text-muted-foreground">{t.audit.col.ip}:</dt>
              <dd className="tabular-nums">{entry.ip ?? t.common.notSet}</dd>
              {entry.requestId ? (
                <>
                  <dt className="text-muted-foreground">{t.audit.requestId}:</dt>
                  <dd className="font-mono text-xs break-all">{entry.requestId}</dd>
                </>
              ) : null}
            </dl>
            <div className="border-t pt-3">
              {lines.length > 0 ? (
                <MetadataList lines={lines} />
              ) : (
                <p className="text-sm text-muted-foreground">{t.audit.noDetails}</p>
              )}
            </div>
          </>
        ) : null}
      </DialogContent>
    </Dialog>
  );
}

/**
 * Audit jurnali (Phase 13, API §15): faqat o'qish, yangilari birinchi, cursor pagination.
 * Tafsilotlar — umumiy kalit/qiymat ko'rinishida (o'zgarishlar "oldin → keyin").
 */
export function AuditLogView() {
  const list = useListParams({ defaultSort: '', filterKeys: FILTER_KEYS, prefix: 'a' });
  const filters = {
    ...Object.fromEntries(FILTER_KEYS.map((key) => [key, list.filters[key] || undefined])),
    entityId: list.search || undefined,
  };
  const {
    data,
    error,
    isPending,
    isFetching,
    refetch,
    fetchNextPage,
    hasNextPage,
    isFetchingNextPage,
  } = useAuditLogs(filters);
  const lookups = useLookups();
  const { data: users } = useUserOptions();
  const [selected, setSelected] = useState<AuditLogDto | null>(null);
  const rows = data?.pages.flatMap((page) => page.data);

  const columns: Column<AuditLogDto>[] = [
    {
      key: 'occurredAt',
      header: t.audit.col.occurredAt,
      cell: (e) => (
        <span className="tabular-nums sm:whitespace-nowrap">{formatDateTime(e.occurredAt)}</span>
      ),
    },
    {
      key: 'actor',
      header: t.audit.col.actor,
      cell: (e) => (
        <span className={e.actor ? 'font-medium' : 'text-muted-foreground'}>{actorName(e)}</span>
      ),
    },
    { key: 'action', header: t.audit.col.action, cell: (e) => actionLabel(e.action) },
    {
      key: 'entity',
      header: t.audit.col.entity,
      hideBelow: 'md',
      cell: (e) => <Badge variant="secondary">{entityLabel(e.entityType)}</Badge>,
    },
    {
      key: 'ip',
      header: t.audit.col.ip,
      hideBelow: 'lg',
      cell: (e) => (
        <span className="text-muted-foreground tabular-nums">{e.ip ?? t.common.notSet}</span>
      ),
    },
  ];

  const tableError =
    error instanceof ApiError && error.details[0]?.message
      ? new Error(error.details[0].message)
      : error;

  return (
    <div className="space-y-4">
      <Card className="gap-3 p-4 sm:p-4">
        <div className="flex items-start gap-3">
          <span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
            <ScrollText className="size-[18px]" />
          </span>
          <div className="space-y-0.5">
            <h2 className="font-semibold">{t.audit.title}</h2>
            <p className="text-sm text-muted-foreground">{t.audit.description}</p>
          </div>
        </div>
        <FilterBar
          search={
            <SearchInput
              value={list.search}
              onChange={list.setSearch}
              placeholder={t.audit.filters.entityId}
              className="sm:w-56"
            />
          }
          active={list.activeFilterCount > (list.search ? 1 : 0)}
        >
          <DateRangeFilter
            value={{ from: list.filters.dateFrom, to: list.filters.dateTo }}
            onChange={(r) => {
              list.setFilter('dateFrom', r.from ?? '');
              list.setFilter('dateTo', r.to ?? '');
            }}
          />
          <FilterSelect
            value={list.filters.action}
            onChange={(v) => list.setFilter('action', v)}
            allLabel={t.audit.filters.allActions}
            options={AUDIT_ACTIONS.map((a) => ({ value: a, label: actionLabel(a) }))}
            className="sm:w-60"
          />
          <FilterSelect
            value={list.filters.entityType}
            onChange={(v) => list.setFilter('entityType', v)}
            allLabel={t.audit.filters.allEntities}
            options={AUDIT_ENTITY_TYPES.map((e) => ({ value: e, label: entityLabel(e) }))}
          />
          <FilterSelect
            value={list.filters.actorId}
            onChange={(v) => list.setFilter('actorId', v)}
            allLabel={t.audit.filters.allUsers}
            options={(users ?? []).map((u) => ({ value: u.id, label: u.fullName ?? u.login }))}
            className="sm:w-56"
          />
          {list.activeFilterCount > 0 ? (
            <Button variant="ghost" onClick={list.reset}>
              {t.common.clearFilters}
            </Button>
          ) : null}
        </FilterBar>
      </Card>

      <DataTable
        columns={columns}
        rows={rows}
        rowKey={(e) => e.id}
        isLoading={isPending || (isFetching && !isFetchingNextPage)}
        error={tableError}
        onRetry={() => refetch()}
        onRowClick={setSelected}
        selectedKey={selected?.id ?? null}
        empty={
          list.activeFilterCount > 0 ? (
            <EmptyState icon={SearchX} title={t.audit.empty} description={t.table.noResultsHint} />
          ) : (
            <EmptyState icon={ScrollText} title={t.audit.emptyJournal} />
          )
        }
        footer={
          rows && rows.length > 0 ? (
            <div className="flex flex-wrap items-center justify-between gap-2 px-4 py-3 text-sm text-muted-foreground">
              <span>{t.audit.shown(rows.length)}</span>
              {hasNextPage ? (
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => fetchNextPage()}
                  disabled={isFetchingNextPage}
                >
                  {isFetchingNextPage ? <Loader2 className="animate-spin" /> : null}
                  {t.audit.loadMore}
                </Button>
              ) : (
                <span>{t.audit.end}</span>
              )}
            </div>
          ) : null
        }
      />

      <AuditDetails entry={selected} lookups={lookups} onClose={() => setSelected(null)} />
    </div>
  );
}
