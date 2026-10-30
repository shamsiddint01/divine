import { customerNameSchema, optionalPhoneSchema } from '@divine/shared';
import { useQueryClient } from '@tanstack/react-query';
import { Loader2, RotateCcw, ShoppingCart, Warehouse } from 'lucide-react';
import { useMemo, useRef, useState } from 'react';
import { toast } from 'sonner';
import { lookupByBarcode } from '@/features/products/api/products';
import { useCurrentUser } from '@/features/session/api/session';
import { useWarehouses } from '@/features/warehouses/api/warehouses';
import { t } from '@/i18n/uz';
import { ApiError } from '@/shared/lib/api-client';
import { formatQuantity } from '@/shared/lib/format';
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
import type { ProductDto, SaleDto } from '@/shared/types/api';
import { useCreateSale } from '../api/sales';
import { type CartLine, addToCart, removeLine, setLineQuantity } from '../lib/cart';
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

      <Card className="gap-4 xl:sticky xl:top-20">
        <CardHeader className="flex flex-row items-center justify-between">
          <CardTitle className="flex items-center gap-2">
            <ShoppingCart className="size-4" />
            {t.sales.cart.title}
          </CardTitle>
          {lines.length > 0 ? (
            <Badge variant="secondary">{t.sales.cart.itemsCount(lines.length)}</Badge>
          ) : null}
        </CardHeader>
        <CardContent className="space-y-4">
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
            <Button
              variant="outline"
              size="lg"
              onClick={() => setConfirmClear(true)}
              disabled={createSale.isPending || (lines.length === 0 && !customer.name)}
            >
              <RotateCcw />
              {t.sales.clear}
            </Button>
            <Button
              size="lg"
              onClick={submit}
              disabled={lines.length === 0 || createSale.isPending || !warehouseId}
            >
              {createSale.isPending ? <Loader2 className="animate-spin" /> : null}
              {createSale.isPending ? t.sales.processing : t.sales.confirm}
            </Button>
          </div>
        </CardContent>
      </Card>

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
