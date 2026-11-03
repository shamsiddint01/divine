import { Check, ListChecks, Loader2, Plus } from 'lucide-react';
import { type FormEvent, type KeyboardEvent, useEffect, useState } from 'react';
import { isExpenseDateAllowed, VALIDATION_MESSAGES_UZ } from '@divine/shared';
import { Controller, useForm } from 'react-hook-form';
import { toast } from 'sonner';
import { z, zodResolver } from '@/shared/forms/zod';
import { t } from '@/i18n/uz';
import { DatePicker } from '@/shared/components/DatePicker';
import { FormField } from '@/shared/components/FormField';
import { OptionsLoadError } from '@/shared/components/OptionsLoadError';
import { groupDigits, positiveMoneyField, toDecimal } from '@/shared/forms/fields';
import { todayInTashkent } from '@/shared/lib/format';
import { applyFieldErrors, fieldErrorOf, toastError } from '@/shared/lib/mutation';
import { Button } from '@/shared/ui/button';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/shared/ui/dialog';
import { Input } from '@/shared/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectSeparator,
  SelectTrigger,
  SelectValue,
} from '@/shared/ui/select';
import { Textarea } from '@/shared/ui/textarea';
import type { ExpenseCategoryDto, ExpenseDto } from '@/shared/types/api';
import { useCurrentUser } from '@/features/session/api/session';
import { useExpenseCategories, useSaveExpense, useSaveExpenseCategory } from '../api/expenses';

/** Kategoriya ro'yxatining eng pastidagi "+ Yangi kategoriya" bandi. */
const NEW_CATEGORY = '__new__';

const schema = z.object({
  // D-19: Toshkent bo'yicha bugundan keyingi sana — server ham rad etadi.
  date: z
    .string()
    .min(1, { error: t.validation.dateRequired })
    .refine((d) => isExpenseDateAllowed(d, todayInTashkent()), {
      error: VALIDATION_MESSAGES_UZ.expenseDateInFuture,
    }),
  amount: positiveMoneyField(),
  categoryId: z.string().min(1, { error: VALIDATION_MESSAGES_UZ.expenseCategoryRequired }),
  note: z.string().max(1000),
});
type FormValues = z.infer<typeof schema>;

export function ExpenseFormDialog({
  open,
  onOpenChange,
  expense,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  expense?: ExpenseDto | null;
}) {
  const save = useSaveExpense();
  const saveCategory = useSaveExpenseCategory();
  const { data: me } = useCurrentUser();
  const {
    data: categories,
    error: categoriesError,
    refetch: refetchCategories,
  } = useExpenseCategories();
  // Yangi kategoriya ("+ Yangi kategoriya"): nom yoziladi → server qo'shadi → shu xarajatga tanlanadi.
  const [creating, setCreating] = useState(false);
  const [newName, setNewName] = useState('');
  const [newError, setNewError] = useState<string | null>(null);
  const [justCreated, setJustCreated] = useState<ExpenseCategoryDto | null>(null);
  // Yangi xarajat — faqat faol kategoriya (D-19); tahrirlashda joriy (nofaol bo'lsa ham) saqlanadi.
  const options = (categories ?? []).filter((c) => c.isActive !== false);
  if (expense && !options.some((c) => c.id === expense.category.id)) {
    options.push({ id: expense.category.id, name: expense.category.name });
  }
  // Ro'yxat qayta yuklanguncha yangi qo'shilgan kategoriya ham tanlovda ko'rinib tursin.
  if (justCreated && !options.some((c) => c.id === justCreated.id)) options.push(justCreated);
  // Kategoriya umuman yo'q — ro'yxat o'rniga darhol nom maydoni.
  const showCreate = creating || (categories !== undefined && options.length === 0);
  /** Admin boshqalar qo'shgan kategoriyalarni ham ko'radi — bir xil nomlar kimniki ekani bilan ajraladi. */
  const labelOf = (c: ExpenseCategoryDto) =>
    c.createdBy && me && c.createdBy.id !== me.id ? `${c.name} · ${c.createdBy.login}` : c.name;
  const { register, control, handleSubmit, reset, setValue, setError, formState } =
    useForm<FormValues>({
      resolver: zodResolver(schema),
      defaultValues: {
        date: todayInTashkent(),
        amount: '',
        categoryId: '',
        note: '',
      },
    });

  useEffect(() => {
    if (!open) return;
    setCreating(false);
    setNewName('');
    setNewError(null);
    setJustCreated(null);
    reset(
      expense
        ? {
            date: expense.date,
            amount: groupDigits(expense.amount.replace(/\.00$/, '')),
            categoryId: expense.category.id,
            note: expense.note ?? '',
          }
        : { date: todayInTashkent(), amount: '', categoryId: '', note: '' },
    );
  }, [open, expense, reset]);

  /** Yangi kategoriyani qo'shib, formada tanlaydi; xato bo'lsa — nom maydoni ostida. */
  const addCategory = async (): Promise<string | null> => {
    const name = newName.trim();
    if (!name) {
      setNewError(VALIDATION_MESSAGES_UZ.nameRequired);
      return null;
    }
    try {
      const created = await saveCategory.mutateAsync({ input: { name } });
      setJustCreated(created);
      setValue('categoryId', created.id, { shouldValidate: true });
      setCreating(false);
      setNewName('');
      setNewError(null);
      toast.success(t.expenses.form.categoryCreated(created.name));
      return created.id;
    } catch (error) {
      const message = fieldErrorOf(error, 'name');
      if (message) setNewError(message);
      else toastError(error);
      return null;
    }
  };

  const onNewNameKey = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key !== 'Enter') return;
    event.preventDefault();
    void addCategory();
  };

  const submit = handleSubmit(async (v) => {
    try {
      await save.mutateAsync({
        id: expense?.id,
        input: {
          date: v.date,
          amount: toDecimal(v.amount),
          categoryId: v.categoryId,
          note: v.note.trim() || null,
        },
      });
      toast.success(expense ? t.expenses.form.updated : t.expenses.form.created);
      onOpenChange(false);
    } catch (error) {
      if (!applyFieldErrors(error, setError)) toastError(error);
    }
  });

  // Nom yozilgan-u, "Qo'shish" bosilmagan bo'lsa — saqlashda avval kategoriya qo'shiladi.
  const onSubmit = async (event: FormEvent) => {
    event.preventDefault();
    if (showCreate && newName.trim() && !(await addCategory())) return;
    await submit();
  };

  const e = formState.errors;
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>
            {expense ? t.expenses.form.editTitle : t.expenses.form.createTitle}
          </DialogTitle>
        </DialogHeader>
        <form
          id="expense-form"
          onSubmit={onSubmit}
          className="grid gap-4 sm:grid-cols-2"
          noValidate
        >
          <FormField id="e-date" label={t.expenses.form.date} required error={e.date?.message}>
            <Controller
              control={control}
              name="date"
              render={({ field }) => (
                <DatePicker id="e-date" value={field.value} onChange={field.onChange} />
              )}
            />
          </FormField>
          <FormField
            id="e-amount"
            label={t.expenses.form.amount}
            required
            error={e.amount?.message}
          >
            <Input
              id="e-amount"
              inputMode="decimal"
              placeholder={t.expenses.form.amountPlaceholder}
              aria-invalid={!!e.amount}
              {...register('amount', {
                onBlur: (ev) => setValue('amount', groupDigits(ev.target.value)),
              })}
            />
          </FormField>
          <FormField
            id={showCreate ? 'e-category-new' : 'e-category'}
            label={t.expenses.form.category}
            required
            error={showCreate ? (newError ?? e.categoryId?.message) : e.categoryId?.message}
            hint={
              categoriesError && !categories ? (
                <OptionsLoadError onRetry={() => refetchCategories()} />
              ) : showCreate ? (
                t.expenses.form.newCategoryHint
              ) : undefined
            }
            className="sm:col-span-2"
          >
            {showCreate ? (
              <div className="flex gap-2">
                <Input
                  id="e-category-new"
                  value={newName}
                  maxLength={100}
                  autoFocus={creating}
                  placeholder={t.expenses.form.newCategoryPlaceholder}
                  aria-invalid={!!newError || !!e.categoryId}
                  onChange={(ev) => {
                    setNewName(ev.target.value);
                    setNewError(null);
                  }}
                  onKeyDown={onNewNameKey}
                />
                <Button
                  type="button"
                  size="icon"
                  className="shrink-0"
                  onClick={() => void addCategory()}
                  disabled={saveCategory.isPending}
                  aria-label={t.expenses.form.addCategory}
                  title={t.expenses.form.addCategory}
                >
                  {saveCategory.isPending ? <Loader2 className="animate-spin" /> : <Check />}
                </Button>
                {options.length > 0 ? (
                  <Button
                    type="button"
                    variant="outline"
                    size="icon"
                    className="shrink-0"
                    onClick={() => {
                      setCreating(false);
                      setNewError(null);
                    }}
                    aria-label={t.expenses.form.cancelNewCategory}
                    title={t.expenses.form.cancelNewCategory}
                  >
                    <ListChecks />
                  </Button>
                ) : null}
              </div>
            ) : (
              <Controller
                control={control}
                name="categoryId"
                render={({ field }) => (
                  <Select
                    value={field.value}
                    onValueChange={(value) => {
                      if (value === NEW_CATEGORY) setCreating(true);
                      else field.onChange(value);
                    }}
                  >
                    <SelectTrigger id="e-category" aria-invalid={!!e.categoryId}>
                      <SelectValue placeholder={t.common.selectPlaceholder} />
                    </SelectTrigger>
                    <SelectContent>
                      {options.map((c) => (
                        <SelectItem key={c.id} value={c.id}>
                          {labelOf(c)}
                        </SelectItem>
                      ))}
                      {options.length > 0 ? <SelectSeparator /> : null}
                      <SelectItem value={NEW_CATEGORY} className="font-medium text-primary">
                        <Plus className="text-primary" />
                        {t.expenses.form.newCategory}
                      </SelectItem>
                    </SelectContent>
                  </Select>
                )}
              />
            )}
          </FormField>
          <FormField id="e-note" label={t.expenses.form.note} optional className="sm:col-span-2">
            <Textarea
              id="e-note"
              rows={3}
              placeholder={t.expenses.form.notePlaceholder}
              {...register('note')}
            />
          </FormField>
        </form>
        <DialogFooter>
          <Button
            variant="outline"
            onClick={() => onOpenChange(false)}
            disabled={formState.isSubmitting}
          >
            {t.common.cancel}
          </Button>
          <Button type="submit" form="expense-form" disabled={formState.isSubmitting}>
            {formState.isSubmitting ? <Loader2 className="animate-spin" /> : null}
            {expense ? t.common.saveChanges : t.common.add}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
