import { Barcode, PackageSearch, Plus } from 'lucide-react';
import { useRef, useState } from 'react';
import { useGroupOptions } from '@/features/product-groups/api/groups';
import { useProducts } from '@/features/products/api/products';
import { t } from '@/i18n/uz';
import { compareQty, subQty } from '@/shared/lib/decimal';
import { formatMoney, formatQuantity } from '@/shared/lib/format';
import { cn } from '@/shared/lib/utils';
import { EmptyState } from '@/shared/components/EmptyState';
import { ErrorState } from '@/shared/components/ErrorState';
import { FilterSelect } from '@/shared/components/FilterSelect';
import { SearchInput } from '@/shared/components/SearchInput';
import { Badge } from '@/shared/ui/badge';
import { Input } from '@/shared/ui/input';
import { Label } from '@/shared/ui/label';
import { Skeleton } from '@/shared/ui/skeleton';
import type { ProductDto } from '@/shared/types/api';

interface ProductPickerProps {
  warehouseId: string;
  onPick: (product: ProductDto) => void;
  onBarcode: (code: string) => Promise<void>;
  /** Savatdagi miqdorlar — kartochkada qolgan qoldiqni ko'rsatish uchun. */
  inCart: Record<string, string>;
}

/** POS'ning chap qismi: shtrix-kod skaneri, qidiruv va mahsulot kartochkalari. */
export function ProductPicker({ warehouseId, onPick, onBarcode, inCart }: ProductPickerProps) {
  const [search, setSearch] = useState('');
  const [groupId, setGroupId] = useState('');
  const [barcode, setBarcode] = useState('');
  const [scanning, setScanning] = useState(false);
  const barcodeRef = useRef<HTMLInputElement>(null);
  // Katalog va ombor — bitta manbadan (aralash rejimda server): qoldiq tanlangan ombor bo'yicha.
  const { data: groups } = useGroupOptions();
  const { data, isPending, isFetching, error, refetch } = useProducts({
    warehouseId,
    status: 'ACTIVE',
    search,
    groupId,
    pageSize: 24,
    sort: search ? 'name:asc' : 'sold:desc',
  });

  // Skaner kodlari navbati: oldingi kod qidirilayotganda maydon yopilmaydi (aks holda skanerning
  // keyingi belgilari yo'qoladi) — har bir Enter darhol navbatga qo'shiladi va ketma-ket qo'shiladi.
  const scanQueue = useRef<string[]>([]);
  const draining = useRef(false);
  const submitBarcode = async () => {
    const code = barcode.trim();
    if (!code) return;
    setBarcode('');
    scanQueue.current.push(code);
    if (draining.current) return;
    draining.current = true;
    setScanning(true);
    try {
      for (let next = scanQueue.current.shift(); next; next = scanQueue.current.shift()) {
        await onBarcode(next);
      }
    } finally {
      draining.current = false;
      setScanning(false);
      barcodeRef.current?.focus();
    }
  };

  return (
    <div className="space-y-4">
      <div className="grid gap-1.5">
        <Label htmlFor="pos-barcode">{t.sales.barcodeLabel}</Label>
        <div className="relative">
          <Barcode
            className="pointer-events-none absolute top-1/2 left-3 size-5 -translate-y-1/2 text-primary"
            aria-hidden
          />
          <Input
            id="pos-barcode"
            ref={barcodeRef}
            value={barcode}
            onChange={(e) => setBarcode(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                void submitBarcode();
              }
            }}
            placeholder={t.sales.barcodePlaceholder}
            className="h-11 border-primary/40 bg-primary/[0.03] pl-10 font-mono text-base focus-visible:border-primary"
            autoFocus
            aria-busy={scanning}
            autoComplete="off"
          />
        </div>
      </div>
      <div className="flex flex-col gap-2 sm:flex-row">
        <SearchInput
          value={search}
          onChange={setSearch}
          placeholder={t.sales.searchPlaceholder}
          className="sm:flex-1"
        />
        <FilterSelect
          value={groupId}
          onChange={setGroupId}
          allLabel={t.products.allGroups}
          options={(groups ?? []).map((g) => ({ value: g.id, label: g.name }))}
        />
      </div>

      {error && !data ? (
        <ErrorState message={error.message} onRetry={() => refetch()} />
      ) : isPending ? (
        <div className="grid gap-3 sm:grid-cols-2 2xl:grid-cols-3">
          {Array.from({ length: 9 }, (_, i) => (
            <Skeleton key={i} className="h-24" />
          ))}
        </div>
      ) : data?.data.length === 0 ? (
        <EmptyState
          icon={PackageSearch}
          title={t.sales.productsEmpty}
          description={t.table.noResultsHint}
        />
      ) : (
        <div
          className={cn('grid gap-3 sm:grid-cols-2 2xl:grid-cols-3', isFetching && 'opacity-60')}
        >
          {data?.data.map((p) => {
            const left = inCart[p.id] ? subQty(p.stock, inCart[p.id] ?? '0') : p.stock;
            const out = compareQty(left, '0') <= 0;
            return (
              <button
                key={p.id}
                type="button"
                disabled={out}
                onClick={() => onPick(p)}
                className={cn(
                  'group flex flex-col justify-between gap-2 rounded-lg border bg-card p-3 text-left transition-all',
                  out
                    ? 'cursor-not-allowed opacity-60'
                    : 'hover:border-primary/50 hover:shadow-sm focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:outline-none',
                )}
              >
                <div className="space-y-0.5">
                  <p className="line-clamp-2 text-sm font-medium">{p.name}</p>
                  <p className="text-xs text-muted-foreground">{p.groupName}</p>
                </div>
                <div className="flex items-end justify-between gap-2">
                  <span className="text-sm font-semibold tabular-nums">
                    {formatMoney(p.salePrice)}
                  </span>
                  {out ? (
                    <Badge variant="destructive">{t.sales.outOfStock}</Badge>
                  ) : (
                    <span className="flex items-center gap-1.5">
                      <Badge
                        variant={p.isLowStock ? 'warning' : 'secondary'}
                        className="tabular-nums"
                      >
                        {formatQuantity(left)} {t.units[p.unit]}
                      </Badge>
                      <span
                        className="flex size-6 items-center justify-center rounded-md bg-primary text-primary-foreground opacity-0 transition-opacity group-hover:opacity-100"
                        aria-hidden
                      >
                        <Plus className="size-3.5" />
                      </span>
                    </span>
                  )}
                </div>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
