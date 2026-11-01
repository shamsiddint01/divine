import { customerNameSchema, optionalPhoneSchema } from '@divine/shared';
import { useQueryClient } from '@tanstack/react-query';
import { ChevronUp, Loader2, RotateCcw, ShoppingCart, Warehouse } from 'lucide-react';
import { useMemo, useRef, useState } from 'react';
import { toast } from 'sonner';
import { lookupByBarcode } from '@/features/products/api/products';
import { useCurrentUser } from '@/features/session/api/session';
import { useWarehouses } from '@/features/warehouses/api/warehouses';
import { t } from '@/i18n/uz';
import { ApiError } from '@/shared/lib/api-client';
import { BELOW_XL_QUERY, useMediaQuery } from '@/shared/hooks/use-media-query';
import { formatMoney, formatQuantity } from '@/shared/lib/format';
import { toastError } from '@/shared/lib/mutation';
// Mijoz maydonlari shared sxemalar bilan shu yerda tekshiriladi — o'zbekcha xabarlar uchun.
import '@/shared/forms/zod';
import { ConfirmDialog } from '@/shared/components/ConfirmDialog';
import { EmptyState } from '@/shared/components/EmptyState';
import { ErrorState } from '@/shared/components/ErrorState';
import { Badge } from '@/shared/ui/badge';
import { Button } from '@/shared/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/shared/ui/card';
import { Label } from '@/shared/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/shared/ui/select';
import { Separator } from '@/shared/ui/separator';
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from '@/shared/ui/sheet';
import type { ProductDto, SaleDto } from '@/shared/types/api';
import { useCreateSale } from '../api/sales';
import {
  type CartLine,
  addToCart,
  cartTotals,
  removeLine,
  setLineQuantity,
} from '../lib/cart';
import { CartPanel } from './CartPanel';
import { type CustomerDraft, CustomerFields } from './CustomerFields';
import { ProductPicker } from './ProductPicker';
import { SaleReceiptDialog } from './SaleReceiptDialog';

const emptyCustomer: CustomerDraft = { id: null, name: '', phone: '' };

const newKey = () => crypto.randomUUID();

const toCartProduct = (p: ProductDto) => ({
  productId: p.id,
  name: p.name,
  unit: p.unit,
  allowDecimal: p.allowDecimal,
  unitPrice: p.salePrice,
  stock: p.stock,
});

export function PosView() {
  const qc = useQueryClient();
  const { data: me } = useCurrentUser();
  const {
    data: warehouses,
    isPending: warehousesPending,
    error: warehousesError,
    refetch: refetchWarehouses,
  } = useWarehouses();
  const createSale = useCreateSale();

  const allowed = useMemo(
    () =>
      (warehouses ?? []).filter(
        (w) => w.status === 'ACTIVE' && (me?.role === 'ADMIN' || me?.warehouseIds.includes(w.id)),
      ),
    [warehouses, me],
  );
  const [chosenWarehouse, setChosenWarehouse] = useState('');
  // Standart — ruxsat etilgan birinchi faol ombor (D-21: "standart ombor" sozlamasi yo'q).
  const warehouseId = chosenWarehouse || (allowed[0]?.id ?? '');

  const [lines, setLinesState] = useState<CartLine[]>([]);
  // Savatning eng so'nggi holati: navbatdagi skanlar (ProductPicker) bitta render ichida ketma-ket
  // qo'shilishi mumkin — har biri oldingisining natijasidan hisoblanadi, birini ikkinchisi o'chirmaydi.
  const linesRef = useRef<CartLine[]>([]);
  const setLines = (next: CartLine[] | ((prev: CartLine[]) => CartLine[])) => {
    const value = typeof next === 'function' ? next(linesRef.current) : next;
    linesRef.current = value;
    setLinesState(value);
  };
  const [customer, setCustomer] = useState<CustomerDraft>(emptyCustomer);
  const [errors, setErrors] = useState<{ name?: string; phone?: string }>({});
  // Idempotency kaliti: shu savat uchun bitta; tarmoq xatosidan keyingi qayta bosish takroriy sotuv yaratmaydi.
  const [idempotencyKey, setIdempotencyKey] = useState(newKey);
  const [receipt, setReceipt] = useState<SaleDto | null>(null);
  const [confirmClear, setConfirmClear] = useState(false);
  const [pendingWarehouse, setPendingWarehouse] = useState<string | null>(null);
  // xl dan kichik ekranda savat yon ustunda emas — pastki panel orqali ochiladigan oynada.
  const compact = useMediaQuery(BELOW_XL_QUERY);
  const [cartOpen, setCartOpen] = useState(false);

  const inCart = Object.fromEntries(lines.map((l) => [l.productId, l.quantity]));

  const add = (p: ProductDto) => {
    const result = addToCart(linesRef.current, toCartProduct(p));
    setLines(result.lines);
    if (result.limited)
      toast.warning(t.sales.stockLimit(`${formatQuantity(p.stock)} ${t.units[p.unit]}`));
  };

  const handleBarcode = async (code: string) => {
    try {
      const p = await lookupByBarcode(code, warehouseId);
      add(p);
      toast.success(t.sales.added(p.name), { duration: 1500 });
    } catch (error) {
      if (error instanceof ApiError && error.status === 404)
        toast.error(t.sales.barcodeNotFound(code));
      else toastError(error);
    }
  };

  const reset = () => {
    setLines([]);
    setCustomer(emptyCustomer);
    setErrors({});
    setIdempotencyKey(newKey());
  };

  const changeWarehouse = (id: string) => {
    if (lines.length > 0) setPendingWarehouse(id);
    else setChosenWarehouse(id);
  };

  const submit = async () => {
    const name = customerNameSchema.safeParse(customer.name);
    const phone = optionalPhoneSchema.safeParse(customer.phone);
    const nextErrors = {
      name: name.success ? undefined : name.error.issues[0]?.message,
      phone: phone.success ? undefined : phone.error.issues[0]?.message,
    };
    setErrors(nextErrors);
    if (nextErrors.name || nextErrors.phone) {
      document.getElementById('pos-customer')?.focus();
      return;
    }
    if (lines.length === 0) return;
    try {
      const sale = await createSale.mutateAsync({
        idempotencyKey,
        input: {
          warehouseId,
          customer: customer.id
            ? { id: customer.id }
            : { name: name.data ?? '', phone: phone.data ?? null },
          items: lines.map((l) => ({ productId: l.productId, quantity: l.quantity })),
        },
      });
      setCartOpen(false);
      setReceipt(sale);
      toast.success(t.sales.success(sale.number));
      reset();
    } catch (error) {
      if (error instanceof ApiError && error.code === 'INSUFFICIENT_STOCK') {
        toast.error(error.message, { description: error.details.map((d) => d.message).join('\n') });
        await qc.invalidateQueries({ queryKey: ['products'] });
      } else {
        toastError(error);
      }
    }
  };

  const totals = cartTotals(lines);
  const checkout = (
    <>
      <CartPanel
        lines={lines}
        onQuantity={(id, q) => setLines((prev) => setLineQuantity(prev, id, q))}
        onRemove={(id) => setLines((prev) => removeLine(prev, id))}
      />
      <Separator />
      <div className="space-y-1">
        <p className="text-sm font-semibold">{t.sales.customer.title}</p>
        <CustomerFields
          value={customer}
          onChange={(v) => {
            setCustomer(v);
            if (errors.name || errors.phone) setErrors({});
          }}
          errors={errors}
        />
      </div>
      <div className="grid grid-cols-[auto_1fr] gap-2 pt-1">
        {/* Ikonka: asosiy tugma summa bilan birga sig'ishi uchun (nomi aria-label va title'da). */}
        <Button
          variant="outline"
          size="icon"
          className="size-10"
          onClick={() => setConfirmClear(true)}
          disabled={createSale.isPending || (lines.length === 0 && !customer.name)}
          aria-label={t.sales.clear}
          title={t.sales.clear}
        >
          <RotateCcw />
        </Button>
        <Button
          size="lg"
          className="min-w-0 px-4"
          onClick={submit}
          disabled={lines.length === 0 || createSale.isPending || !warehouseId}
        >
          {createSale.isPending ? <Loader2 className="animate-spin" /> : null}
          {createSale.isPending ? t.sales.processing : t.sales.confirm}
          {/* Jami summa savat ostida yozilgan; tugmada — ko'z bilan tekshirish uchun takror (o'qilmaydi). */}
          {lines.length > 0 && !createSale.isPending ? (
            <span aria-hidden className="tabular-nums opacity-80">
              · {formatMoney(totals.totalAmount)}
            </span>
          ) : null}
        </Button>
      </div>
    </>
  );

  return (
    <div className="grid items-start gap-6 xl:grid-cols-[minmax(0,1fr)_400px]">
      <Card className="gap-4">
        <CardHeader className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <CardTitle>{t.nav.products}</CardTitle>
          <div className="flex items-center gap-2 sm:w-72">
            <Label htmlFor="pos-warehouse" className="shrink-0 text-sm text-muted-foreground">
              <Warehouse className="size-4" aria-hidden />
              {t.sales.warehouse}
            </Label>
            <Select value={warehouseId} onValueChange={changeWarehouse}>
              <SelectTrigger id="pos-warehouse" className="flex-1">
                <SelectValue placeholder={t.common.selectPlaceholder} />
              </SelectTrigger>
              <SelectContent>
                {allowed.map((w) => (
                  <SelectItem key={w.id} value={w.id}>
                    {w.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </CardHeader>
        <CardContent>
          {warehousesError && !warehouses ? (
            // Omborlar yuklanmasa "ombor biriktirilmagan" deb ko'rsatilmaydi.
            <ErrorState message={warehousesError.message} onRetry={() => refetchWarehouses()} />
          ) : warehouseId ? (
            <ProductPicker
              warehouseId={warehouseId}
              onPick={add}
              onBarcode={handleBarcode}
              inCart={inCart}
            />
          ) : warehousesPending ? null : (
            <EmptyState
              icon={Warehouse}
              title={t.sales.noWarehouse}
              description={t.sales.noWarehouseHint}
            />
          )}
        </CardContent>
      </Card>

      {compact ? (
        <>
          {lines.length > 0 ? (
            // Sahifa oxirigacha ekran pastida turadi (sticky): kassir ro'yxatni aylantirib savatni izlamaydi.
            <button
              type="button"
              onClick={() => setCartOpen(true)}
              aria-haspopup="dialog"
              aria-label={`${t.sales.cart.open}: ${t.sales.cart.itemsCount(lines.length)}, ${formatMoney(totals.totalAmount)}`}
              className="sticky bottom-[calc(var(--mobile-nav-h)+0.75rem)] z-30 flex h-14 items-center gap-3 rounded-xl bg-primary px-4 text-primary-foreground shadow-lg shadow-primary/25 transition-transform outline-none focus-visible:ring-[3px] focus-visible:ring-ring active:scale-[0.99]"
            >
              <span className="relative">
                <ShoppingCart className="size-5" aria-hidden />
                <span className="absolute -top-2 -right-2.5 flex size-5 items-center justify-center rounded-full bg-primary-foreground text-[11px] font-bold text-primary tabular-nums">
                  {lines.length}
                </span>
              </span>
              <span className="ml-1 text-sm font-medium">{t.sales.cart.title}</span>
              <span className="ml-auto text-base font-semibold tabular-nums">
                {formatMoney(totals.totalAmount)}
              </span>
              <ChevronUp className="size-4 opacity-80" aria-hidden />
            </button>
          ) : null}
          <Sheet open={cartOpen && lines.length > 0} onOpenChange={setCartOpen}>
            <SheetContent
              side="bottom"
              className="max-h-[92dvh] gap-0 rounded-t-2xl pb-[env(safe-area-inset-bottom)]"
            >
              <SheetHeader className="flex-row items-center gap-2 px-5 py-4">
                <SheetTitle className="flex items-center gap-2">
                  <ShoppingCart className="size-4" aria-hidden />
                  {t.sales.cart.title}
                </SheetTitle>
                <Badge variant="secondary">{t.sales.cart.itemsCount(lines.length)}</Badge>
                <SheetDescription className="sr-only">{t.sales.cart.emptyHint}</SheetDescription>
              </SheetHeader>
              <div className="space-y-4 overflow-y-auto p-5">{checkout}</div>
            </SheetContent>
          </Sheet>
        </>
      ) : (
        <Card className="sticky top-20 gap-4">
          <CardHeader className="flex flex-row items-center justify-between">
            <CardTitle className="flex items-center gap-2">
              <ShoppingCart className="size-4" />
              {t.sales.cart.title}
            </CardTitle>
            {lines.length > 0 ? (
              <Badge variant="secondary">{t.sales.cart.itemsCount(lines.length)}</Badge>
            ) : null}
          </CardHeader>
          <CardContent className="space-y-4">{checkout}</CardContent>
        </Card>
      )}

      <SaleReceiptDialog sale={receipt} onClose={() => setReceipt(null)} />
      <ConfirmDialog
        open={confirmClear || pendingWarehouse !== null}
        onOpenChange={(open) => {
          if (!open) {
            setConfirmClear(false);
            setPendingWarehouse(null);
          }
        }}
        title={t.sales.clearTitle}
        description={t.sales.clearDescription}
        confirmLabel={t.sales.clear}
        destructive
        onConfirm={() => {
          reset();
          if (pendingWarehouse) setChosenWarehouse(pendingWarehouse);
        }}
      />
    </div>
  );
}
