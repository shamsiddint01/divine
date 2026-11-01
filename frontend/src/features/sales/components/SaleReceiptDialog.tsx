import { CheckCircle2, Printer } from 'lucide-react';
import { t } from '@/i18n/uz';
import { formatDateTime, formatMoney, formatPhone, formatQuantity } from '@/shared/lib/format';
import { Button } from '@/shared/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/shared/ui/dialog';
import { Separator } from '@/shared/ui/separator';
import type { SaleDto } from '@/shared/types/api';

/** Sotuv yakunlangandan keyingi chek ko'rinishi. */
export function SaleReceiptDialog({
  sale,
  onClose,
}: {
  sale: SaleDto | null;
  onClose: () => void;
}) {
  return (
    <Dialog open={Boolean(sale)} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader className="items-center text-center">
          <span className="mb-1 flex size-12 items-center justify-center rounded-full bg-success/12 text-success">
            <CheckCircle2 className="size-6" />
          </span>
          <DialogTitle>{t.sales.receipt.title}</DialogTitle>
          <DialogDescription>{sale ? formatDateTime(sale.soldAt) : null}</DialogDescription>
        </DialogHeader>
        {sale ? (
          <div className="space-y-3 text-sm">
            <div className="grid grid-cols-2 gap-y-1">
              <span className="text-muted-foreground">{t.sales.receipt.number}</span>
              <span className="text-right font-mono">{sale.number}</span>
              <span className="text-muted-foreground">{t.sales.customer.title}</span>
              <span className="text-right">{sale.customer.name}</span>
              {sale.customer.phone ? (
                <>
                  <span className="text-muted-foreground">{t.sales.customer.phone}</span>
                  <span className="text-right tabular-nums">
                    {formatPhone(sale.customer.phone)}
                  </span>
                </>
              ) : null}
              <span className="text-muted-foreground">{t.sales.receipt.seller}</span>
              <span className="text-right">{sale.user.fullName ?? sale.user.login}</span>
              <span className="text-muted-foreground">{t.sales.warehouse}</span>
              <span className="text-right">{sale.warehouse.name}</span>
            </div>
            <Separator />
            <ul className="space-y-1.5">
              {sale.items?.map((i) => (
                <li key={i.productId} className="flex justify-between gap-3">
                  <span className="min-w-0">
                    <span className="block truncate">{i.productName}</span>
                    <span className="text-xs text-muted-foreground tabular-nums">
                      {formatQuantity(i.quantity)} {t.units[i.unit]} × {formatMoney(i.unitPrice)}
                    </span>
                  </span>
                  <span className="shrink-0 tabular-nums">{formatMoney(i.lineTotal)}</span>
                </li>
              ))}
            </ul>
            <Separator />
            <div className="flex items-baseline justify-between">
              <span className="font-medium">{t.sales.cart.total}</span>
              <span className="text-lg font-bold tabular-nums sm:text-xl">
                {formatMoney(sale.totalAmount)}
              </span>
            </div>
          </div>
        ) : null}
        <DialogFooter className="sm:justify-between">
          <Button variant="outline" onClick={() => window.print()}>
            <Printer />
            {t.sales.receipt.print}
          </Button>
          <Button onClick={onClose} autoFocus>
            {t.sales.receipt.newSale}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
