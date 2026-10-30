import {
  PRODUCT_UNITS,
  type ProductUnit,
  entityNameSchema,
  optionalBarcodeSchema,
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
import { useSaveProduct } from '../api/products';

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
  })
  .refine((v) => v.unit !== 'DONA' || !v.allowDecimal, {
    error: t.validation.donaNoDecimal,
    path: ['allowDecimal'],
  });

type FormValues = z.infer<typeof schema>;

const empty: FormValues = {
  name: '',
  groupId: '',
  barcode: '',
  unit: 'DONA',
  allowDecimal: false,
  costPrice: '',
  salePrice: '',
  minStock: '',
  active: true,
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
    minStock: p.minStock ? formatQuantity(p.minStock) : '',
    active: p.status === 'ACTIVE',
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
  const form = useForm<FormValues>({ resolver: zodResolver(schema), defaultValues: empty });
  const { register, handleSubmit, control, reset, setValue, setError, formState } = form;

  useEffect(() => {
    if (open) reset(product ? toForm(product) : empty);
  }, [open, product, reset]);

  const [cost, sale, unit] = useWatch({ control, name: ['costPrice', 'salePrice', 'unit'] });
  const costN = normalizeNumberInput(cost);
  const saleN = normalizeNumberInput(sale);
  const priceWarning = costN && saleN && compareMoney(saleN, costN) < 0;

  const onSubmit = handleSubmit(async (v) => {
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
          minStock: v.minStock.trim() ? toDecimal(v.minStock) : null,
          status: v.active ? 'ACTIVE' : 'INACTIVE',
        },
      });
      toast.success(product ? t.products.form.updated : t.products.form.created);
      onOpenChange(false);
    } catch (error) {
      if (!applyFieldErrors(error, setError)) toastError(error);
    }
  });

  const e = formState.errors;
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader>
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
          className="grid gap-4 sm:grid-cols-2"
          noValidate
        >
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
            optional
            error={e.minStock?.message}
            hint={t.products.form.minStockHint}
          >
            <Input
              id="p-min"
              inputMode="decimal"
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
                  <span className="block text-sm font-medium">{t.products.form.allowDecimal}</span>
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
        </form>
        <DialogFooter>
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
