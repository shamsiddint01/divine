import { t } from '@/i18n/uz';
import { ErrorState } from '@/shared/components/ErrorState';
import { MoneyText } from '@/shared/components/MoneyText';
import { StatusBadge } from '@/shared/components/StatusBadge';
import { formatDate, formatQuantity } from '@/shared/lib/format';
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from '@/shared/ui/sheet';
import { Skeleton } from '@/shared/ui/skeleton';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/shared/ui/table';
import { useIncomingReportDetail } from '../api/reports';

/** Kirim hisoboti qatori bosilganda: hujjatga qaysi mahsulotlar, qancha va qaysi narxda qo'shilgan. */
export function IncomingDetailSheet({
  number,
  onClose,
}: {
  number: string | null;
  onClose: () => void;
}) {
  const { data: doc, isPending, error, refetch } = useIncomingReportDetail(number);
  const L = t.reports.incomingDetail;
  return (
    <Sheet open={Boolean(number)} onOpenChange={(open) => !open && onClose()}>
      <SheetContent className="w-full gap-0 sm:max-w-xl">
        <SheetHeader>
          <SheetTitle className="flex items-center gap-2">
            {L.title}
            <span className="font-mono text-sm text-muted-foreground">{number}</span>
          </SheetTitle>
          <SheetDescription>{doc ? formatDate(doc.date) : null}</SheetDescription>
        </SheetHeader>
        <div className="flex-1 space-y-5 overflow-y-auto p-5">
          {error ? (
            <ErrorState message={error.message} onRetry={() => refetch()} />
          ) : isPending || !doc ? (
            <Skeleton className="h-64 w-full" />
          ) : (
            <>
              <dl className="grid grid-cols-2 gap-x-4 gap-y-2 rounded-lg border p-4 text-sm">
                <dt className="text-muted-foreground">{t.reports.filters.warehouse}</dt>
                <dd className="text-right font-medium">{doc.warehouse}</dd>
                <dt className="text-muted-foreground">{L.createdBy}</dt>
                <dd className="text-right">{doc.createdBy.fullName ?? doc.createdBy.login}</dd>
                <dt className="text-muted-foreground">{t.common.status}</dt>
                <dd className="text-right">
                  <StatusBadge status={doc.status} />
                </dd>
                {doc.notes ? (
                  <>
                    <dt className="text-muted-foreground">{L.notes}</dt>
                    <dd className="text-right">{doc.notes}</dd>
                  </>
                ) : null}
              </dl>
              <section className="space-y-2">
                <h3 className="text-sm font-semibold">{L.items}</h3>
                {doc.items.length === 0 ? (
                  <p className="rounded-lg border p-4 text-sm text-muted-foreground">{L.empty}</p>
                ) : (
                  <div className="overflow-hidden rounded-lg border">
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>{L.product}</TableHead>
                          <TableHead className="text-right">{L.quantity}</TableHead>
                          {/* Narx va summa — faqat `products.read_cost` bo'lsa javobda bor (OWN-06). */}
                          {doc.totalAmount !== undefined ? (
                            <TableHead className="text-right">{L.amount}</TableHead>
                          ) : null}
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {doc.items.map((i) => (
                          <TableRow key={i.productId}>
                            <TableCell className="whitespace-normal">
                              <p className="font-medium">{i.productName}</p>
                              {i.costPrice !== undefined ? (
                                <p className="text-xs text-muted-foreground">
                                  <MoneyText value={i.costPrice} />
                                </p>
                              ) : null}
                              {i.barcode ? (
                                <p className="font-mono text-xs text-muted-foreground">
                                  {i.barcode}
                                </p>
                              ) : null}
                            </TableCell>
                            <TableCell className="text-right tabular-nums">
                              {formatQuantity(i.quantity)} {t.units[i.unit]}
                            </TableCell>
                            {i.lineTotal !== undefined ? (
                              <TableCell className="text-right">
                                <MoneyText value={i.lineTotal} />
                              </TableCell>
                            ) : null}
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </div>
                )}
              </section>
              <div className="space-y-1.5 rounded-lg bg-muted/50 p-4 text-sm">
                <div className="flex justify-between">
                  <span className="text-muted-foreground">{L.totalQuantity}</span>
                  <span className="tabular-nums">{formatQuantity(doc.totalQuantity)}</span>
                </div>
                {doc.totalAmount !== undefined ? (
                  <div className="flex items-baseline justify-between pt-1">
                    <span className="font-medium">{L.total}</span>
                    <MoneyText value={doc.totalAmount} className="text-lg font-bold sm:text-xl" />
                  </div>
                ) : null}
              </div>
            </>
          )}
        </div>
      </SheetContent>
    </Sheet>
  );
}
