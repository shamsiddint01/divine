import { Minus, Plus } from 'lucide-react';
import { useState } from 'react';
import { t } from '@/i18n/uz';
import { addQty, compareQty, normalizeNumberInput } from '@/shared/lib/decimal';
import { formatQuantity } from '@/shared/lib/format';
import { cn } from '@/shared/lib/utils';
import { Button } from '@/shared/ui/button';
import { Input } from '@/shared/ui/input';

interface QuantityStepperProps {
  value: string;
  onChange: (value: string) => void;
  /** Kasr miqdorga ruxsat (kg, litr); aks holda faqat butun son. */
  allowDecimal?: boolean;
  max?: string;
  min?: string;
  className?: string;
  ariaLabel?: string;
}

/** Miqdorni +/− tugmalari yoki qo'lda kiritish (decimal-safe). */
export function QuantityStepper({
  value,
  onChange,
  allowDecimal = false,
  max,
  min = allowDecimal ? '0.001' : '1',
  className,
  ariaLabel,
}: QuantityStepperProps) {
  const [draft, setDraft] = useState(formatQuantity(value));
  const [prevValue, setPrevValue] = useState(value);
  if (value !== prevValue) {
    setPrevValue(value);
    setDraft(formatQuantity(value));
  }
  const step = '1';

  const clamp = (v: string) => {
    if (compareQty(v, min) < 0) return min;
    if (max !== undefined && compareQty(v, max) > 0) return max;
    return v;
  };

  const commit = (raw: string) => {
    const normalized = normalizeNumberInput(raw);
    if (!normalized) return setDraft(formatQuantity(value));
    const fixed = allowDecimal ? normalized : String(Math.floor(Number(normalized)));
    const next = clamp(fixed);
    onChange(next);
    setDraft(formatQuantity(next));
  };

  return (
    <div className={cn('inline-flex items-center rounded-md border bg-card shadow-xs', className)}>
      <Button
        type="button"
        variant="ghost"
        size="icon"
        className="size-8 rounded-r-none"
        disabled={compareQty(value, min) <= 0 || compareQty(addQty(value, `-${step}`), min) < 0}
        onClick={() => onChange(clamp(addQty(value, `-${step}`)))}
        aria-label={t.sales.cart.decrease}
      >
        <Minus />
      </Button>
      <Input
        value={draft}
        inputMode={allowDecimal ? 'decimal' : 'numeric'}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={(e) => commit(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') commit((e.target as HTMLInputElement).value);
        }}
        aria-label={ariaLabel ?? t.sales.cart.quantity}
        className="h-8 w-16 rounded-none border-0 border-x px-1 text-center shadow-none tabular-nums focus-visible:ring-0"
      />
      <Button
        type="button"
        variant="ghost"
        size="icon"
        className="size-8 rounded-l-none"
        disabled={max !== undefined && compareQty(addQty(value, step), max) > 0}
        onClick={() => onChange(clamp(addQty(value, step)))}
        aria-label={t.sales.cart.increase}
      >
        <Plus />
      </Button>
    </div>
  );
}
