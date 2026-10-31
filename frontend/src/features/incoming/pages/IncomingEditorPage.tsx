import { Permission, isWholeQuantity } from '@divine/shared';
import { Barcode, CheckCircle2, Loader2, Plus, Save, Trash2, XCircle } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { Controller, useFieldArray, useForm, useWatch } from 'react-hook-form';
import { useNavigate, useParams } from 'react-router';
import { toast } from 'sonner';
import { z, zodResolver } from '@/shared/forms/zod';
import {
  lookupByBarcode,
  useProductsById,
  useRememberProduct,
} from '@/features/products/api/products';
import { ProductCombobox } from '@/features/products/components/ProductCombobox';
import { useHasAnyPermission } from '@/features/session/hooks/use-permissions';
import { useWarehouses } from '@/features/warehouses/api/warehouses';
import { t } from '@/i18n/uz';
import { ConfirmDialog } from '@/shared/components/ConfirmDialog';
import { DatePicker } from '@/shared/components/DatePicker';
import { DetailErrorPage } from '@/shared/components/DetailErrorPage';
import { FormField } from '@/shared/components/FormField';
import { OptionsLoadError } from '@/shared/components/OptionsLoadError';
import { PageHeader } from '@/shared/components/PageHeader';
import { StatusBadge } from '@/shared/components/StatusBadge';
import { groupDigits, moneyField, quantityField, toDecimal } from '@/shared/forms/fields';
import { addQty, lineTotal, normalizeNumberInput } from '@/shared/lib/decimal';
import { formatMoney, formatQuantity, todayInTashkent } from '@/shared/lib/format';
import { ApiError } from '@/shared/lib/api-client';
import { applyFieldErrors, toastError } from '@/shared/lib/mutation';
import { Button } from '@/shared/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/shared/ui/card';
import { Input } from '@/shared/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/shared/ui/select';
import { Skeleton } from '@/shared/ui/skeleton';
import { Textarea } from '@/shared/ui/textarea';
import type { IncomingDto, IncomingInput, ProductDto } from '@/shared/types/api';
import { useIncoming, useIncomingAction, useSaveIncoming } from '../api/incoming';
import { IncomingReadOnly } from '../components/IncomingReadOnly';
import { computeIncomingTotals } from '../lib/totals';

const itemSchema = z.object({
  productId: z.string().min(1, { error: t.validation.productRequired }),
  quantity: quantityField(),
  costPrice: moneyField(),
});

const schema = z.object({
  date: z.string().min(1, { error: t.validation.dateRequired }),
  warehouseId: z.string().min(1, { error: t.validation.warehouseRequired }),
  notes: z.string().max(1000),
  items: z
    .array(itemSchema)
    .min(1, { error: t.incoming.form.noItems })
    .superRefine((items, ctx) => {
      const seen = new Set<string>();
      items.forEach((item, index) => {
        if (item.productId && seen.has(item.productId)) {
          ctx.addIssue({
            code: 'custom',
            message: t.incoming.form.duplicateProduct,
            path: [index, 'productId'],
          });
        }
        seen.add(item.productId);
      });
    }),
});
type FormValues = z.infer<typeof schema>;

const emptyRow = { productId: '', quantity: '', costPrice: '' };

/** Qatorlar setkasi (≥1280px): #, mahsulot, guruh/shtrix-kod, miqdor, tannarx, summa, o'chirish. */
const ROW_GRID = 'xl:grid-cols-[2rem_minmax(14rem,1fr)_10rem_8rem_9rem_9rem_2.5rem]';

function toForm(doc: IncomingDto): FormValues {
  return {
    date: doc.date,
    warehouseId: doc.warehouseId,
    notes: doc.notes ?? '',
    items: (doc.items ?? []).map((i) => ({
      productId: i.productId,
      quantity: formatQuantity(i.quantity),
      costPrice: groupDigits((i.costPrice ?? '').replace(/\.00$/, '')),
    })),
  };
}

export function IncomingEditorPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { data: doc, isPending: docLoading, error: docError, refetch } = useIncoming(id);
  const { data: warehouses, error: warehousesError, refetch: refetchWarehouses } = useWarehouses();
  const canManage = useHasAnyPermission([Permission.INCOMING_MANAGE]);
  const canConfirm = useHasAnyPermission([Permission.INCOMING_CONFIRM]);
  const save = useSaveIncoming();
  const action = useIncomingAction();
  const [confirming, setConfirming] = useState(false);
  const [cancelling, setCancelling] = useState(false);
  const [scan, setScan] = useState('');

  const form = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: { date: todayInTashkent(), warehouseId: '', notes: '', items: [emptyRow] },
  });
  const { control, register, handleSubmit, reset, setValue, setError, getValues, formState } = form;
  const { fields, append, remove } = useFieldArray({ control, name: 'items' });
  const items = useWatch({ control, name: 'items' });
  const warehouseId = useWatch({ control, name: 'warehouseId' });
  // Qatorlardagi mahsulotlar ID bo'yicha yuklanadi — katalog hajmi (100+) cheklov emas.
  const productMap = useProductsById((items ?? []).map((i) => i.productId));
  const rememberProduct = useRememberProduct();
  const [scanning, setScanning] = useState(false);

  useEffect(() => {
    if (doc) reset(toForm(doc));
  }, [doc, reset]);
  useEffect(() => {
    // Yangi kirimda standart — ruxsat etilgan birinchi faol ombor (D-21: sozlama yo'q).
    const fallback = warehouses?.find((w) => w.status === 'ACTIVE')?.id;
    if (!id && !getValues('warehouseId') && fallback) setValue('warehouseId', fallback);
  }, [id, warehouses, getValues, setValue]);

  // Dinamik jami: istalgan qator o'zgarganda darhol qayta hisoblanadi (BR-11).
  const totals = computeIncomingTotals(items ?? []);
  const allPieces = (items ?? []).every(
    (i) => !i.productId || productMap.get(i.productId)?.unit === 'DONA',
  );
  const selectedIds = (items ?? []).map((i) => i.productId).filter(Boolean);

  const selectProduct = (index: number, p: ProductDto) => {
    setValue(`items.${index}.productId`, p.id, { shouldValidate: true });
    if (!getValues(`items.${index}.costPrice`) && p.costPrice) {
      setValue(`items.${index}.costPrice`, groupDigits(p.costPrice.replace(/\.00$/, '')));
    }
  };

  // Shtrix-kodlar navbati: skaner kodlarni ketma-ket tez yuboradi — avvalgisi qidirilayotganda kelgan
  // kod tashlab yuborilmaydi va maydon darhol bo'shaydi. Qatorlar holati har kod uchun yangidan
  // o'qiladi (`getValues`), shunda kutish paytida foydalanuvchi kiritgan qiymat ustiga yozilmaydi.
  const scanQueue = useRef<string[]>([]);
  const draining = useRef(false);

  const applyScanned = (p: ProductDto) => {
    rememberProduct(p);
    const rows = getValues('items');
    const existing = rows.findIndex((i) => i.productId === p.id);
    if (existing >= 0) {
      const current = normalizeNumberInput(rows[existing]?.quantity ?? '') ?? '0';
      setValue(`items.${existing}.quantity`, formatQuantity(addQty(current, '1')));
      return;
    }
    const row = {
      productId: p.id,
      quantity: '1',
      costPrice: groupDigits(p.costPrice?.replace(/\.00$/, '') ?? ''),
    };
    // Faqat butunlay bo'sh qator to'ldiriladi; qisman kiritilgani — foydalanuvchiniki, tegilmaydi.
    const emptyIndex = rows.findIndex(
      (i) => !i.productId && !i.quantity.trim() && !i.costPrice.trim(),
    );
    if (emptyIndex >= 0) setValue(`items.${emptyIndex}`, row);
    else append(row);
  };

  const drainScans = async () => {
    if (draining.current) return;
    draining.current = true;
    setScanning(true);
    try {
      for (let code = scanQueue.current.shift(); code; code = scanQueue.current.shift()) {
        try {
          applyScanned(await lookupByBarcode(code));
        } catch (error) {
          if (error instanceof ApiError && error.status === 404)
            toast.error(t.sales.barcodeNotFound(code));
          else toastError(error);
        }
      }
    } finally {
      draining.current = false;
      setScanning(false);
    }
  };

  const addByBarcode = () => {
    const code = scan.trim();
    if (!code) return;
    setScan('');
    scanQueue.current.push(code);
    void drainScans();
  };

  const toInput = (v: FormValues): IncomingInput | null => {
    let ok = true;
    v.items.forEach((item, index) => {
      const p = productMap.get(item.productId);
      const qty = toDecimal(item.quantity);
      if (p && !p.allowDecimal && !isWholeQuantity(qty)) {
        setError(`items.${index}.quantity`, {
          message: t.validation.wholeQuantity,
        });
        ok = false;
      }
    });
    if (!ok) return null;
    return {
      date: v.date,
      warehouseId: v.warehouseId,
      notes: v.notes.trim() || null,
      items: v.items.map((i) => ({
        productId: i.productId,
        quantity: toDecimal(i.quantity),
        costPrice: toDecimal(i.costPrice),
      })),
    };
  };

  const saveDraft = async (v: FormValues): Promise<IncomingDto | null> => {
    const input = toInput(v);
    if (!input) return null;
    try {
      const saved = await save.mutateAsync({ id, input });
      return saved;
    } catch (error) {
      if (!applyFieldErrors(error, setError)) toastError(error);
      return null;
    }
  };

  const onSaveDraft = handleSubmit(async (v) => {
    const saved = await saveDraft(v);
    if (saved) {
      toast.success(t.incoming.form.saved);
      if (!id) navigate(`/incoming/${saved.id}`, { replace: true });
    }
  });

  const onConfirmClick = handleSubmit(() => setConfirming(true));

  const doConfirm = async () => {
    const saved = await saveDraft(getValues());
    if (!saved) throw new Error('save failed');
    try {
      await action.mutateAsync({ id: saved.id, action: 'confirm' });
      toast.success(t.incoming.form.confirmed);
      navigate(`/incoming/${saved.id}`, { replace: true });
    } catch (error) {
      toastError(error);
      throw error;
    }
  };

  if (id && docError)
    return (
      <DetailErrorPage
        error={docError}
        sectionLabel={t.nav.incoming}
        sectionTo="/incoming"
        onRetry={() => refetch()}
      />
    );
  if (id && (docLoading || !doc)) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-10 w-64" />
        <Skeleton className="h-40 w-full" />
        <Skeleton className="h-72 w-full" />
      </div>
    );
  }

  // Yakuniy holat yoki boshqarish ruxsati yo'q — faqat ko'rish (backend ham 403/409 qaytaradi).
  const readOnly = (doc && doc.status !== 'DRAFT') || !canManage;
  const title = doc ? t.incoming.form.editTitle(doc.number) : t.incoming.form.newTitle;
  const warehouseName = warehouses?.find((w) => w.id === warehouseId)?.name ?? '';
  const qtyLabel = allPieces
    ? t.incoming.form.totalQuantityValue(formatQuantity(totals.totalQuantity))
    : formatQuantity(totals.totalQuantity);

  return (
    <>
      <PageHeader
        breadcrumbs={[
          { label: t.nav.incoming, to: '/incoming' },
          { label: doc?.number ?? t.incoming.form.newTitle },
        ]}
        title={
          <span className="flex items-center gap-3">
            {title}
            {doc ? <StatusBadge status={doc.status} /> : null}
          </span>
        }
        description={readOnly ? t.incoming.form.readOnly : t.incoming.description}
        actions={
          readOnly ? null : (
            <>
              {doc ? (
                <Button
                  variant="ghost"
                  className="text-destructive hover:text-destructive"
                  onClick={() => setCancelling(true)}
                >
                  <XCircle />
                  {t.incoming.form.cancelDoc}
                </Button>
              ) : null}
              <Button
                variant="outline"
                onClick={onSaveDraft}
                disabled={formState.isSubmitting || save.isPending}
              >
                {save.isPending && !confirming ? <Loader2 className="animate-spin" /> : <Save />}
                {t.incoming.form.saveDraft}
              </Button>
              {canConfirm ? (
                <Button
                  onClick={onConfirmClick}
                  disabled={formState.isSubmitting || save.isPending}
                >
                  <CheckCircle2 />
                  {t.incoming.form.confirm}
                </Button>
              ) : null}
            </>
          )
        }
      />

      {readOnly && doc ? (
        <IncomingReadOnly doc={doc} />
      ) : (
        <form onSubmit={onSaveDraft} className="space-y-4" noValidate>
          <Card className="gap-4">
            <CardHeader>
              <CardTitle>{t.incoming.form.header}</CardTitle>
            </CardHeader>
            <CardContent className="grid gap-4 md:grid-cols-[200px_260px_minmax(0,1fr)]">
              <FormField
                id="in-date"
                label={t.incoming.form.date}
                required
                error={formState.errors.date?.message}
              >
                <Controller
                  control={control}
                  name="date"
                  render={({ field }) => (
                    <DatePicker
                      id="in-date"
                      value={field.value}
                      onChange={field.onChange}
                      invalid={!!formState.errors.date}
                    />
                  )}
                />
              </FormField>
              <FormField
                id="in-warehouse"
                label={t.incoming.form.warehouse}
                required
                error={formState.errors.warehouseId?.message}
                hint={
                  warehousesError && !warehouses ? (
                    <OptionsLoadError onRetry={() => refetchWarehouses()} />
                  ) : null
                }
              >
                <Controller
                  control={control}
                  name="warehouseId"
                  render={({ field }) => (
                    <Select value={field.value} onValueChange={field.onChange}>
                      <SelectTrigger
                        id="in-warehouse"
                        aria-invalid={!!formState.errors.warehouseId}
                      >
                        <SelectValue placeholder={t.common.selectPlaceholder} />
                      </SelectTrigger>
                      <SelectContent>
                        {(warehouses ?? [])
                          .filter((w) => w.status === 'ACTIVE')
                          .map((w) => (
                            <SelectItem key={w.id} value={w.id}>
                              {w.name}
                            </SelectItem>
                          ))}
                      </SelectContent>
                    </Select>
                  )}
                />
              </FormField>
              <FormField id="in-notes" label={t.incoming.form.notes} optional>
                <Textarea
                  id="in-notes"
                  rows={1}
                  className="min-h-9"
                  placeholder={t.incoming.form.notesPlaceholder}
                  {...register('notes')}
                />
              </FormField>
            </CardContent>
          </Card>

          <Card className="gap-4">
            <CardHeader className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <CardTitle>{t.incoming.form.items}</CardTitle>
              <div className="relative w-full sm:w-96">
                {scanning ? (
                  <Loader2 className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 animate-spin text-muted-foreground" />
                ) : (
                  <Barcode className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" />
                )}
                <Input
                  value={scan}
                  onChange={(e) => setScan(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      e.preventDefault();
                      addByBarcode();
                    }
                  }}
                  placeholder={t.incoming.form.scanPlaceholder}
                  className="pl-9 font-mono text-sm"
                  aria-label={t.incoming.form.barcode}
                />
              </div>
            </CardHeader>
            <CardContent className="space-y-3">
              {/* ≥1280px — jadval ko'rinishi; torroq ekranda har bir qator label'li karta (gorizontal scroll yo'q) */}
              <div className="rounded-lg border">
                <div
                  className={`hidden ${ROW_GRID} gap-2 border-b bg-muted/50 px-3 py-2 text-xs font-medium text-muted-foreground xl:grid`}
                >
                  <span>#</span>
                  <span>{t.incoming.form.product}</span>
                  <span>
                    {t.incoming.form.group} · {t.incoming.form.barcode}
                  </span>
                  <span className="text-right">{t.incoming.form.quantity}</span>
                  <span className="text-right">{t.incoming.form.costPrice}</span>
                  <span className="text-right">{t.incoming.form.lineTotal}</span>
                  <span className="sr-only">{t.common.actions}</span>
                </div>
                <ul className="divide-y">
                  {fields.map((field, index) => {
                    const row = items?.[index];
                    const p = row?.productId ? productMap.get(row.productId) : undefined;
                    const err = formState.errors.items?.[index];
                    const qty = normalizeNumberInput(row?.quantity ?? '') ?? '0';
                    const cost = normalizeNumberInput(row?.costPrice ?? '') ?? '0';
                    const removeButton = (
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        className="size-8 text-muted-foreground hover:text-destructive"
                        onClick={() => remove(index)}
                        disabled={fields.length === 1}
                        aria-label={`${t.incoming.form.removeRow} ${index + 1}`}
                      >
                        <Trash2 />
                      </Button>
                    );
                    return (
                      <li
                        key={field.id}
                        className={`grid gap-3 p-3 sm:grid-cols-2 ${ROW_GRID} xl:items-start xl:gap-2 xl:py-2`}
                      >
                        {/* Mobil: qator sarlavhasi va o'chirish */}
                        <div className="flex items-center justify-between sm:col-span-2 xl:hidden">
                          <span className="text-xs font-medium text-muted-foreground">
                            #{index + 1}
                          </span>
                          {removeButton}
                        </div>
                        <span className="hidden pt-2 text-muted-foreground tabular-nums xl:block">
                          {index + 1}
                        </span>
                        <div className="sm:col-span-2 xl:col-span-1">
                          <p className="mb-1 text-xs text-muted-foreground xl:hidden">
                            {t.incoming.form.product}
                          </p>
                          <ProductCombobox
                            id={`in-product-${index}`}
                            value={row?.productId ?? ''}
                            onChange={(prod) => prod && selectProduct(index, prod)}
                            disabledIds={selectedIds}
                            invalid={!!err?.productId}
                          />
                          {err?.productId ? (
                            <p className="mt-1 text-xs text-destructive">{err.productId.message}</p>
                          ) : null}
                        </div>
                        <div className="min-w-0 text-sm sm:col-span-2 xl:col-span-1 xl:pt-1">
                          <p className="truncate text-muted-foreground">
                            <span className="xl:hidden">{t.incoming.form.group}: </span>
                            {p?.groupName ?? t.common.notSet}
                          </p>
                          <p className="truncate font-mono text-xs">
                            <span className="font-sans text-muted-foreground xl:hidden">
                              {t.incoming.form.barcode}:{' '}
                            </span>
                            {p?.barcode ?? t.common.notSet}
                          </p>
                        </div>
                        <div>
                          <p className="mb-1 text-xs text-muted-foreground xl:hidden">
                            {t.incoming.form.quantity}
                          </p>
                          <div className="relative">
                            <Input
                              inputMode="decimal"
                              className="pr-10 text-right tabular-nums"
                              aria-label={`${t.incoming.form.quantity} ${index + 1}`}
                              aria-invalid={!!err?.quantity}
                              {...register(`items.${index}.quantity`)}
                            />
                            {p ? (
                              <span className="pointer-events-none absolute top-1/2 right-2 -translate-y-1/2 text-xs text-muted-foreground">
                                {t.units[p.unit]}
                              </span>
                            ) : null}
                          </div>
                          {err?.quantity ? (
                            <p className="mt-1 text-xs text-destructive">{err.quantity.message}</p>
                          ) : null}
                        </div>
                        <div>
                          <p className="mb-1 text-xs text-muted-foreground xl:hidden">
                            {t.incoming.form.costPrice}
                          </p>
                          <Input
                            inputMode="decimal"
                            className="text-right tabular-nums"
                            aria-label={`${t.incoming.form.costPrice} ${index + 1}`}
                            aria-invalid={!!err?.costPrice}
                            {...register(`items.${index}.costPrice`, {
                              onBlur: (e) =>
                                setValue(`items.${index}.costPrice`, groupDigits(e.target.value)),
                            })}
                          />
                          {err?.costPrice ? (
                            <p className="mt-1 text-xs text-destructive">{err.costPrice.message}</p>
                          ) : null}
                        </div>
                        <div className="flex items-center justify-between sm:col-span-2 xl:col-span-1 xl:block xl:pt-2 xl:text-right">
                          <span className="text-xs text-muted-foreground xl:hidden">
                            {t.incoming.form.lineTotal}
                          </span>
                          <span className="font-medium tabular-nums">
                            {formatMoney(lineTotal(qty, cost))}
                          </span>
                        </div>
                        <div className="hidden justify-end xl:flex">{removeButton}</div>
                      </li>
                    );
                  })}
                </ul>
              </div>
              {formState.errors.items?.root?.message || formState.errors.items?.message ? (
                <p className="text-sm text-destructive">
                  {formState.errors.items?.root?.message ?? formState.errors.items?.message}
                </p>
              ) : null}
              <Button type="button" variant="outline" size="sm" onClick={() => append(emptyRow)}>
                <Plus />
                {t.incoming.form.addRow}
              </Button>
            </CardContent>
          </Card>

          {/* Jami — dinamik (TZ §7) */}
          <div className="sticky bottom-[calc(var(--mobile-nav-h,0px)+1rem)] z-10 flex flex-col gap-3 rounded-xl border bg-card/95 p-4 shadow-lg backdrop-blur sm:flex-row sm:items-center sm:justify-between">
            <div className="flex flex-wrap items-baseline gap-x-8 gap-y-1">
              <div>
                <p className="text-xs text-muted-foreground">{t.incoming.form.totalQuantity}</p>
                <p
                  className="text-2xl font-bold tabular-nums"
                  data-testid="incoming-total-quantity"
                >
                  {qtyLabel}
                </p>
              </div>
              <div>
                <p className="text-xs text-muted-foreground">{t.incoming.form.totalAmount}</p>
                <p className="text-xl font-semibold tabular-nums">
                  {formatMoney(totals.totalAmount)}
                </p>
              </div>
              <p className="text-sm text-muted-foreground">
                {t.incoming.form.positions(totals.positions)}
              </p>
            </div>
          </div>
        </form>
      )}

      <ConfirmDialog
        open={confirming}
        onOpenChange={setConfirming}
        title={t.incoming.form.confirmTitle}
        description={t.incoming.form.confirmDescription(
          formatQuantity(totals.totalQuantity),
          warehouseName,
        )}
        confirmLabel={t.common.confirm}
        onConfirm={doConfirm}
      />
      <ConfirmDialog
        open={cancelling}
        onOpenChange={setCancelling}
        title={t.incoming.form.cancelTitle}
        description={t.incoming.form.cancelDescription}
        confirmLabel={t.incoming.form.cancelDoc}
        destructive
        onConfirm={async () => {
          if (!id) return;
          try {
            await action.mutateAsync({ id, action: 'cancel' });
            toast.success(t.incoming.form.cancelled);
            navigate('/incoming');
          } catch (e) {
            toastError(e);
            throw e;
          }
        }}
      />
    </>
  );
}
