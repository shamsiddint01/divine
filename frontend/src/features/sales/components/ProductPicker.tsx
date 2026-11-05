import type { SalePriceType } from '@divine/shared';
import { Barcode, PackageSearch, Plus, ScanBarcode } from 'lucide-react';
import { useRef, useState } from 'react';
import { useGroupOptions } from '@/features/product-groups/api/groups';
import { useProducts } from '@/features/products/api/products';
import { t } from '@/i18n/uz';
import { compareQty, subQty } from '@/shared/lib/decimal';
import { formatMoney, formatQuantity } from '@/shared/lib/format';
import { cn } from '@/shared/lib/utils';
import { BarcodeScannerDialog } from '@/shared/components/BarcodeScannerDialog';
import { EmptyState } from '@/shared/components/EmptyState';
import { ErrorState } from '@/shared/components/ErrorState';
import { FilterSelect } from '@/shared/components/FilterSelect';
import { SearchInput } from '@/shared/components/SearchInput';
import { Badge } from '@/shared/ui/badge';
import { Button } from '@/shared/ui/button';
import { Input } from '@/shared/ui/input';
import { Label } from '@/shared/ui/label';
import { Skeleton } from '@/shared/ui/skeleton';
import type { ProductDto } from '@/shared/types/api';

interface ProductPickerProps {
  warehouseId: string;
  /** Kartochkalardagi narx shu turda (D-25). */
  priceType: SalePriceType;
  onPick: (product: ProductDto) => void;
  onBarcode: (code: string) => Promise<void>;
  /** Savatdagi miqdorlar — kartochkada qolgan qoldiqni ko'rsatish uchun. */
  inCart: Record<string, string>;
}

// Ustunlar soni ekranga emas, ro'yxat kengligiga qarab (container query): savat yonida ham, to'liq
// kenglikda ham karta ~200px dan torayib ketmaydi.
const PRODUCT_GRID =
  'grid grid-cols-1 gap-3 @min-[400px]:grid-cols-2 @min-[620px]:grid-cols-3 @min-[880px]:grid-cols-4';

/** POS'ning chap qismi: shtrix-kod skaneri, qidiruv va mahsulot kartochkalari. */
export function ProductPicker({
  warehouseId,
  priceType,
  onPick,
  onBarcode,
  inCart,
}: ProductPickerProps) {
  const [search, setSearch] = useState('');
  const [groupId, setGroupId] = useState('');
  const [barcode, setBarcode] = useState('');
  const [scanning, setScanning] = useState(false);
  const [cameraOpen, setCameraOpen] = useState(false);
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
    <div className="@container space-y-4">
      <div className="grid gap-1.5">
        <Label htmlFor="pos-barcode">{t.sales.barcodeLabel}</Label>
        <div className="flex gap-2">
          <div className="relative min-w-0 flex-1">
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
          <Button
            type="button"
            variant="outline"
            size="icon"
            className="size-11 shrink-0"
            onClick={() => setCameraOpen(true)}
            aria-label={t.scanner.open}
            title={t.scanner.open}
          >
            <ScanBarcode className="size-5" />
          </Button>
        </div>
      </div>
      <BarcodeScannerDialog
        open={cameraOpen}
        onOpenChange={setCameraOpen}
        onDetected={(code) => void onBarcode(code)}
      />
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
        <div className={PRODUCT_GRID}>
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
        <div className={cn(PRODUCT_GRID, isFetching && 'opacity-60')}>
          {data?.data.map((p) => {
            const left = inCart[p.id] ? subQty(p.stock, inCart[p.id] ?? '0') : p.stock;
            const out = compareQty(left, '0') <= 0;
            const taken = inCart[p.id];
            const price = priceType === 'WHOLESALE' ? p.wholesalePrice : p.salePrice;
            const blocked = out || price === null;
            return (
              <button
                key={p.id}
                type="button"
                disabled={blocked}
                onClick={() => onPick(p)}
                className={cn(
                  'group relative flex flex-col justify-between gap-2 rounded-lg border bg-card p-3 text-left transition-all',
                  taken && 'border-primary/60 bg-primary/[0.04] ring-1 ring-primary/20',
                  blocked
                    ? 'cursor-not-allowed opacity-60'
                    : 'hover:border-primary/50 hover:shadow-sm focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:outline-none active:scale-[0.98]',
                )}
              >
                {taken ? (
                  <span className="absolute -top-2 -right-2 rounded-full bg-primary px-2 py-0.5 text-[11px] font-semibold text-primary-foreground tabular-nums shadow-sm">
                    <span className="sr-only">{t.sales.cart.inCart(formatQuantity(taken))}</span>
                    <span aria-hidden>×{formatQuantity(taken)}</span>
                  </span>
                ) : null}
                <div className="space-y-1">
                  <p className="line-clamp-2 text-sm font-medium">{p.name}</p>
                  <div className="flex items-center justify-between gap-2">
                    <p className="truncate text-xs text-muted-foreground">{p.groupName}</p>
                    {out ? (
                      <Badge variant="destructive" className="shrink-0">
                        {t.sales.outOfStock}
                      </Badge>
                    ) : (
                      <Badge
                        variant={p.isLowStock ? 'warning' : 'secondary'}
                        className="shrink-0 tabular-nums"
                      >
                        {formatQuantity(left)} {t.units[p.unit]}
                      </Badge>
                    )}
                  </div>
                </div>
                <div className="flex items-center justify-between gap-2">
                  {price === null ? (
                    <span className="text-xs text-muted-foreground">{t.sales.noPrice}</span>
                  ) : (
                    <span className="font-semibold tabular-nums">{formatMoney(price)}</span>
                  )}
                  {blocked ? null : (
                    // Sensorli ekranda hover yo'q — "qo'shish" belgisi doim ko'rinadi.
                    <span
                      className="flex size-7 shrink-0 items-center justify-center rounded-md bg-primary/10 text-primary transition-colors group-hover:bg-primary group-hover:text-primary-foreground"
                      aria-hidden
                    >
                      <Plus className="size-4" />
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
