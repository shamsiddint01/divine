import { Check, ChevronsUpDown, Loader2, RotateCw, Search, X } from 'lucide-react';
import { type KeyboardEvent, useId, useState } from 'react';
import { t } from '@/i18n/uz';
import { useDebouncedValue } from '@/shared/hooks/use-debounced-value';
import { cn } from '@/shared/lib/utils';
import { Button } from '@/shared/ui/button';
import { Input } from '@/shared/ui/input';
import { Popover, PopoverContent, PopoverTrigger } from '@/shared/ui/popover';
import type { ProductDto } from '@/shared/types/api';
import { useProduct, useProducts, useRememberProduct } from '../api/products';

interface ProductComboboxProps {
  id?: string;
  /** Tanlangan mahsulot ID'si ('' — tanlanmagan). */
  value: string;
  onChange: (product: ProductDto | null) => void;
  /** Berilsa — ro'yxat boshida "Barcha …" varianti chiqadi (filtrlar uchun). */
  clearLabel?: string;
  placeholder?: string;
  /** Allaqachon tanlangan (masalan, boshqa qatorlarda) mahsulotlar — tanlab bo'lmaydi. */
  disabledIds?: string[];
  /** Filtrlar uchun: arxivlangan mahsulotlar ham qidiriladi (tarixiy hujjatlar). */
  includeArchived?: boolean;
  invalid?: boolean;
  disabled?: boolean;
  className?: string;
  'aria-label'?: string;
}

const RESULT_LIMIT = 20;

/**
 * Mahsulot tanlash: qidiruv SERVER-SIDE (`/products?search=`), shuning uchun katalog hajmidan qat'i nazar
 * istalgan mahsulotni topish mumkin. Klaviatura: ↑/↓ — tanlash, Enter — tasdiqlash, Escape — yopish.
 */
export function ProductCombobox({
  id,
  value,
  onChange,
  clearLabel,
  placeholder = t.products.pickPlaceholder,
  disabledIds = [],
  includeArchived = false,
  invalid,
  disabled,
  className,
  'aria-label': ariaLabel,
}: ProductComboboxProps) {
  const listId = useId();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [active, setActive] = useState(0);
  const search = useDebouncedValue(query.trim(), 250);

  // Tanlangan mahsulot nomi — joriy natijalarda bo'lmasa ham (ID bo'yicha alohida so'rov).
  const selectedQuery = useProduct(value || null);
  const selected = value ? selectedQuery.data : undefined;

  const results = useProducts(
    {
      search,
      status: includeArchived ? undefined : 'ACTIVE',
      pageSize: RESULT_LIMIT,
      sort: 'name:asc',
    },
    { enabled: open },
  );
  const items = results.data?.data ?? [];
  const options: (ProductDto | null)[] = clearLabel ? [null, ...items] : items;

  const remember = useRememberProduct();
  const choose = (product: ProductDto | null) => {
    if (product) remember(product);
    onChange(product);
    setOpen(false);
    setQuery('');
  };

  const isDisabled = (p: ProductDto | null) =>
    p !== null && disabledIds.includes(p.id) && p.id !== value;

  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      const step = event.key === 'ArrowDown' ? 1 : -1;
      setActive((i) => (options.length === 0 ? 0 : (i + step + options.length) % options.length));
    } else if (event.key === 'Enter') {
      event.preventDefault();
      const option = options[active];
      if (option !== undefined && !isDisabled(option)) choose(option);
    }
  };

  const label =
    selected?.name ??
    (value ? (selectedQuery.isError ? value : t.common.loading) : (clearLabel ?? placeholder));

  return (
    <Popover
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        setActive(0);
        if (!next) setQuery('');
      }}
    >
      <PopoverTrigger asChild>
        <Button
          id={id}
          variant="outline"
          role="combobox"
          aria-expanded={open}
          aria-controls={listId}
          aria-label={ariaLabel}
          aria-invalid={invalid || undefined}
          disabled={disabled}
          className={cn(
            'w-full justify-between bg-card font-normal',
            !selected && !clearLabel && 'text-muted-foreground',
            invalid && 'border-destructive',
            className,
          )}
        >
          <span className="truncate">{label}</span>
          <ChevronsUpDown className="opacity-50" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-[min(380px,calc(100vw-2rem))] p-0" align="start">
        <div className="relative border-b p-2">
          <Search className="pointer-events-none absolute top-1/2 left-4 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              setActive(0);
            }}
            onKeyDown={onKeyDown}
            placeholder={t.products.searchPlaceholder}
            aria-label={t.products.searchPlaceholder}
            aria-controls={listId}
            aria-activedescendant={options.length > 0 ? `${listId}-${active}` : undefined}
            className="h-8 border-0 pl-8 shadow-none focus-visible:ring-0"
            autoFocus
          />
          {results.isFetching ? (
            <Loader2 className="absolute top-1/2 right-4 size-4 -translate-y-1/2 animate-spin text-muted-foreground" />
          ) : null}
        </div>
        <ul id={listId} className="max-h-72 overflow-y-auto p-1" role="listbox">
          {results.error && !results.data ? (
            // Yuklanmasa "topilmadi" deb ko'rsatilmaydi: xato matni va qayta urinish.
            <li role="alert" className="space-y-2 px-2 py-4 text-center text-sm">
              <p className="text-destructive">{results.error.message}</p>
              <Button variant="outline" size="sm" onClick={() => results.refetch()}>
                <RotateCw />
                {t.common.retry}
              </Button>
            </li>
          ) : results.isPending ? (
            <li className="px-2 py-6 text-center text-sm text-muted-foreground">
              {t.common.loading}
            </li>
          ) : options.length === 0 ? (
            <li className="px-2 py-6 text-center text-sm text-muted-foreground">
              {t.products.noResults}
            </li>
          ) : (
            options.map((p, index) => (
              <li key={p?.id ?? '__all__'}>
                <button
                  id={`${listId}-${index}`}
                  type="button"
                  role="option"
                  aria-selected={(p?.id ?? '') === value}
                  disabled={isDisabled(p)}
                  onMouseEnter={() => setActive(index)}
                  onClick={() => choose(p)}
                  className={cn(
                    'flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-left text-sm disabled:opacity-40',
                    index === active && 'bg-accent text-accent-foreground',
                  )}
                >
                  <Check
                    className={cn(
                      'size-4 shrink-0',
                      (p?.id ?? '') === value ? 'opacity-100' : 'opacity-0',
                    )}
                  />
                  {p ? (
                    <span className="min-w-0 flex-1">
                      <span className="block truncate">{p.name}</span>
                      <span className="block truncate text-xs text-muted-foreground">
                        {p.groupName}
                        {p.barcode ? <span className="font-mono"> · {p.barcode}</span> : null}
                      </span>
                    </span>
                  ) : (
                    <span className="flex items-center gap-1.5 text-muted-foreground">
                      <X className="size-3.5" />
                      {clearLabel}
                    </span>
                  )}
                </button>
              </li>
            ))
          )}
        </ul>
      </PopoverContent>
    </Popover>
  );
}
