import { Loader2 } from 'lucide-react';
import { useEffect } from 'react';
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
import { applyFieldErrors, toastError } from '@/shared/lib/mutation';
import { Button } from '@/shared/ui/button';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/shared/ui/dialog';
import { Input } from '@/shared/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/shared/ui/select';
import { Textarea } from '@/shared/ui/textarea';
import type { ExpenseDto } from '@/shared/types/api';
import { useExpenseCategories, useSaveExpense } from '../api/expenses';

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
  const {
    data: categories,
    error: categoriesError,
    refetch: refetchCategories,
  } = useExpenseCategories();
  // Yangi xarajat — faqat faol kategoriya (D-19); tahrirlashda joriy (nofaol bo'lsa ham) saqlanadi.
  const options = (categories ?? []).filter((c) => c.isActive !== false);
  if (expense && !options.some((c) => c.id === expense.category.id)) {
    options.push({ id: expense.category.id, name: expense.category.name });
  }
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

  const onSubmit = handleSubmit(async (v) => {
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
            id="e-category"
            label={t.expenses.form.category}
            required
            error={e.categoryId?.message}
            hint={
              categoriesError && !categories ? (
                <OptionsLoadError onRetry={() => refetchCategories()} />
              ) : categories && options.length === 0 ? (
                t.expenses.form.noCategories
              ) : undefined
            }
            className="sm:col-span-2"
          >
            <Controller
              control={control}
              name="categoryId"
              render={({ field }) => (
                <Select value={field.value} onValueChange={field.onChange}>
                  <SelectTrigger id="e-category" aria-invalid={!!e.categoryId}>
                    <SelectValue placeholder={t.common.selectPlaceholder} />
                  </SelectTrigger>
                  <SelectContent>
                    {options.map((c) => (
                      <SelectItem key={c.id} value={c.id}>
                        {c.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              )}
            />
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
