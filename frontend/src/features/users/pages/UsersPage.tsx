import {
  Ban,
  KeyRound,
  MoreHorizontal,
  Pencil,
  Plus,
  SearchX,
  ShieldCheck,
  UserCheck,
} from 'lucide-react';
import { useState } from 'react';
import { toast } from 'sonner';
import { Permission } from '@divine/shared';
import { useCurrentUser } from '@/features/session/api/session';
import { useHasAnyPermission } from '@/features/session/hooks/use-permissions';
import { t } from '@/i18n/uz';
import { useListParams } from '@/shared/hooks/use-list-params';
import { formatDate, formatDateTime, formatRelative, initials } from '@/shared/lib/format';
import { toastError } from '@/shared/lib/mutation';
import { ConfirmDialog } from '@/shared/components/ConfirmDialog';
import { DataPagination } from '@/shared/components/DataPagination';
import { type Column, DataTable } from '@/shared/components/DataTable';
import { EmptyState } from '@/shared/components/EmptyState';
import { FilterSelect } from '@/shared/components/FilterSelect';
import { PageHeader } from '@/shared/components/PageHeader';
import { SearchInput } from '@/shared/components/SearchInput';
import { StatusBadge } from '@/shared/components/StatusBadge';
import { Avatar, AvatarFallback } from '@/shared/ui/avatar';
import { Badge } from '@/shared/ui/badge';
import { Button } from '@/shared/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/shared/ui/dropdown-menu';
import type { UserDto } from '@/shared/types/api';
import { useResetPassword, useSetUserStatus, useUsers } from '../api/users';
import { PasswordRevealDialog } from '../components/PasswordRevealDialog';
import { UserFormDialog } from '../components/UserFormDialog';

export function UsersPage() {
  const { data: me } = useCurrentUser();
  // Faqat UX: tugmalar yashiriladi; haqiqiy tekshiruv backend'da (users.manage).
  const canManage = useHasAnyPermission([Permission.USERS_MANAGE]);
  const list = useListParams({
    defaultSort: 'createdAt:asc',
    filterKeys: ['role', 'status'] as const,
  });
  const { data, isPending, isFetching, error, refetch } = useUsers(list.query);
  const setStatus = useSetUserStatus();
  const resetPassword = useResetPassword();

  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<UserDto | null>(null);
  const [blocking, setBlocking] = useState<UserDto | null>(null);
  const [resetting, setResetting] = useState<UserDto | null>(null);
  const [revealed, setRevealed] = useState<{ login: string; password: string } | null>(null);

  const allColumns: Column<UserDto>[] = [
    {
      key: 'login',
      header: t.users.col.login,
      sortKey: 'login',
      cell: (u) => (
        <div className="flex items-center gap-3">
          <Avatar className="size-8">
            <AvatarFallback
              className={
                u.role === 'ADMIN'
                  ? 'bg-primary text-primary-foreground'
                  : 'bg-primary/10 text-primary'
              }
            >
              {initials(u.fullName ?? u.login)}
            </AvatarFallback>
          </Avatar>
          <div>
            <p className="font-medium">
              <span className="font-mono">{u.login}</span>
              {u.id === me?.id ? (
                <span className="ml-1.5 text-xs text-muted-foreground">({t.users.you})</span>
              ) : null}
            </p>
            <p className="text-xs text-muted-foreground">
              {u.fullName ?? t.common.notSet}
              {/* Telefonda rol shu yerda (alohida ustun sig'maydi) */}
              <span className="sm:hidden"> · {t.roles[u.role]}</span>
            </p>
          </div>
        </div>
      ),
    },
    {
      key: 'role',
      header: t.users.col.role,
      hideBelow: 'sm',
      cell: (u) =>
        u.role === 'ADMIN' ? (
          <Badge variant="info">
            <ShieldCheck />
            {t.roles.ADMIN}
          </Badge>
        ) : (
          <Badge variant="secondary">{t.roles.USER}</Badge>
        ),
    },
    {
      key: 'warehouses',
      header: t.users.col.warehouses,
      hideBelow: 'xl',
      cell: (u) =>
        u.role === 'ADMIN' ? (
          <span className="text-muted-foreground">{t.users.allWarehousesAccess}</span>
        ) : u.warehouses.length === 0 ? (
          <span className="text-warning">{t.users.noWarehouses}</span>
        ) : (
          <div className="flex flex-wrap gap-1">
            {u.warehouses.map((w) => (
              <Badge key={w.id} variant="outline">
                {w.name}
              </Badge>
            ))}
          </div>
        ),
    },
    {
      key: 'status',
      header: t.users.col.status,
      cell: (u) => (
        <div className="space-y-1">
          <StatusBadge status={u.status} />
          {u.lockedUntil ? (
            <p className="text-xs text-warning">
              {t.users.lockedUntil(formatDateTime(u.lockedUntil))}
            </p>
          ) : null}
        </div>
      ),
    },
    {
      key: 'lastLogin',
      header: t.users.col.lastLogin,
      sortKey: 'lastLoginAt',
      hideBelow: '2xl',
      cell: (u) => (
        <span className="text-muted-foreground">
          {u.lastLoginAt ? formatRelative(u.lastLoginAt) : t.common.notSet}
        </span>
      ),
    },
    {
      key: 'createdAt',
      header: t.users.col.createdAt,
      sortKey: 'createdAt',
      hideBelow: 'xl',
      cell: (u) => (
        <span className="text-muted-foreground tabular-nums">{formatDate(u.createdAt)}</span>
      ),
    },
    {
      key: 'actions',
      header: '',
      align: 'right',
      className: 'w-12',
      cell: (u) => (
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
              <DropdownMenuItem
                onSelect={() => {
                  setEditing(u);
                  setFormOpen(true);
                }}
              >
                <Pencil />
                {t.common.edit}
              </DropdownMenuItem>
              {u.id !== me?.id ? (
                <>
                  <DropdownMenuItem onSelect={() => setResetting(u)}>
                    <KeyRound />
                    {t.users.resetPassword}
                  </DropdownMenuItem>
                  <DropdownMenuSeparator />
                  {u.status === 'ACTIVE' ? (
                    <DropdownMenuItem variant="destructive" onSelect={() => setBlocking(u)}>
                      <Ban />
                      {t.users.block}
                    </DropdownMenuItem>
                  ) : (
                    <DropdownMenuItem
                      onSelect={async () => {
                        try {
                          await setStatus.mutateAsync({ id: u.id, status: 'ACTIVE' });
                          toast.success(t.users.unblocked);
                        } catch (e) {
                          toastError(e);
                        }
                      }}
                    >
                      <UserCheck />
                      {t.users.unblock}
                    </DropdownMenuItem>
                  )}
                </>
              ) : null}
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      ),
    },
  ];
  const columns = canManage ? allColumns : allColumns.filter((c) => c.key !== 'actions');

  return (
    <>
      <PageHeader
        title={t.nav.users}
        description={t.users.description}
        actions={
          canManage ? (
            <Button
              onClick={() => {
                setEditing(null);
                setFormOpen(true);
              }}
            >
              <Plus />
              {t.users.add}
            </Button>
          ) : null
        }
      />
      <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap">
        <SearchInput
          value={list.search}
          onChange={list.setSearch}
          placeholder={t.users.searchPlaceholder}
        />
        <FilterSelect
          value={list.filters.role}
          onChange={(v) => list.setFilter('role', v)}
          allLabel={t.users.allRoles}
          className="sm:w-44"
          options={[
            { value: 'ADMIN', label: t.roles.ADMIN },
            { value: 'USER', label: t.roles.USER },
          ]}
        />
        <FilterSelect
          value={list.filters.status}
          onChange={(v) => list.setFilter('status', v)}
          allLabel={t.users.allStatuses}
          className="sm:w-44"
          options={[
            { value: 'ACTIVE', label: t.status.ACTIVE },
            { value: 'BLOCKED', label: t.status.BLOCKED },
          ]}
        />
      </div>
      <DataTable
        columns={columns}
        rows={data?.data}
        rowKey={(u) => u.id}
        isLoading={isPending || isFetching}
        error={error}
        onRetry={() => refetch()}
        sort={list.sort}
        onSortChange={list.setSort}
        onRowClick={
          canManage
            ? (u) => {
                setEditing(u);
                setFormOpen(true);
              }
            : undefined
        }
        empty={
          <EmptyState
            icon={SearchX}
            title={t.users.emptyTitle}
            description={t.table.noResultsHint}
          />
        }
        footer={
          <DataPagination
            meta={data?.meta}
            onPageChange={list.setPage}
            onPageSizeChange={list.setPageSize}
          />
        }
      />
      <UserFormDialog
        open={formOpen}
        onOpenChange={setFormOpen}
        user={editing}
        isSelf={Boolean(editing && editing.id === me?.id)}
        onCreated={(login, password) => setRevealed({ login, password })}
      />
      <PasswordRevealDialog
        login={revealed?.login ?? ''}
        password={revealed?.password ?? null}
        onClose={() => setRevealed(null)}
      />
      <ConfirmDialog
        open={Boolean(blocking)}
        onOpenChange={(open) => !open && setBlocking(null)}
        title={blocking ? t.users.blockTitle(blocking.login) : ''}
        description={t.users.blockDescription}
        confirmLabel={t.users.block}
        destructive
        onConfirm={async () => {
          if (!blocking) return;
          try {
            await setStatus.mutateAsync({ id: blocking.id, status: 'BLOCKED' });
            toast.success(t.users.blocked);
          } catch (e) {
            toastError(e);
            throw e;
          }
        }}
      />
      <ConfirmDialog
        open={Boolean(resetting)}
        onOpenChange={(open) => !open && setResetting(null)}
        title={t.users.resetTitle}
        description={t.users.resetDescription}
        confirmLabel={t.users.resetPassword}
        onConfirm={async () => {
          if (!resetting) return;
          try {
            const res = await resetPassword.mutateAsync(resetting.id);
            setRevealed({ login: resetting.login, password: res.generatedPassword });
          } catch (e) {
            toastError(e);
            throw e;
          }
        }}
      />
    </>
  );
}
