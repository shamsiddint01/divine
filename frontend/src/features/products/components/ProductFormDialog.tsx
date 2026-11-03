import {
  PRODUCT_UNITS,
  Permission,
  type ProductUnit,
  VALIDATION_MESSAGES_UZ,
  entityNameSchema,
  isWholeQuantity,
  optionalBarcodeSchema,
  quantitySchema,
} from '@divine/shared';
import { AlertTriangle, Loader2 } from 'lucide-react';
import { useEffect } from 'react';
import { Controller, useForm, useWatch } from 'react-hook-form';
import { toast } from 'sonner';
import { z, zodResolver } from '@/shared/forms/zod';
import { t } from '@/i18n/uz';
import { FormField } from '@/shared/components/FormField';
import { OptionsLoadError } from '@/shared/components/OptionsLoadError';
import { groupDigits, moneyField, optionalQuantityField, toDecimal } from '@/shared/forms/fields';
import { compareMoney, normalizeNumberInput } from '@/shared/lib/decimal';
import { formatQuantity } from '@/shared/lib/format';
import { applyFieldErrors, toastError } from '@/shared/lib/mutation';
import { Button } from '@/shared/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/shared/ui/dialog';
import { Input } from '@/shared/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/shared/ui/select';
import { Switch } from '@/shared/ui/switch';
import type { ProductDto } from '@/shared/types/api';
import { useGroupOptions } from '@/features/product-groups/api/groups';
import { useHasAnyPermission } from '@/features/session/hooks/use-permissions';
import { useSaveProduct } from '../api/products';
import {
  FORM_DIALOG_BODY_CLASS,
  FORM_DIALOG_CLASS,
  FORM_DIALOG_FOOTER_CLASS,
  FORM_DIALOG_HEADER_CLASS,
  FormSection,
  StockFields,
  emptyStock,
  stockShape,
  useActiveWarehouses,
} from './StockFields';

const schema = z
  .object({
    name: entityNameSchema,
    groupId: z.string().min(1, { error: t.validation.groupRequired }),
    barcode: z.string().refine((v) => optionalBarcodeSchema.safeParse(v).success, {
      error: t.validation.barcodeFormat,
    }),
    unit: z.enum(PRODUCT_UNITS),
    allowDecimal: z.boolean(),
    costPrice: moneyField(),
    salePrice: moneyField(),
    minStock: optionalQuantityField(),
    active: z.boolean(),
    /** Boshlang'ich qoldiq (faqat yangi mahsulotda): miqdor bo'sh bo'lsa — hech narsa yozilmaydi. */
    stock: z.object(stockShape),
  })
  .refine((v) => v.unit !== 'DONA' || !v.allowDecimal, {
    error: t.validation.donaNoDecimal,
    path: ['allowDecimal'],
  })
  .superRefine((v, ctx) => {
    const qty = v.stock.quantity.trim();
    if (!qty) return;
    if (!quantitySchema.safeParse(normalizeNumberInput(qty) ?? '').success) {
      ctx.addIssue({ code: 'custom', path: ['stock', 'quantity'], message: M.quantityFormat });
    } else if (!v.allowDecimal && !isWholeQuantity(normalizeNumberInput(qty) ?? '')) {
      ctx.addIssue({ code: 'custom', path: ['stock', 'quantity'], message: M.wholeQuantity });
    }
    if (!v.active) {
      ctx.addIssue({
        code: 'custom',
        path: ['stock', 'quantity'],
        message: M.initialStockInactive,
      });
    }
    if (!v.stock.warehouseId) {
      ctx.addIssue({
        code: 'custom',
        path: ['stock', 'warehouseId'],
        message: t.products.form.stockWarehouseRequired,
      });
    }
  });

const M = VALIDATION_MESSAGES_UZ;

/** Minimal qoldiq kiritilmasa — 1 (egasining qarori): qoldiq 1 ga tushsa "Kam qolgan". */
const DEFAULT_MIN_STOCK = '1';

type FormValues = z.infer<typeof schema>;

const empty: FormValues = {
  name: '',
  groupId: '',
  barcode: '',
  unit: 'DONA',
  allowDecimal: false,
  costPrice: '',
  salePrice: '',
  minStock: DEFAULT_MIN_STOCK,
  active: true,
  stock: emptyStock(),
};

function toForm(p: ProductDto): FormValues {
  return {
    name: p.name,
    groupId: p.groupId,
    barcode: p.barcode ?? '',
    unit: p.unit,
    allowDecimal: p.allowDecimal,
    costPrice: groupDigits(p.costPrice?.replace(/\.00$/, '') ?? ''),
    salePrice: groupDigits(p.salePrice.replace(/\.00$/, '')),
    minStock: p.minStock ? formatQuantity(p.minStock) : DEFAULT_MIN_STOCK,
    active: p.status === 'ACTIVE',
    stock: emptyStock(),
  };
}

interface ProductFormDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  product?: ProductDto | null;
}

export function ProductFormDialog({ open, onOpenChange, product }: ProductFormDialogProps) {
  const { data: groups, error: groupsError, refetch: refetchGroups } = useGroupOptions();
  const save = useSaveProduct();
  // Boshlang'ich qoldiq — kirim bilan bir xil ruxsat; tahrirlashda yo'q (qoldiq "Qoldiq qo'shish"dan).
  const canManageIncoming = useHasAnyPermission([Permission.INCOMING_MANAGE]);
  const canConfirmIncoming = useHasAnyPermission([Permission.INCOMING_CONFIRM]);
  const withStock = !product && canManageIncoming && canConfirmIncoming;
  const { single: singleWarehouse } = useActiveWarehouses();
  const form = useForm<FormValues>({ resolver: zodResolver(schema), defaultValues: empty });
  const { register, handleSubmit, control, reset, setValue, setError, formState } = form;

  useEffect(() => {
    if (open) {
      reset(
        product
          ? toForm(product)
          : { ...empty, stock: { ...emptyStock(), warehouseId: singleWarehouse } },
      );
    }
  }, [open, product, reset, singleWarehouse]);

  const [cost, sale, unit] = useWatch({ control, name: ['costPrice', 'salePrice', 'unit'] });
  const costN = normalizeNumberInput(cost);
  const saleN = normalizeNumberInput(sale);
  const priceWarning = costN && saleN && compareMoney(saleN, costN) < 0;

  const onSubmit = handleSubmit(async (v) => {
    const qty = withStock ? normalizeNumberInput(v.stock.quantity.trim()) : null;
    try {
      await save.mutateAsync({
        id: product?.id,
        input: {
          name: v.name,
          groupId: v.groupId,
          barcode: v.barcode.trim() || null,
          unit: v.unit,
          allowDecimal: v.allowDecimal,
          costPrice: toDecimal(v.costPrice),
          salePrice: toDecimal(v.salePrice),
          minStock: toDecimal(v.minStock.trim() || DEFAULT_MIN_STOCK),
          status: v.active ? 'ACTIVE' : 'INACTIVE',
          ...(qty
            ? {
                initialStock: {
                  warehouseId: v.stock.warehouseId,
                  quantity: qty,
                  date: v.stock.date,
                  notes: v.stock.notes.trim() || null,
                },
              }
            : {}),
        },
      });
      toast.success(
        product
          ? t.products.form.updated
          : qty
            ? t.products.form.createdWithStock(formatQuantity(qty))
            : t.products.form.created,
      );
      onOpenChange(false);
    } catch (error) {
      const mapped = applyFieldErrors(error, setError, (field) =>
        field.startsWith('initialStock') ? 'stock.quantity' : field,
      );
      if (!mapped) toastError(error);
    }
  });

  const e = formState.errors;
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className={`${FORM_DIALOG_CLASS} sm:max-w-2xl`}>
        <DialogHeader className={FORM_DIALOG_HEADER_CLASS}>
          <DialogTitle>
            {product ? t.products.form.editTitle : t.products.form.createTitle}
          </DialogTitle>
          <DialogDescription>
            {product ? t.products.form.editDescription : t.products.form.createDescription}
          </DialogDescription>
        </DialogHeader>
        <form
          id="product-form"
          onSubmit={onSubmit}
          className={`${FORM_DIALOG_BODY_CLASS} space-y-6`}
          noValidate
        >
          <FormSection title={t.products.form.sectionMain}>
            <FormField
              id="p-name"
              label={t.products.form.name}
              required
              error={e.name?.message}
              className="sm:col-span-2"
            >
              <Input
                id="p-name"
                placeholder={t.products.form.namePlaceholder}
                aria-invalid={!!e.name}
                {...register('name')}
                autoFocus
              />
            </FormField>
            <FormField
              id="p-group"
              label={t.products.form.group}
              required
              error={e.groupId?.message}
              hint={
                groupsError && !groups ? <OptionsLoadError onRetry={() => refetchGroups()} /> : null
              }
            >
              <Controller
                control={control}
                name="groupId"
                render={({ field }) => (
                  <Select value={field.value} onValueChange={field.onChange}>
                    <SelectTrigger id="p-group" aria-invalid={!!e.groupId}>
                      <SelectValue placeholder={t.common.selectPlaceholder} />
                    </SelectTrigger>
                    <SelectContent>
                      {/* Arxivdagi guruhga yangi mahsulot qo'shilmaydi (422); mavjud guruhi saqlanadi. */}
                      {(groups ?? [])
                        .filter((g) => g.isActive || g.id === product?.groupId)
                        .map((g) => (
                          <SelectItem key={g.id} value={g.id}>
                            {g.name}
                          </SelectItem>
                        ))}
                    </SelectContent>
                  </Select>
                )}
              />
            </FormField>
            <FormField
              id="p-barcode"
              label={t.products.form.barcode}
              optional
              error={e.barcode?.message}
              hint={t.products.form.barcodeHint}
            >
              <Input
                id="p-barcode"
                placeholder={t.products.form.barcodePlaceholder}
                aria-invalid={!!e.barcode}
                className="font-mono"
                {...register('barcode')}
              />
            </FormField>
            <FormField id="p-unit" label={t.products.form.unit} required>
              <Controller
                control={control}
                name="unit"
                render={({ field }) => (
                  <Select
                    value={field.value}
                    onValueChange={(v) => {
                      field.onChange(v as ProductUnit);
                      setValue('allowDecimal', v !== 'DONA');
                    }}
                  >
                    <SelectTrigger id="p-unit">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {PRODUCT_UNITS.map((u) => (
                        <SelectItem key={u} value={u}>
                          {t.unitNames[u]}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                )}
              />
            </FormField>
            <FormField
              id="p-min"
              label={t.products.form.minStock}
              error={e.minStock?.message}
              hint={t.products.form.minStockHint}
            >
              <Input
                id="p-min"
                inputMode="decimal"
                placeholder={DEFAULT_MIN_STOCK}
                aria-invalid={!!e.minStock}
                {...register('minStock')}
              />
            </FormField>
            <Controller
              control={control}
              name="allowDecimal"
              render={({ field }) => (
                <label className="flex items-start justify-between gap-3 rounded-lg border p-3 sm:col-span-1">
                  <span className="space-y-0.5">
                    <span className="block text-sm font-medium">
                      {t.products.form.allowDecimal}
                    </span>
                    <span className="block text-xs text-muted-foreground">
                      {e.allowDecimal?.message ?? t.products.form.allowDecimalHint}
                    </span>
                  </span>
                  <Switch
                    checked={field.value}
                    onCheckedChange={field.onChange}
                    disabled={unit === 'DONA'}
                    aria-label={t.products.form.allowDecimal}
                  />
                </label>
              )}
            />
            <Controller
              control={control}
              name="active"
              render={({ field }) => (
                <label className="flex items-start justify-between gap-3 rounded-lg border p-3">
                  <span className="space-y-0.5">
                    <span className="block text-sm font-medium">{t.products.form.status}</span>
                    <span className="block text-xs text-muted-foreground">
                      {t.products.form.activeLabel}
                    </span>
                  </span>
                  <Switch
                    checked={field.value}
                    onCheckedChange={field.onChange}
                    aria-label={t.products.form.status}
                  />
                </label>
              )}
            />
          </FormSection>
          <FormSection title={t.products.form.sectionPrice}>
            <FormField
              id="p-cost"
              label={t.products.form.costPrice}
              required
              error={e.costPrice?.message}
            >
              <Input
                id="p-cost"
                inputMode="decimal"
                aria-invalid={!!e.costPrice}
                {...register('costPrice', {
                  onBlur: (ev) => setValue('costPrice', groupDigits(ev.target.value)),
                })}
              />
            </FormField>
            <FormField
              id="p-sale"
              label={t.products.form.salePrice}
              required
              error={e.salePrice?.message}
              hint={
                priceWarning ? (
                  <span className="inline-flex items-center gap-1 text-warning">
                    <AlertTriangle className="size-3.5" />
                    {t.products.form.priceWarning}
                  </span>
                ) : undefined
              }
            >
              <Input
                id="p-sale"
                inputMode="decimal"
                aria-invalid={!!e.salePrice}
                {...register('salePrice', {
                  onBlur: (ev) => setValue('salePrice', groupDigits(ev.target.value)),
                })}
              />
            </FormField>
          </FormSection>
          {withStock ? (
            <FormSection
              title={t.products.form.sectionStock}
              hint={t.products.form.sectionStockHint}
            >
              <StockFields control={control} register={register} errors={e} idPrefix="p-stock" />
            </FormSection>
          ) : null}
        </form>
        <DialogFooter className={FORM_DIALOG_FOOTER_CLASS}>
          <Button
            variant="outline"
            onClick={() => onOpenChange(false)}
            disabled={formState.isSubmitting}
          >
            {t.common.cancel}
          </Button>
          <Button type="submit" form="product-form" disabled={formState.isSubmitting}>
            {formState.isSubmitting ? <Loader2 className="animate-spin" /> : null}
            {product ? t.common.saveChanges : t.common.create}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
