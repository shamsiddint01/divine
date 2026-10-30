import { Archive, ArchiveRestore, FolderPlus, Pencil, Plus, SearchX, Trash2 } from 'lucide-react';
import { useState } from 'react';
import { Link } from 'react-router';
import { toast } from 'sonner';
import { t } from '@/i18n/uz';
import { useListParams } from '@/shared/hooks/use-list-params';
import { formatDate } from '@/shared/lib/format';
import { toastError } from '@/shared/lib/mutation';
import { ConfirmDialog } from '@/shared/components/ConfirmDialog';
import { DataPagination } from '@/shared/components/DataPagination';
import { type Column, DataTable } from '@/shared/components/DataTable';
import { EmptyState } from '@/shared/components/EmptyState';
import { PageHeader } from '@/shared/components/PageHeader';
import { SearchInput } from '@/shared/components/SearchInput';
import { Badge } from '@/shared/ui/badge';
import { Button } from '@/shared/ui/button';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/shared/ui/tooltip';
import type { ProductGroupDto } from '@/shared/types/api';
import { useDeleteGroup, useGroups, useSaveGroup } from '../api/groups';
import { GroupFormDialog } from '../components/GroupFormDialog';

export function ProductGroupsPage() {
  const list = useListParams({ defaultSort: 'name:asc' });
  const { data, isPending, isFetching, error, refetch } = useGroups(list.query);
  const remove = useDeleteGroup();
  const save = useSaveGroup();
  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<ProductGroupDto | null>(null);
  const [deleting, setDeleting] = useState<ProductGroupDto | null>(null);
  const [archiving, setArchiving] = useState<ProductGroupDto | null>(null);

  const openCreate = () => {
    setEditing(null);
    setFormOpen(true);
  };
  /** Arxivlash: mahsulotli guruhni o'chirib bo'lmaydi, lekin yangi mahsulot qo'shilishini to'xtatish mumkin. */
  const toggleArchive = async (g: ProductGroupDto) => {
    try {
      await save.mutateAsync({ id: g.id, input: { isActive: !g.isActive } });
      toast.success(g.isActive ? t.groups.archivedToast : t.groups.restoredToast);
    } catch (error) {
      toastError(error);
      throw error;
    }
  };

  const columns: Column<ProductGroupDto>[] = [
    {
      key: 'name',
      header: t.groups.col.name,
      sortKey: 'name',
      cell: (g) => (
        <span className="font-medium">
          {g.name}
          {g.isActive ? null : (
            <Badge variant="outline" className="ml-2 text-muted-foreground">
              {t.groups.archived}
            </Badge>
          )}
        </span>
      ),
    },
    {
      key: 'description',
      header: t.groups.col.description,
      hideBelow: 'xl',
      cell: (g) => (
        <span className="block max-w-sm truncate text-muted-foreground">
          {g.description ?? t.common.notSet}
        </span>
      ),
    },
    {
      key: 'productCount',
      header: t.groups.col.productCount,
      sortKey: 'productCount',
      align: 'right',
      cell: (g) => (
        <Link to={`/products?groupId=${g.id}`} onClick={(e) => e.stopPropagation()}>
          <Badge variant="secondary" className="tabular-nums hover:bg-accent">
            {g.productCount}
          </Badge>
        </Link>
      ),
    },
    {
      key: 'createdAt',
      header: t.groups.col.createdAt,
      sortKey: 'createdAt',
      hideBelow: 'sm',
      cell: (g) => (
        <span className="text-muted-foreground tabular-nums">{formatDate(g.createdAt)}</span>
      ),
    },
    {
      key: 'actions',
      header: '',
      align: 'right',
      className: 'w-32',
      cell: (g) => (
        <div className="flex justify-end gap-1" onClick={(e) => e.stopPropagation()}>
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant="ghost"
                size="icon"
                className="size-8"
                onClick={() => {
                  setEditing(g);
                  setFormOpen(true);
                }}
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
                // Arxivlash — tasdiq bilan; arxivdan chiqarish xavfsiz (darhol).
                onClick={() =>
                  g.isActive ? setArchiving(g) : void toggleArchive(g).catch(() => undefined)
                }
                aria-label={g.isActive ? t.groups.archive : t.groups.restore}
              >
                {g.isActive ? <Archive /> : <ArchiveRestore />}
              </Button>
            </TooltipTrigger>
            <TooltipContent>{g.isActive ? t.groups.archive : t.groups.restore}</TooltipContent>
          </Tooltip>
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant="ghost"
                size="icon"
                className="size-8 text-destructive hover:text-destructive"
                onClick={() => setDeleting(g)}
                aria-label={t.common.delete}
              >
                <Trash2 />
              </Button>
            </TooltipTrigger>
            <TooltipContent>{t.common.delete}</TooltipContent>
          </Tooltip>
        </div>
      ),
    },
  ];

  const blocked = deleting ? deleting.productCount > 0 : false;

  return (
    <>
      <PageHeader
        title={t.nav.productGroups}
        description={t.groups.description}
        actions={
          <Button onClick={openCreate}>
            <Plus />
            {t.groups.add}
          </Button>
        }
      />
      <SearchInput
        value={list.search}
        onChange={list.setSearch}
        placeholder={t.groups.searchPlaceholder}
      />
      <DataTable
        columns={columns}
        rows={data?.data}
        rowKey={(g) => g.id}
        isLoading={isPending || isFetching}
        error={error}
        onRetry={() => refetch()}
        sort={list.sort}
        onSortChange={list.setSort}
        onRowClick={(g) => {
          setEditing(g);
          setFormOpen(true);
        }}
        empty={
          list.search ? (
            <EmptyState
              icon={SearchX}
              title={t.table.noResults}
              description={t.table.noResultsHint}
            />
          ) : (
            <EmptyState
              icon={FolderPlus}
              title={t.groups.emptyTitle}
              description={t.groups.emptyDescription}
              action={
                <Button onClick={openCreate}>
                  <Plus />
                  {t.groups.add}
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
      <GroupFormDialog open={formOpen} onOpenChange={setFormOpen} group={editing} />
      <ConfirmDialog
        open={archiving !== null}
        onOpenChange={(open) => !open && setArchiving(null)}
        title={archiving ? t.groups.archiveTitle(archiving.name) : ''}
        description={t.groups.archiveDescription}
        confirmLabel={t.groups.archive}
        onConfirm={() => (archiving ? toggleArchive(archiving) : undefined)}
      />
      <ConfirmDialog
        open={Boolean(deleting)}
        onOpenChange={(open) => !open && setDeleting(null)}
        title={deleting ? t.groups.deleteTitle(deleting.name) : ''}
        description={
          blocked && deleting
            ? t.groups.deleteBlocked(deleting.productCount)
            : t.groups.deleteDescription
        }
        confirmLabel={blocked ? t.common.close : t.common.delete}
        destructive={!blocked}
        onConfirm={async () => {
          if (!deleting || blocked) return;
          try {
            await remove.mutateAsync(deleting.id);
            toast.success(t.groups.deleted);
          } catch (e) {
            toastError(e);
            throw e;
          }
        }}
      />
    </>
  );
}
