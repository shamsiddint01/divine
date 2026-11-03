import { ShoppingCart, Trash2 } from 'lucide-react';
import { t } from '@/i18n/uz';
import { formatMoney, formatQuantity } from '@/shared/lib/format';
import { EmptyState } from '@/shared/components/EmptyState';
import { QuantityStepper } from '@/shared/components/QuantityStepper';
import { Button } from '@/shared/ui/button';
import { type CartLine, cartTotals, lineSubtotal } from '../lib/cart';

interface CartPanelProps {
  lines: CartLine[];
  onQuantity: (productId: string, quantity: string) => void;
  onRemove: (productId: string) => void;
}

export function CartPanel({ lines, onQuantity, onRemove }: CartPanelProps) {
  const totals = cartTotals(lines);
  if (lines.length === 0) {
    return (
      <EmptyState
        icon={ShoppingCart}
        title={t.sales.cart.empty}
        description={t.sales.cart.emptyHint}
      />
    );
  }
  return (
    <div className="space-y-3">
      <div
        className="flex justify-between px-3 text-xs font-medium text-muted-foreground"
        aria-hidden
      >
        <span>{t.sales.cart.product}</span>
        <span>{t.sales.cart.subtotal}</span>
      </div>
      <ul className="divide-y rounded-lg border">
        {lines.map((line) => (
          <li key={line.productId} className="space-y-2 p-3">
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0">
                <p className="truncate text-sm font-medium">{line.name}</p>
                <p className="text-xs text-muted-foreground tabular-nums">
                  {t.sales.cart.price}: {formatMoney(line.unitPrice)} / {t.units[line.unit]}
                </p>
              </div>
              <Button
                variant="ghost"
                size="icon"
                className="size-9 shrink-0 text-destructive hover:bg-destructive/10 hover:text-destructive"
                onClick={() => onRemove(line.productId)}
                aria-label={t.sales.cart.remove}
              >
                <Trash2 className="size-5" />
              </Button>
            </div>
            <div className="flex items-center justify-between gap-2">
              <QuantityStepper
                value={line.quantity}
                onChange={(q) => onQuantity(line.productId, q)}
                allowDecimal={line.allowDecimal}
                max={line.stock}
                ariaLabel={`${t.sales.cart.quantity}: ${line.name}`}
              />
              <span className="text-sm font-semibold tabular-nums">
                {formatMoney(lineSubtotal(line))}
              </span>
            </div>
          </li>
        ))}
      </ul>
      <div className="space-y-1.5 rounded-lg bg-muted/50 p-3 text-sm">
        <div className="flex justify-between gap-2 text-muted-foreground">
          <span className="tabular-nums">
            {t.sales.cart.totalQuantity(formatQuantity(totals.totalQuantity))}
          </span>
          <span>{t.sales.cart.itemsCount(totals.positions)}</span>
        </div>
        <div className="flex items-baseline justify-between">
          <span className="font-medium">{t.sales.cart.total}</span>
          <span className="text-xl font-bold tracking-tight tabular-nums sm:text-2xl">
            {formatMoney(totals.totalAmount)}
          </span>
        </div>
      </div>
    </div>
  );
}
