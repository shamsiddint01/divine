import {
  buildCreditInstallments,
  CREDIT_INSTALLMENTS_MAX,
  isCreditAmountAllowed,
  phoneSchema,
  VALIDATION_MESSAGES_UZ,
} from '@divine/shared';
import { Loader2 } from 'lucide-react';
import { useEffect } from 'react';
import { Controller, useForm, useWatch } from 'react-hook-form';
import { toast } from 'sonner';
import {
  FORM_DIALOG_BODY_CLASS,
  FORM_DIALOG_CLASS,
  FORM_DIALOG_FOOTER_CLASS,
  FORM_DIALOG_HEADER_CLASS,
} from '@/features/products/components/StockFields';
import { t } from '@/i18n/uz';
import { DatePicker } from '@/shared/components/DatePicker';
import { FormField } from '@/shared/components/FormField';
import { TIME_24H, TimeInput } from '@/shared/components/TimeInput';
import { groupDigits, positiveMoneyField, toDecimal } from '@/shared/forms/fields';
import { z, zodResolver } from '@/shared/forms/zod';
import { normalizeNumberInput } from '@/shared/lib/decimal';
import { formatDate, formatMoney, todayInTashkent } from '@/shared/lib/format';
import { applyFieldErrors, toastError } from '@/shared/lib/mutation';
import { Button } from '@/shared/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/shared/ui/dialog';
import { Input } from '@/shared/ui/input';
import { Textarea } from '@/shared/ui/textarea';
import { useCreateCredit } from '../api/credits';

const wholeNumber = (max: number, error: string) =>
  z.string().refine((v) => /^\d+$/.test(v.trim()) && Number(v) >= 1 && Number(v) <= max, { error });

const schema = z
  .object({
    debtorName: z.string().trim().min(1, { error: t.credits.form.nameRequired }),
    debtorPhone: z
      .string()
      .trim()
      .min(1, { error: VALIDATION_MESSAGES_UZ.creditPhoneRequired })
      .refine((v) => phoneSchema.safeParse(v).success, { error: t.credits.form.phoneInvalid }),
    amount: positiveMoneyField(),
    takenDate: z.string().min(1, { error: t.validation.dateRequired }),
    takenTime: z.string().regex(TIME_24H, { error: t.credits.form.timeInvalid }),
    firstDueDate: z.string().min(1, { error: t.validation.dateRequired }),
    installments: wholeNumber(CREDIT_INSTALLMENTS_MAX, t.credits.form.installmentsInvalid),
    intervalDays: wholeNumber(365, t.credits.form.intervalInvalid),
    note: z.string().max(1000),
  })
  .refine((v) => isCreditAmountAllowed(toDecimal(v.amount)), {
    error: VALIDATION_MESSAGES_UZ.creditAmountMin,
    path: ['amount'],
  })
  .refine((v) => v.firstDueDate >= v.takenDate, {
    error: t.credits.form.dueBeforeTaken,
    path: ['firstDueDate'],
  });

type FormValues = z.infer<typeof schema>;

/** Hozirgi vaqt Toshkent bo'yicha (`HH:mm`). */
const tashkentTime = () => new Date(Date.now() + 5 * 3_600_000).toISOString().slice(11, 16);

const defaults = (): FormValues => ({
  debtorName: '',
  debtorPhone: '',
  amount: '',
  takenDate: todayInTashkent(),
  takenTime: tashkentTime(),
  firstDueDate: todayInTashkent(),
  installments: '1',
  intervalDays: '1',
  note: '',
});

export function CreditFormDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const create = useCreateCredit();
  const { register, control, handleSubmit, reset, setValue, setError, formState } =
    useForm<FormValues>({ resolver: zodResolver(schema), defaultValues: defaults() });

  useEffect(() => {
    if (open) reset(defaults());
  }, [open, reset]);

  const [amount, firstDueDate, installments, intervalDays] = useWatch({
    control,
    name: ['amount', 'firstDueDate', 'installments', 'intervalDays'],
  });
  const count = Number(installments);
  const interval = Number(intervalDays);
  const amountValue = normalizeNumberInput(amount ?? '');
  // Jonli ko'rinish: server aynan shu funksiya bilan hisoblaydi.
  const preview =
    amountValue &&
    Number(amountValue) > 0 &&
    firstDueDate &&
    Number.isInteger(count) &&
    count >= 1 &&
    count <= CREDIT_INSTALLMENTS_MAX &&
    Number.isInteger(interval) &&
    interval >= 1
      ? buildCreditInstallments({
          amount: amountValue,
          firstDueDate,
          installments: count,
          intervalDays: interval,
        })
      : null;

  const onSubmit = handleSubmit(async (v) => {
    try {
      await create.mutateAsync({
        debtorName: v.debtorName.trim(),
        debtorPhone: v.debtorPhone,
        amount: toDecimal(v.amount),
        takenAt: `${v.takenDate}T${v.takenTime}:00+05:00`,
        firstDueDate: v.firstDueDate,
        installments: Number(v.installments),
        intervalDays: Number(v.intervalDays),
        note: v.note.trim() || null,
      });
      toast.success(t.credits.form.created);
      onOpenChange(false);
    } catch (error) {
      const mapped = applyFieldErrors(error, setError, (field) =>
        field === 'takenAt' ? 'takenDate' : field,
      );
      if (!mapped) toastError(error);
    }
  });

  const e = formState.errors;
  const first = preview?.[0];
  const last = preview?.at(-1);
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className={`${FORM_DIALOG_CLASS} sm:max-w-xl`}>
        <DialogHeader className={FORM_DIALOG_HEADER_CLASS}>
          <DialogTitle>{t.credits.form.title}</DialogTitle>
          <DialogDescription>{t.credits.form.description}</DialogDescription>
        </DialogHeader>
        <form
          id="credit-form"
          onSubmit={onSubmit}
          className={`${FORM_DIALOG_BODY_CLASS} grid content-start gap-4 sm:grid-cols-2`}
          noValidate
        >
          <FormField id="c-name" label={t.credits.form.name} required error={e.debtorName?.message}>
            <Input
              id="c-name"
              autoFocus
              placeholder={t.credits.form.namePlaceholder}
              aria-invalid={!!e.debtorName}
              {...register('debtorName')}
            />
          </FormField>
          <FormField
            id="c-phone"
            label={t.credits.form.phone}
            required
            error={e.debtorPhone?.message}
          >
            <Input
              id="c-phone"
              inputMode="tel"
              placeholder="+998 90 123 45 67"
              aria-invalid={!!e.debtorPhone}
              {...register('debtorPhone')}
            />
          </FormField>
          <FormField
            id="c-amount"
            label={t.credits.form.amount}
            required
            error={e.amount?.message}
            className="sm:col-span-2"
          >
            <Input
              id="c-amount"
              inputMode="decimal"
              placeholder={t.credits.form.amountPlaceholder}
              aria-invalid={!!e.amount}
              {...register('amount', {
                onBlur: (ev) => setValue('amount', groupDigits(ev.target.value)),
              })}
            />
          </FormField>
          <FormField
            id="c-taken-date"
            label={t.credits.form.takenDate}
            required
            error={e.takenDate?.message}
          >
            <Controller
              control={control}
              name="takenDate"
              render={({ field }) => (
                <DatePicker id="c-taken-date" value={field.value} onChange={field.onChange} />
              )}
            />
          </FormField>
          <FormField
            id="c-taken-time"
            label={t.credits.form.takenTime}
            required
            error={e.takenTime?.message}
          >
            <Controller
              control={control}
              name="takenTime"
              render={({ field }) => (
                <TimeInput
                  id="c-taken-time"
                  value={field.value}
                  onChange={field.onChange}
                  onBlur={field.onBlur}
                  placeholder={t.credits.form.timePlaceholder}
                  aria-invalid={!!e.takenTime}
                />
              )}
            />
          </FormField>
          <FormField
            id="c-first-due"
            label={t.credits.form.firstDue}
            required
            error={e.firstDueDate?.message}
            className="sm:col-span-2"
          >
            <Controller
              control={control}
              name="firstDueDate"
              render={({ field }) => (
                <DatePicker
                  id="c-first-due"
                  value={field.value}
                  onChange={field.onChange}
                  invalid={!!e.firstDueDate}
                  disableFuture={false}
                />
              )}
            />
          </FormField>
          <FormField
            id="c-installments"
            label={t.credits.form.installments}
            required
            error={e.installments?.message}
            hint={t.credits.form.installmentsHint}
          >
            <Input
              id="c-installments"
              inputMode="numeric"
              aria-invalid={!!e.installments}
              {...register('installments')}
            />
          </FormField>
          <FormField
            id="c-interval"
            label={t.credits.form.interval}
            required
            error={e.intervalDays?.message}
            hint={t.credits.form.intervalHint}
          >
            <Input
              id="c-interval"
              inputMode="numeric"
              aria-invalid={!!e.intervalDays}
              {...register('intervalDays')}
            />
          </FormField>
          {preview && first && last ? (
            <div
              data-testid="credit-preview"
              className="rounded-lg border bg-muted/30 p-3 text-sm sm:col-span-2"
            >
              <p className="font-medium">
                {preview.length === 1
                  ? t.credits.form.previewOnce(formatMoney(first.amount), formatDate(first.dueDate))
                  : t.credits.form.previewMany(preview.length, formatMoney(first.amount))}
              </p>
              {preview.length > 1 ? (
                <p className="mt-0.5 text-xs text-muted-foreground">
                  {t.credits.form.previewRange(formatDate(first.dueDate), formatDate(last.dueDate))}
                  {first.amount !== last.amount
                    ? ` ${t.credits.form.previewLast(formatMoney(last.amount))}`
                    : ''}
                </p>
              ) : null}
            </div>
          ) : null}
          <FormField id="c-note" label={t.credits.form.note} optional className="sm:col-span-2">
            <Textarea id="c-note" rows={2} {...register('note')} />
          </FormField>
        </form>
        <DialogFooter className={FORM_DIALOG_FOOTER_CLASS}>
          <Button
            variant="outline"
            onClick={() => onOpenChange(false)}
            disabled={formState.isSubmitting}
          >
            {t.common.cancel}
          </Button>
          <Button type="submit" form="credit-form" disabled={formState.isSubmitting}>
            {formState.isSubmitting ? <Loader2 className="animate-spin" /> : null}
            {t.common.add}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
