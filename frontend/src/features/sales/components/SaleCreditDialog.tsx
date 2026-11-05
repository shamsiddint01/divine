import {
  buildCreditInstallments,
  CREDIT_INSTALLMENTS_MAX,
  centsToMoney,
  moneyToCents,
  phoneSchema,
  type SaleCreditInput,
  saleCreditIssue,
  VALIDATION_MESSAGES_UZ,
} from '@divine/shared';
import { Loader2 } from 'lucide-react';
import { useEffect } from 'react';
import { Controller, useForm, useWatch } from 'react-hook-form';
import {
  FORM_DIALOG_BODY_CLASS,
  FORM_DIALOG_CLASS,
  FORM_DIALOG_FOOTER_CLASS,
  FORM_DIALOG_HEADER_CLASS,
} from '@/features/products/components/StockFields';
import { t } from '@/i18n/uz';
import { DatePicker } from '@/shared/components/DatePicker';
import { FormField } from '@/shared/components/FormField';
import { groupDigits, moneyField, toDecimal } from '@/shared/forms/fields';
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

const wholeNumber = (max: number, error: string) =>
  z.string().refine((v) => /^\d+$/.test(v.trim()) && Number(v) >= 1 && Number(v) <= max, { error });

const schema = z.object({
  paidAmount: moneyField(),
  debtorName: z.string().trim().min(1, { error: t.credits.form.nameRequired }),
  debtorPhone: z
    .string()
    .trim()
    .min(1, { error: VALIDATION_MESSAGES_UZ.creditPhoneRequired })
    .refine((v) => phoneSchema.safeParse(v).success, { error: t.credits.form.phoneInvalid }),
  firstDueDate: z.string().min(1, { error: t.validation.dateRequired }),
  installments: wholeNumber(CREDIT_INSTALLMENTS_MAX, t.credits.form.installmentsInvalid),
  intervalDays: wholeNumber(365, t.credits.form.intervalInvalid),
});
type FormValues = z.infer<typeof schema>;

const tomorrow = () =>
  new Date(Date.parse(`${todayInTashkent()}T00:00:00Z`) + 86_400_000).toISOString().slice(0, 10);

interface SaleCreditDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  totalAmount: string;
  customer: { name: string; phone: string };
  onSubmit: (credit: SaleCreditInput) => Promise<void>;
}

/** Mijoz puli yetmaganda: qancha to'lagani, qarz shartlari. Qarzni server hisoblaydi, bu yerda — ko'rinish. */
export function SaleCreditDialog({
  open,
  onOpenChange,
  totalAmount,
  customer,
  onSubmit,
}: SaleCreditDialogProps) {
  const { register, control, handleSubmit, reset, setValue, setError, formState } =
    useForm<FormValues>({
      resolver: zodResolver(schema),
      defaultValues: {
        paidAmount: '0',
        debtorName: '',
        debtorPhone: '',
        firstDueDate: tomorrow(),
        installments: '1',
        intervalDays: '1',
      },
    });

  const { name, phone } = customer;
  useEffect(() => {
    if (open) {
      reset({
        paidAmount: '0',
        debtorName: name,
        debtorPhone: phone,
        firstDueDate: tomorrow(),
        installments: '1',
        intervalDays: '1',
      });
    }
  }, [open, name, phone, reset]);

  const [paid, firstDueDate, installments, intervalDays] = useWatch({
    control,
    name: ['paidAmount', 'firstDueDate', 'installments', 'intervalDays'],
  });
  const paidValue = normalizeNumberInput(paid ?? '') ?? '0';
  const validPaid = /^\d+(\.\d{1,2})?$/.test(paidValue);
  const debt = validPaid ? moneyToCents(totalAmount) - moneyToCents(paidValue) : 0n;
  const count = Number(installments);
  const interval = Number(intervalDays);
  const plan =
    debt > 0n &&
    firstDueDate &&
    Number.isInteger(count) &&
    count >= 1 &&
    count <= CREDIT_INSTALLMENTS_MAX &&
    Number.isInteger(interval) &&
    interval >= 1
      ? buildCreditInstallments({
          amount: centsToMoney(debt),
          firstDueDate,
          installments: count,
          intervalDays: interval,
        })
      : null;

  const submit = handleSubmit(async (v) => {
    const credit: SaleCreditInput = {
      paidAmount: toDecimal(v.paidAmount),
      debtorName: v.debtorName.trim(),
      debtorPhone: phoneSchema.parse(v.debtorPhone),
      firstDueDate: v.firstDueDate,
      installments: Number(v.installments),
      intervalDays: Number(v.intervalDays),
    };
    const issue = saleCreditIssue(totalAmount, credit, todayInTashkent());
    if (issue) {
      setError(issue.field.replace('credit.', '') as keyof FormValues, { message: issue.message });
      return;
    }
    try {
      await onSubmit(credit);
    } catch (error) {
      const mapped = applyFieldErrors(error, setError, (field) => field.replace('credit.', ''));
      if (!mapped) toastError(error);
    }
  });

  const e = formState.errors;
  const first = plan?.[0];
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className={`${FORM_DIALOG_CLASS} sm:max-w-xl`}>
        <DialogHeader className={FORM_DIALOG_HEADER_CLASS}>
          <DialogTitle>{t.sales.credit.title}</DialogTitle>
          <DialogDescription>{t.sales.credit.description}</DialogDescription>
        </DialogHeader>
        <form
          id="sale-credit-form"
          onSubmit={submit}
          className={`${FORM_DIALOG_BODY_CLASS} grid content-start gap-4 sm:grid-cols-2`}
          noValidate
        >
          <div
            data-testid="sale-credit-summary"
            className="grid grid-cols-3 gap-2 rounded-lg border bg-muted/30 p-3 text-sm sm:col-span-2"
          >
            <div>
              <p className="text-xs text-muted-foreground">{t.sales.credit.total}</p>
              <p className="font-semibold tabular-nums">{formatMoney(totalAmount)}</p>
            </div>
            <div>
              <p className="text-xs text-muted-foreground">{t.sales.credit.paid}</p>
              <p className="font-semibold tabular-nums">
                {formatMoney(validPaid ? paidValue : '0')}
              </p>
            </div>
            <div>
              <p className="text-xs text-muted-foreground">{t.sales.credit.debt}</p>
              <p className="font-semibold text-warning tabular-nums">
                {formatMoney(centsToMoney(debt > 0n ? debt : 0n))}
              </p>
            </div>
          </div>
          <FormField
            id="sc-paid"
            label={t.sales.credit.paidInput}
            required
            error={e.paidAmount?.message}
            hint={t.sales.credit.paidHint}
            className="sm:col-span-2"
          >
            <Input
              id="sc-paid"
              inputMode="decimal"
              autoFocus
              aria-invalid={!!e.paidAmount}
              {...register('paidAmount', {
                onBlur: (ev) => setValue('paidAmount', groupDigits(ev.target.value)),
              })}
            />
          </FormField>
          <FormField
            id="sc-name"
            label={t.credits.form.name}
            required
            error={e.debtorName?.message}
          >
            <Input id="sc-name" aria-invalid={!!e.debtorName} {...register('debtorName')} />
          </FormField>
          <FormField
            id="sc-phone"
            label={t.credits.form.phone}
            required
            error={e.debtorPhone?.message}
          >
            <Input
              id="sc-phone"
              inputMode="tel"
              placeholder="+998 90 123 45 67"
              aria-invalid={!!e.debtorPhone}
              {...register('debtorPhone')}
            />
          </FormField>
          <FormField
            id="sc-due"
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
                  id="sc-due"
                  value={field.value}
                  onChange={field.onChange}
                  invalid={!!e.firstDueDate}
                  disableFuture={false}
                />
              )}
            />
          </FormField>
          <FormField
            id="sc-count"
            label={t.credits.form.installments}
            required
            error={e.installments?.message}
            hint={t.credits.form.installmentsHint}
          >
            <Input
              id="sc-count"
              inputMode="numeric"
              aria-invalid={!!e.installments}
              {...register('installments')}
            />
          </FormField>
          <FormField
            id="sc-interval"
            label={t.credits.form.interval}
            required
            error={e.intervalDays?.message}
            hint={t.credits.form.intervalHint}
          >
            <Input
              id="sc-interval"
              inputMode="numeric"
              aria-invalid={!!e.intervalDays}
              {...register('intervalDays')}
            />
          </FormField>
          {plan && first ? (
            <p className="rounded-lg border bg-muted/30 p-3 text-sm sm:col-span-2">
              {plan.length === 1
                ? t.credits.form.previewOnce(formatMoney(first.amount), formatDate(first.dueDate))
                : t.credits.form.previewMany(plan.length, formatMoney(first.amount))}
            </p>
          ) : null}
        </form>
        <DialogFooter className={FORM_DIALOG_FOOTER_CLASS}>
          <Button
            variant="outline"
            onClick={() => onOpenChange(false)}
            disabled={formState.isSubmitting}
          >
            {t.common.cancel}
          </Button>
          <Button type="submit" form="sale-credit-form" disabled={formState.isSubmitting}>
            {formState.isSubmitting ? <Loader2 className="animate-spin" /> : null}
            {t.sales.credit.submit}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
