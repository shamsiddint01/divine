import { UserCheck, X } from 'lucide-react';
import { useState } from 'react';
import { useCustomers } from '@/features/customers/api/customers';
import { t } from '@/i18n/uz';
import { useDebouncedValue } from '@/shared/hooks/use-debounced-value';
import { formatPhone } from '@/shared/lib/format';
import { FormField } from '@/shared/components/FormField';
import { Badge } from '@/shared/ui/badge';
import { Input } from '@/shared/ui/input';

export interface CustomerDraft {
  id: string | null;
  name: string;
  phone: string;
}

interface CustomerFieldsProps {
  value: CustomerDraft;
  onChange: (value: CustomerDraft) => void;
  errors: { name?: string; phone?: string };
}

/**
 * Mijoz: ism va telefon IXTIYORIY (ism bo'lmasa — umumiy "Noma'lum mijoz", 2026-11-03; BR-06).
 * Mavjud mijozlardan tavsiya beriladi.
 */
export function CustomerFields({ value, onChange, errors }: CustomerFieldsProps) {
  const [focused, setFocused] = useState(false);
  const query = useDebouncedValue(value.name.trim(), 250);
  const { data, error } = useCustomers(
    { search: query, pageSize: 5, sort: 'lastPurchaseAt:desc' },
    focused && !value.id && query.length >= 2,
  );
  const searching = focused && !value.id && query.length >= 2;
  const suggestions = searching ? (data?.data ?? []) : [];
  // Tavsiyalar ixtiyoriy: yuklanmasa sotuv to'xtamaydi, faqat sabab aytiladi.
  const suggestionsFailed = searching && !!error && !data;

  return (
    <div className="space-y-3">
      <FormField
        id="pos-customer"
        label={t.sales.customer.name}
        optional
        error={errors.name}
        hint={value.id ? undefined : t.sales.customer.nameHint}
      >
        <div className="relative">
          <Input
            id="pos-customer"
            value={value.name}
            onChange={(e) => onChange({ ...value, id: null, name: e.target.value })}
            onFocus={() => setFocused(true)}
            onBlur={() => setTimeout(() => setFocused(false), 150)}
            placeholder={t.sales.customer.namePlaceholder}
            aria-invalid={!!errors.name}
            autoComplete="off"
            className={value.id ? 'pr-24' : undefined}
          />
          {value.id ? (
            <span className="absolute top-1/2 right-2 flex -translate-y-1/2 items-center gap-1">
              <Badge variant="success">
                <UserCheck />
                {t.sales.customer.existing}
              </Badge>
              <button
                type="button"
                className="rounded p-0.5 text-muted-foreground hover:text-foreground"
                onClick={() => onChange({ id: null, name: '', phone: '' })}
                aria-label={t.common.reset}
              >
                <X className="size-3.5" />
              </button>
            </span>
          ) : null}
          {suggestionsFailed ? (
            <p
              role="alert"
              className="absolute inset-x-0 top-full z-20 mt-1 rounded-md border bg-popover px-3 py-2 text-xs text-muted-foreground shadow-md"
            >
              {t.sales.customer.suggestionsFailed}
            </p>
          ) : suggestions.length > 0 ? (
            <div className="absolute inset-x-0 top-full z-20 mt-1 overflow-hidden rounded-md border bg-popover shadow-md">
              <p className="px-3 pt-2 pb-1 text-[11px] font-medium text-muted-foreground uppercase">
                {t.sales.customer.suggestions}
              </p>
              {suggestions.map((c) => (
                <button
                  key={c.id}
                  type="button"
                  className="flex w-full items-center justify-between gap-3 px-3 py-2 text-left text-sm hover:bg-accent"
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() => {
                    onChange({ id: c.id, name: c.name, phone: c.phone ?? '' });
                    setFocused(false);
                  }}
                >
                  <span className="truncate font-medium">{c.name}</span>
                  <span className="shrink-0 text-xs text-muted-foreground tabular-nums">
                    {formatPhone(c.phone)}
                  </span>
                </button>
              ))}
            </div>
          ) : null}
        </div>
      </FormField>
      <FormField id="pos-phone" label={t.sales.customer.phone} optional error={errors.phone}>
        <Input
          id="pos-phone"
          type="tel"
          inputMode="tel"
          value={value.phone}
          onChange={(e) => onChange({ ...value, phone: e.target.value })}
          placeholder={t.sales.customer.phonePlaceholder}
          aria-invalid={!!errors.phone}
          disabled={Boolean(value.id)}
        />
      </FormField>
    </div>
  );
}
