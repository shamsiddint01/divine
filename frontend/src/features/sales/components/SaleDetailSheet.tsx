import { t } from '@/i18n/uz';
import { formatDateTime, formatPhone, formatQuantity } from '@/shared/lib/format';
import { ErrorState } from '@/shared/components/ErrorState';
import { MoneyText } from '@/shared/components/MoneyText';
import { StatusBadge } from '@/shared/components/StatusBadge';
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from '@/shared/ui/sheet';
import { Skeleton } from '@/shared/ui/skeleton';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/shared/ui/table';
import { useSale } from '../api/sales';

export function SaleDetailSheet({
  saleId,
  onClose,
}: {
  saleId: string | null;
  onClose: () => void;
}) {
  const { data: sale, isPending, error, refetch } = useSale(saleId);
  return (
    <Sheet open={Boolean(saleId)} onOpenChange={(open) => !open && onClose()}>
      <SheetContent className="w-full gap-0 sm:max-w-xl">
        <SheetHeader>
          <SheetTitle className="flex items-center gap-2">
            {t.sales.detail.title}
            {sale ? (
              <span className="font-mono text-sm text-muted-foreground">{sale.number}</span>
            ) : null}
          </SheetTitle>
          <SheetDescription>{sale ? formatDateTime(sale.soldAt) : null}</SheetDescription>
        </SheetHeader>
        <div className="flex-1 space-y-5 overflow-y-auto p-5">
          {error ? (
            <ErrorState message={error.message} onRetry={() => refetch()} />
          ) : isPending || !sale ? (
            <Skeleton className="h-64 w-full" />
          ) : (
            <>
              <dl className="grid grid-cols-2 gap-x-4 gap-y-2 rounded-lg border p-4 text-sm">
                <dt className="text-muted-foreground">{t.sales.customer.title}</dt>
                <dd className="text-right font-medium">{sale.customer.name}</dd>
                <dt className="text-muted-foreground">{t.sales.customer.phone}</dt>
                <dd className="text-right tabular-nums">{formatPhone(sale.customer.phone)}</dd>
                <dt className="text-muted-foreground">{t.sales.receipt.seller}</dt>
                <dd className="text-right">{sale.user.fullName ?? sale.user.login}</dd>
                <dt className="text-muted-foreground">{t.sales.warehouse}</dt>
                <dd className="text-right">{sale.warehouse.name}</dd>
                <dt className="text-muted-foreground">{t.sales.priceType.label}</dt>
                <dd className="text-right">{t.sales.priceType[sale.priceType]}</dd>
                {sale.credit ? (
                  <>
                    <dt className="text-muted-foreground">{t.sales.credit.receiptPaid}</dt>
                    <dd className="text-right">
                      <MoneyText value={sale.credit.paidAmount} />
                    </dd>
                    <dt className="text-muted-foreground">{t.sales.credit.receiptDebt}</dt>
                    <dd className="text-right font-medium">
                      <MoneyText value={sale.credit.amount} />
                    </dd>
                  </>
                ) : null}
                <dt className="text-muted-foreground">{t.common.status}</dt>
                <dd className="text-right">
                  <StatusBadge status={sale.status} />
                </dd>
              </dl>
              <section className="space-y-2">
                <h3 className="text-sm font-semibold">{t.sales.detail.items}</h3>
                <div className="overflow-hidden rounded-lg border">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>{t.sales.cart.product}</TableHead>
                        <TableHead className="text-right">{t.sales.cart.quantity}</TableHead>
                        <TableHead className="text-right">{t.sales.cart.subtotal}</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {sale.items?.map((i) => (
                        <TableRow key={i.productId}>
                          <TableCell className="whitespace-normal">
                            <p className="font-medium">{i.productName}</p>
                            <p className="text-xs text-muted-foreground">
                              <MoneyText value={i.unitPrice} />
                            </p>
                          </TableCell>
                          <TableCell className="text-right tabular-nums">
                            {formatQuantity(i.quantity)} {t.units[i.unit]}
                          </TableCell>
                          <TableCell className="text-right">
                            <MoneyText value={i.lineTotal} />
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              </section>
              <div className="space-y-1.5 rounded-lg bg-muted/50 p-4 text-sm">
                {/* Tannarx va foyda — faqat `products.read_cost` bo'lsa javobda bor (OWN-06). */}
                {sale.totalCost !== undefined ? (
                  <>
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">{t.sales.detail.totalCost}</span>
                      <MoneyText value={sale.totalCost} muted />
                    </div>
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">{t.sales.detail.profit}</span>
                      <MoneyText value={sale.grossProfit} className="text-success" />
                    </div>
                  </>
                ) : null}
                <div className="flex items-baseline justify-between pt-1">
                  <span className="font-medium">{t.sales.cart.total}</span>
                  <MoneyText value={sale.totalAmount} className="text-lg font-bold sm:text-xl" />
                </div>
              </div>
            </>
          )}
        </div>
      </SheetContent>
    </Sheet>
  );
}
