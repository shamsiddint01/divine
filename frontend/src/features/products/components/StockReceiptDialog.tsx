import { VALIDATION_MESSAGES_UZ, isWholeQuantity, quantitySchema } from '@divine/shared';
import { Loader2, PackagePlus } from 'lucide-react';
import { useEffect } from 'react';
import { useForm } from 'react-hook-form';
import { toast } from 'sonner';
import { t } from '@/i18n/uz';
import { FormField } from '@/shared/components/FormField';
import { groupDigits, moneyField, toDecimal } from '@/shared/forms/fields';
import { z, zodResolver } from '@/shared/forms/zod';
import { normalizeNumberInput } from '@/shared/lib/decimal';
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
import type { ProductDto } from '@/shared/types/api';
import { useAddStock } from '../api/products';
import {
  FORM_DIALOG_BODY_CLASS,
  FORM_DIALOG_CLASS,
  FORM_DIALOG_FOOTER_CLASS,
  FORM_DIALOG_HEADER_CLASS,
  StockFields,
  emptyStock,
  stockShape,
  useActiveWarehouses,
} from './StockFields';

const M = VALIDATION_MESSAGES_UZ;

/** Butun/kasr siyosati mahsulotga bog'liq — sxema shu mahsulot uchun quriladi. */
const schemaFor = (allowDecimal: boolean) =>
  z
    .object({ stock: z.object(stockShape), costPrice: moneyField() })
    .superRefine((v, ctx) => {
      const qty = normalizeNumberInput(v.stock.quantity.trim()) ?? '';
      if (!quantitySchema.safeParse(qty).success) {
        ctx.addIssue({ code: 'custom', path: ['stock', 'quantity'], message: M.quantityFormat });
      } else if (!allowDecimal && !isWholeQuantity(qty)) {
        ctx.addIssue({ code: 'custom', path: ['stock', 'quantity'], message: M.wholeQuantity });
      }
      if (!v.stock.warehouseId) {
        ctx.addIssue({
          code: 'custom',
          path: ['stock', 'warehouseId'],
          message: t.products.form.stockWarehouseRequired,
        });
      }
    });

type FormValues = z.infer<ReturnType<typeof schemaFor>>;

interface StockReceiptDialogProps {
  product: ProductDto | null;
  onOpenChange: (open: boolean) => void;
}

/**
 * "Qoldiq qo'shish" — sobiq "Kirim" bo'limining o'rnini bosadi: ombor, miqdor, partiya kelgan narxi,
 * sana, izoh. Server tasdiqlangan kirim hujjatini yozadi (qoldiq, ledger, hisobotlar, audit).
 */
export function StockReceiptDialog({ product, onOpenChange }: StockReceiptDialogProps) {
  const addStock = useAddStock();
  const { single } = useActiveWarehouses();
  const form = useForm<FormValues>({
    resolver: zodResolver(schemaFor(product?.allowDecimal ?? false)),
    defaultValues: { stock: emptyStock(), costPrice: '' },
  });
  const { register, handleSubmit, control, reset, setValue, setError, formState } = form;

  useEffect(() => {
    if (product) {
      reset({
        stock: { ...emptyStock(), warehouseId: single },
        costPrice: groupDigits(product.costPrice?.replace(/\.00$/, '') ?? ''),
      });
    }
  }, [product, reset, single]);

  const onSubmit = handleSubmit(async (v) => {
    if (!product) return;
    const quantity = normalizeNumberInput(v.stock.quantity.trim()) ?? '';
    try {
      await addStock.mutateAsync({
        id: product.id,
        input: {
          warehouseId: v.stock.warehouseId,
          quantity,
          costPrice: toDecimal(v.costPrice),
          date: v.stock.date,
          notes: v.stock.notes.trim() || null,
        },
      });
      toast.success(t.products.stock.added(formatQuantity(quantity)));
      onOpenChange(false);
    } catch (error) {
      const mapped = applyFieldErrors(error, setError, (field) =>
        field === 'costPrice' ? field : `stock.${field === 'productId' ? 'quantity' : field}`,
      );
      if (!mapped) toastError(error);
    }
  });

  const e = formState.errors;
  return (
    <Dialog open={Boolean(product)} onOpenChange={onOpenChange}>
      <DialogContent className={`${FORM_DIALOG_CLASS} sm:max-w-lg`}>
        <DialogHeader className={FORM_DIALOG_HEADER_CLASS}>
          <DialogTitle>{t.products.stock.title}</DialogTitle>
          <DialogDescription>
            {product ? t.products.stock.description(product.name) : null}
          </DialogDescription>
        </DialogHeader>
        <form
          id="stock-receipt-form"
          onSubmit={onSubmit}
          className={`${FORM_DIALOG_BODY_CLASS} grid content-start gap-4 sm:grid-cols-2`}
          noValidate
        >
          <StockFields
            control={control}
            register={register}
            errors={e}
            idPrefix="sr"
            quantityRequired
            extra={
              <FormField
                id="sr-cost"
                label={t.products.stock.costPrice}
                required
                error={e.costPrice?.message}
                hint={t.products.stock.costPriceHint}
              >
                <Input
                  id="sr-cost"
                  inputMode="decimal"
                  aria-invalid={!!e.costPrice}
                  {...register('costPrice', {
                    onBlur: (ev) => setValue('costPrice', groupDigits(ev.target.value)),
                  })}
                />
              </FormField>
            }
          />
        </form>
        <DialogFooter className={FORM_DIALOG_FOOTER_CLASS}>
          <Button
            variant="outline"
            onClick={() => onOpenChange(false)}
            disabled={formState.isSubmitting}
          >
            {t.common.cancel}
          </Button>
          <Button type="submit" form="stock-receipt-form" disabled={formState.isSubmitting}>
            {formState.isSubmitting ? <Loader2 className="animate-spin" /> : <PackagePlus />}
            {t.products.stock.submit}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
