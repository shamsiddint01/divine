import { Search, X } from 'lucide-react';
import { useEffect, useState } from 'react';
import { t } from '@/i18n/uz';
import { useDebouncedValue } from '@/shared/hooks/use-debounced-value';
import { cn } from '@/shared/lib/utils';
import { Input } from '@/shared/ui/input';

interface SearchInputProps {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  className?: string;
  autoFocus?: boolean;
}

/** Qidiruv maydoni: yozish tugagandan 300 ms keyin `onChange` chaqiriladi. */
export function SearchInput({
  value,
  onChange,
  placeholder,
  className,
  autoFocus,
}: SearchInputProps) {
  const [draft, setDraft] = useState(value);
  const [prevValue, setPrevValue] = useState(value);
  const debounced = useDebouncedValue(draft, 300);

  // Tashqaridan qiymat o'zgarsa (masalan, "Filtrlarni tozalash") — maydonni sinxronlash.
  if (value !== prevValue) {
    setPrevValue(value);
    setDraft(value);
  }
  useEffect(() => {
    if (debounced !== value) onChange(debounced.trim());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [debounced]);

  return (
    <div className={cn('relative w-full sm:w-72', className)}>
      <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" />
      <Input
        type="search"
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        placeholder={placeholder ?? t.common.search}
        aria-label={placeholder ?? t.common.search}
        className="pr-8 pl-9 [&::-webkit-search-cancel-button]:hidden"
        autoFocus={autoFocus}
      />
      {draft ? (
        <button
          type="button"
          onClick={() => {
            setDraft('');
            onChange('');
          }}
          className="absolute top-1/2 right-2 -translate-y-1/2 rounded-sm p-0.5 text-muted-foreground hover:text-foreground"
          aria-label={t.common.reset}
        >
          <X className="size-4" />
        </button>
      ) : null}
    </div>
  );
}
