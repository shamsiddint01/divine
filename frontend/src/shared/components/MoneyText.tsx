import { formatMoney, formatQuantity } from '@/shared/lib/format';
import { cn } from '@/shared/lib/utils';
import { t } from '@/i18n/uz';
import type { ProductUnit } from '@divine/shared';

/** Pul summasi — jadvallarda tekis turishi uchun tabular raqamlar. */
export function MoneyText({
  value,
  className,
  muted,
}: {
  value: string | undefined | null;
  className?: string;
  muted?: boolean;
}) {
  if (value === undefined || value === null)
    return <span className="text-muted-foreground">{t.common.notSet}</span>;
  return (
    <span className={cn('tabular-nums', muted && 'text-muted-foreground', className)}>
      {formatMoney(value)}
    </span>
  );
}

/** Miqdor + birlik: `12,5 kg` */
export function QtyText({
  value,
  unit,
  className,
}: {
  value: string;
  unit?: ProductUnit;
  className?: string;
}) {
  return (
    <span className={cn('tabular-nums', className)}>
      {formatQuantity(value)}
      {unit ? <span className="text-muted-foreground"> {t.units[unit]}</span> : null}
    </span>
  );
}
