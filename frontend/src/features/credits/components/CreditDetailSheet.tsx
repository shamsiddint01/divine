import { Loader2, Phone } from 'lucide-react';
import { useState } from 'react';
import { Controller, useForm } from 'react-hook-form';
import { toast } from 'sonner';
import { t } from '@/i18n/uz';
import { DatePicker } from '@/shared/components/DatePicker';
import { ErrorState } from '@/shared/components/ErrorState';
import { FormField } from '@/shared/components/FormField';
import { MoneyText } from '@/shared/components/MoneyText';
import { groupDigits, positiveMoneyField, toDecimal } from '@/shared/forms/fields';
import { z, zodResolver } from '@/shared/forms/zod';
import { formatDate, formatDateTime, todayInTashkent } from '@/shared/lib/format';
import { applyFieldErrors, toastError } from '@/shared/lib/mutation';
import { Button } from '@/shared/ui/button';
import { Input } from '@/shared/ui/input';
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from '@/shared/ui/sheet';
import { Skeleton } from '@/shared/ui/skeleton';
import { useAddCreditPayment, useCredit } from '../api/credits';
import { CreditRowBadge, CreditStatusBadge } from './CreditStatusBadge';

const schema = z.object({
  amount: positiveMoneyField(),
  date: z.string().min(1, { error: t.validation.dateRequired }),
  note: z.string().max(1000),
});
type FormValues = z.infer<typeof schema>;

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border bg-muted/30 p-2.5">
      <p className="text-xs text-muted-foreground">{label}</p>
      <MoneyText value={value} className="mt-1 block text-sm font-semibold" />
    </div>
  );
}

/** To'lov formasi: kalit nasiya bo'yicha — boshqa nasiya ochilganda maydonlar toza boshlanadi. */
function PaymentForm({ creditId, suggested }: { creditId: string; suggested: string | null }) {
  const add = useAddCreditPayment();
  const [lastNote, setLastNote] = useState<string | null>(null);
  const { register, control, handleSubmit, reset, setValue, setError, formState } =
    useForm<FormValues>({
      resolver: zodResolver(schema),
      defaultValues: {
        amount: suggested ? groupDigits(suggested.replace(/\.00$/, '')) : '',
        date: todayInTashkent(),
        note: '',
      },
    });

  const onSubmit = handleSubmit(async (v) => {
    try {
      const updated = await add.mutateAsync({
        id: creditId,
        input: { amount: toDecimal(v.amount), date: v.date, note: v.note.trim() || null },
      });
      toast.success(t.credits.payment.saved);
      setLastNote(
        updated.next ? t.credits.payment.nextHint(formatDate(updated.next.dueDate)) : null,
      );
      reset({
        amount: updated.next ? groupDigits(updated.next.amount.replace(/\.00$/, '')) : '',
        date: todayInTashkent(),
        note: '',
      });
    } catch (error) {
      if (!applyFieldErrors(error, setError)) toastError(error);
    }
  });

  const e = formState.errors;
  return (
    <form onSubmit={onSubmit} className="space-y-3 rounded-lg border p-3" noValidate>
      <h3 className="text-sm font-semibold">{t.credits.payment.title}</h3>
      <div className="grid gap-3 sm:grid-cols-2">
        <FormField
          id="cp-amount"
          label={t.credits.payment.amount}
          required
          error={e.amount?.message}
        >
          <Input
            id="cp-amount"
            inputMode="decimal"
            aria-invalid={!!e.amount}
            {...register('amount', {
              onBlur: (ev) => setValue('amount', groupDigits(ev.target.value)),
            })}
          />
        </FormField>
        <FormField id="cp-date" label={t.credits.payment.date} required error={e.date?.message}>
          <Controller
            control={control}
            name="date"
            render={({ field }) => (
              <DatePicker id="cp-date" value={field.value} onChange={field.onChange} />
            )}
          />
        </FormField>
        <FormField id="cp-note" label={t.credits.payment.note} optional className="sm:col-span-2">
          <Input id="cp-note" {...register('note')} />
        </FormField>
      </div>
      <Button type="submit" className="w-full" disabled={formState.isSubmitting}>
        {formState.isSubmitting ? <Loader2 className="animate-spin" /> : null}
        {t.credits.payment.submit}
      </Button>
      <p className="text-xs text-muted-foreground">{lastNote ?? t.credits.payment.hint}</p>
    </form>
  );
}

export function CreditDetailSheet({
  creditId,
  onOpenChange,
}: {
  creditId: string | null;
  onOpenChange: (open: boolean) => void;
}) {
  const { data: c, isPending, error, refetch } = useCredit(creditId);
  return (
    <Sheet open={Boolean(creditId)} onOpenChange={onOpenChange}>
      <SheetContent className="w-full gap-0 sm:max-w-xl">
        <SheetHeader>
          <SheetTitle>{c?.debtorName ?? t.credits.detail.title}</SheetTitle>
          <SheetDescription>
            {c ? `${c.number} · ${formatDateTime(c.takenAt)}` : t.credits.detail.title}
          </SheetDescription>
        </SheetHeader>
        <div className="flex-1 space-y-5 overflow-y-auto px-4 pb-6">
          {error ? (
            <ErrorState message={t.errors.unexpected} onRetry={() => refetch()} />
          ) : isPending || !c ? (
            <Skeleton className="h-64 w-full" />
          ) : (
            <>
              <div className="flex flex-wrap items-center gap-3">
                <CreditStatusBadge status={c.status} />
                <a
                  href={`tel:${c.debtorPhone}`}
                  className="inline-flex items-center gap-1.5 text-sm text-primary hover:underline"
                >
                  <Phone className="size-3.5" aria-hidden />
                  {c.debtorPhone}
                </a>
              </div>
              <div className="grid grid-cols-3 gap-2">
                <Metric label={t.credits.col.amount} value={c.amount} />
                <Metric label={t.credits.col.paid} value={c.paidAmount} />
                <Metric label={t.credits.col.remaining} value={c.remainingAmount} />
              </div>
              {c.note ? <p className="text-sm text-muted-foreground">{c.note}</p> : null}

              {c.status !== 'PAID' ? (
                <PaymentForm key={c.id} creditId={c.id} suggested={c.next?.amount ?? null} />
              ) : null}

              <section className="space-y-2">
                <h3 className="text-sm font-semibold">{t.credits.detail.schedule}</h3>
                <ul className="divide-y rounded-lg border">
                  {c.schedule.map((row) => (
                    <li key={row.seq} className="flex items-center gap-3 p-2.5 text-sm">
                      <span className="w-20 shrink-0 tabular-nums">{formatDate(row.dueDate)}</span>
                      <span className="min-w-0 flex-1">
                        <MoneyText value={row.amount} className="block font-medium" />
                        {row.state === 'PAID' || row.paid === '0.00' ? null : (
                          <span className="block text-xs text-muted-foreground">
                            {t.credits.detail.paidPart}: <MoneyText value={row.paid} />
                          </span>
                        )}
                        {row.toPay !== '0.00' && row.toPay !== row.remaining ? (
                          <span className="block text-xs text-warning">
                            {t.credits.detail.toPay}: <MoneyText value={row.toPay} />
                          </span>
                        ) : null}
                        {row.state === 'CARRIED' ? (
                          <span className="block text-xs text-warning">
                            {t.credits.detail.carried}: <MoneyText value={row.remaining} />
                          </span>
                        ) : null}
                      </span>
                      <CreditRowBadge state={row.state} />
                    </li>
                  ))}
                </ul>
              </section>

              <section className="space-y-2">
                <h3 className="text-sm font-semibold">{t.credits.detail.payments}</h3>
                {c.payments.length === 0 ? (
                  <p className="text-sm text-muted-foreground">{t.credits.detail.noPayments}</p>
                ) : (
                  <ul className="divide-y rounded-lg border">
                    {c.payments.map((p) => (
                      <li key={p.id} className="flex items-center justify-between gap-3 p-2.5">
                        <span className="min-w-0 text-sm">
                          <span className="block tabular-nums">{formatDate(p.date)}</span>
                          {p.note ? (
                            <span className="block truncate text-xs text-muted-foreground">
                              {p.note}
                            </span>
                          ) : null}
                        </span>
                        <MoneyText value={p.amount} className="text-sm font-medium" />
                      </li>
                    ))}
                  </ul>
                )}
              </section>
            </>
          )}
        </div>
      </SheetContent>
    </Sheet>
  );
}
