import { LICENSE_CONTACT_PHONE } from '@divine/shared';
import { CalendarClock, CreditCard, Phone, Wallet } from 'lucide-react';
import type { ReactNode } from 'react';
import { t } from '@/i18n/uz';
import { ErrorState } from '@/shared/components/ErrorState';
import { PageHeader } from '@/shared/components/PageHeader';
import { apiMode } from '@/shared/lib/api-mode';
import { formatDate, formatMoney } from '@/shared/lib/format';
import { Button } from '@/shared/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/shared/ui/card';
import { Skeleton } from '@/shared/ui/skeleton';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/shared/ui/table';
import { useSiteLicense } from '../api/site';

function Stat({ label, value, hint }: { label: string; value: ReactNode; hint?: ReactNode }) {
  return (
    <Card className="gap-1 py-4">
      <CardContent className="space-y-1 px-4">
        <p className="text-sm text-muted-foreground">{label}</p>
        <p className="text-xl font-semibold tabular-nums">{value}</p>
        {hint ? <p className="text-xs text-muted-foreground">{hint}</p> : null}
      </CardContent>
    </Card>
  );
}

/** Admin: saytning to'lovi (egasining qarori, 2026-11-07). Ma'lumotni superadmin paneli yuboradi. */
export function BillingPage() {
  const { data, isPending, error, refetch } = useSiteLicense();
  const b = t.billing;

  if (apiMode !== 'http' || (!isPending && !error && !data)) {
    return (
      <>
        <PageHeader title={t.nav.billing} description={b.description} />
        <Card>
          <CardContent className="py-8 text-center text-sm text-muted-foreground">
            {b.notConfigured}
          </CardContent>
        </Card>
      </>
    );
  }

  return (
    <>
      <PageHeader title={t.nav.billing} description={b.description} />
      {error ? (
        <ErrorState message={error.message} onRetry={() => refetch()} />
      ) : isPending || !data ? (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {Array.from({ length: 4 }, (_, i) => (
            <Skeleton key={i} className="h-24" />
          ))}
        </div>
      ) : (
        <>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <Stat
              label={b.agreedPrice}
              value={data.agreedPrice ? formatMoney(data.agreedPrice, { withCurrency: true }) : '—'}
              hint={b.perMonth}
            />
            <Stat
              label={b.lastPaidAt}
              value={data.lastPaidAt ? formatDate(data.lastPaidAt) : '—'}
            />
            <Stat
              label={b.nextPayment}
              value={formatDate(data.paidUntil)}
              hint={b.daysLeft(data.daysLeft)}
            />
            <Stat
              label={b.balance}
              value={formatMoney(data.balance, { withCurrency: true })}
              hint={
                data.amountDue
                  ? b.amountDue(formatMoney(data.amountDue, { withCurrency: true }))
                  : null
              }
            />
          </div>
          {data.graceUntil && data.graceUntil > data.paidUntil ? (
            <p className="text-sm text-muted-foreground">{b.grace(formatDate(data.graceUntil))}</p>
          ) : null}

          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <CreditCard className="size-4" />
                {b.payTitle}
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-3 text-sm">
              <p className="text-muted-foreground">{b.payRule}</p>
              <div className="flex flex-wrap gap-2">
                {(['Click', 'Payme', 'Paynet'] as const).map((name) => (
                  <Button key={name} variant="outline" disabled>
                    <Wallet />
                    {name}
                  </Button>
                ))}
              </div>
              <p className="text-muted-foreground">{b.paySoon}</p>
              <a
                href={`tel:${LICENSE_CONTACT_PHONE}`}
                className="inline-flex items-center gap-2 font-medium text-primary"
              >
                <Phone className="size-4" />
                {LICENSE_CONTACT_PHONE}
              </a>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <CalendarClock className="size-4" />
                {b.history}
              </CardTitle>
            </CardHeader>
            <CardContent className="p-0">
              {data.payments.length === 0 ? (
                <p className="px-6 pb-6 text-sm text-muted-foreground">{b.noPayments}</p>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>{b.paidAt}</TableHead>
                      <TableHead>{b.coveredUntil}</TableHead>
                      <TableHead className="text-right">{b.amount}</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {data.payments.map((payment, index) => (
                      <TableRow key={`${payment.paidAt}-${index}`}>
                        <TableCell>{formatDate(payment.paidAt)}</TableCell>
                        <TableCell>{formatDate(payment.paidUntil)}</TableCell>
                        <TableCell className="text-right tabular-nums">
                          {formatMoney(payment.amount, { withCurrency: true })}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </CardContent>
          </Card>
        </>
      )}
    </>
  );
}
