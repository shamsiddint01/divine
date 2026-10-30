import { EXPENSE_CATEGORY_NAME_MAX_LENGTH } from '@divine/shared';
import { Check, Loader2, Pencil, Plus, Tags, Trash2, X } from 'lucide-react';
import { type FormEvent, useState } from 'react';
import { toast } from 'sonner';
import { t } from '@/i18n/uz';
import { ConfirmDialog } from '@/shared/components/ConfirmDialog';
import { EmptyState } from '@/shared/components/EmptyState';
import { StatusBadge } from '@/shared/components/StatusBadge';
import { fieldErrorOf, toastError } from '@/shared/lib/mutation';
import { Button } from '@/shared/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/shared/ui/dialog';
import { Input } from '@/shared/ui/input';
import { Skeleton } from '@/shared/ui/skeleton';
import { Switch } from '@/shared/ui/switch';
import type { ExpenseCategoryDto } from '@/shared/types/api';
import {
  useDeleteExpenseCategory,
  useExpenseCategories,
  useSaveExpenseCategory,
} from '../api/expenses';

/**
 * Xarajat kategoriyalarini boshqarish (D-19, faqat `expenses.manage`): qo'shish, qayta nomlash,
 * nofaol qilish/faollashtirish va xarajatsiz kategoriyani o'chirish (BR-31). Boshlang'ich ro'yxat bo'sh.
 */
export function ExpenseCategoriesDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const { data: categories, isPending } = useExpenseCategories();
  const save = useSaveExpenseCategory();
  const [name, setName] = useState('');
  const [nameError, setNameError] = useState<string | null>(null);
  const [deleting, setDeleting] = useState<ExpenseCategoryDto | null>(null);
  const remove = useDeleteExpenseCategory();

  const onCreate = async (ev: FormEvent) => {
    ev.preventDefault();
    if (!name.trim()) {
      setNameError(t.expenses.categories.nameRequired);
      return;
    }
    try {
      await save.mutateAsync({ input: { name: name.trim() } });
      toast.success(t.expenses.categories.created);
      setName('');
      setNameError(null);
    } catch (error) {
      const message = fieldErrorOf(error, 'name');
      if (message) setNameError(message);
      else toastError(error);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{t.expenses.categories.title}</DialogTitle>
          <DialogDescription>{t.expenses.categories.description}</DialogDescription>
        </DialogHeader>
        <form onSubmit={onCreate} className="space-y-1" noValidate>
          <div className="flex gap-2">
            <Input
              aria-label={t.expenses.categories.name}
              placeholder={t.expenses.categories.namePlaceholder}
              value={name}
              maxLength={EXPENSE_CATEGORY_NAME_MAX_LENGTH}
              aria-invalid={!!nameError}
              onChange={(ev) => {
                setName(ev.target.value);
                setNameError(null);
              }}
            />
            <Button type="submit" disabled={save.isPending}>
              {save.isPending ? <Loader2 className="animate-spin" /> : <Plus />}
              {t.common.add}
            </Button>
          </div>
          {nameError ? <p className="text-xs text-destructive">{nameError}</p> : null}
        </form>
        <div className="max-h-80 overflow-y-auto rounded-lg border">
          {isPending ? (
            <div className="space-y-2 p-3">
              <Skeleton className="h-8 w-full" />
              <Skeleton className="h-8 w-full" />
            </div>
          ) : categories && categories.length > 0 ? (
            <ul className="divide-y" aria-label={t.expenses.categories.title}>
              {categories.map((c) => (
                <CategoryRow key={c.id} category={c} onDelete={() => setDeleting(c)} />
              ))}
            </ul>
          ) : (
            <EmptyState
              icon={Tags}
              title={t.expenses.categories.emptyTitle}
              description={t.expenses.categories.emptyHint}
            />
          )}
        </div>
      </DialogContent>
      <ConfirmDialog
        open={Boolean(deleting)}
        onOpenChange={(value) => !value && setDeleting(null)}
        title={t.expenses.categories.deleteTitle}
        description={t.expenses.categories.deleteDescription}
        confirmLabel={t.common.delete}
        destructive
        onConfirm={async () => {
          if (!deleting) return;
          try {
            await remove.mutateAsync(deleting.id);
            toast.success(t.expenses.categories.deleted);
          } catch (e) {
            toastError(e);
            throw e;
          }
        }}
      />
    </Dialog>
  );
}

function CategoryRow({
  category,
  onDelete,
}: {
  category: ExpenseCategoryDto;
  onDelete: () => void;
}) {
  const save = useSaveExpenseCategory();
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(category.name);
  const [error, setError] = useState<string | null>(null);
  const [confirmDeactivate, setConfirmDeactivate] = useState(false);
  const used = (category.expenseCount ?? 0) > 0;

  const rename = async () => {
    const next = name.trim();
    if (!next) {
      setError(t.expenses.categories.nameRequired);
      return;
    }
    try {
      if (next !== category.name)
        await save.mutateAsync({ id: category.id, input: { name: next } });
      setEditing(false);
      setError(null);
    } catch (e) {
      const message = fieldErrorOf(e, 'name');
      if (message) setError(message);
      else toastError(e);
    }
  };

  const toggle = async (isActive: boolean) => {
    try {
      await save.mutateAsync({ id: category.id, input: { isActive } });
      toast.success(isActive ? t.expenses.categories.activated : t.expenses.categories.deactivated);
    } catch (e) {
      toastError(e);
      throw e;
    }
  };

  return (
    <li className="flex items-center gap-3 px-3 py-2 text-sm">
      <div className="min-w-0 flex-1">
        {editing ? (
          <div className="space-y-1">
            <div className="flex gap-1">
              <Input
                aria-label={t.expenses.categories.name}
                value={name}
                maxLength={EXPENSE_CATEGORY_NAME_MAX_LENGTH}
                aria-invalid={!!error}
                autoFocus
                className="h-8"
                onChange={(ev) => {
                  setName(ev.target.value);
                  setError(null);
                }}
                onKeyDown={(ev) => {
                  if (ev.key === 'Enter') void rename();
                  if (ev.key === 'Escape') setEditing(false);
                }}
              />
              <Button
                size="icon"
                variant="ghost"
                className="size-8"
                aria-label={t.common.save}
                disabled={save.isPending}
                onClick={() => void rename()}
              >
                <Check />
              </Button>
              <Button
                size="icon"
                variant="ghost"
                className="size-8"
                aria-label={t.common.cancel}
                onClick={() => {
                  setEditing(false);
                  setName(category.name);
                  setError(null);
                }}
              >
                <X />
              </Button>
            </div>
            {error ? <p className="text-xs text-destructive">{error}</p> : null}
          </div>
        ) : (
          <>
            <p className="truncate font-medium">{category.name}</p>
            <p className="text-xs text-muted-foreground">
              {t.expenses.categories.usage(category.expenseCount ?? 0)}
            </p>
          </>
        )}
      </div>
      {editing ? null : (
        <>
          <StatusBadge status={category.isActive === false ? 'INACTIVE' : 'ACTIVE'} />
          <Switch
            checked={category.isActive !== false}
            // Nofaol qilish — tasdiq bilan; faollashtirish darhol.
            onCheckedChange={(value) =>
              value ? void toggle(true).catch(() => undefined) : setConfirmDeactivate(true)
            }
            disabled={save.isPending}
            aria-label={t.expenses.categories.activeToggle(category.name)}
          />
          <Button
            size="icon"
            variant="ghost"
            className="size-8"
            aria-label={t.expenses.categories.rename(category.name)}
            onClick={() => setEditing(true)}
          >
            <Pencil />
          </Button>
          <Button
            size="icon"
            variant="ghost"
            className="size-8"
            aria-label={t.expenses.categories.remove(category.name)}
            title={used ? t.expenses.categories.inUse : undefined}
            disabled={used}
            onClick={onDelete}
          >
            <Trash2 />
          </Button>
        </>
      )}
      <ConfirmDialog
        open={confirmDeactivate}
        onOpenChange={setConfirmDeactivate}
        title={t.expenses.categories.deactivateTitle(category.name)}
        description={t.expenses.categories.deactivateDescription}
        confirmLabel={t.expenses.categories.deactivate}
        onConfirm={() => toggle(false)}
      />
    </li>
  );
}
