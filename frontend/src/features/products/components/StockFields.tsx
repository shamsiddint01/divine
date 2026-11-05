import type { ReactNode } from 'react';
import {
  type Control,
  Controller,
  type FieldErrors,
  type FieldValues,
  type Path,
  type UseFormRegister,
} from 'react-hook-form';
import { useWarehouses } from '@/features/warehouses/api/warehouses';
import { t } from '@/i18n/uz';
import { DatePicker } from '@/shared/components/DatePicker';
import { FormField } from '@/shared/components/FormField';
import { OptionsLoadError } from '@/shared/components/OptionsLoadError';
import { z } from '@/shared/forms/zod';
import { todayInTashkent } from '@/shared/lib/format';
import { cn } from '@/shared/lib/utils';
import { Input } from '@/shared/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/shared/ui/select';
import { Textarea } from '@/shared/ui/textarea';

/** Qoldiq qo'shish maydonlari (sobiq "Kirim"): yangi mahsulot formasida ham, "Qoldiq qo'shish"da ham. */
export const stockShape = {
  warehouseId: z.string(),
  quantity: z.string(),
  date: z.string().min(1),
  notes: z.string(),
};
export type StockValues = { warehouseId: string; quantity: string; date: string; notes: string };

export const emptyStock = (): StockValues => ({
  warehouseId: '',
  quantity: '',
  date: todayInTashkent(),
  notes: '',
});

/** Faol omborlar; bittasi bo'lsa — oldindan tanlanadi (formani tezroq to'ldirish uchun). */
export function useActiveWarehouses() {
  const query = useWarehouses();
  const active = (query.data ?? []).filter((w) => w.status === 'ACTIVE');
  return { ...query, active, single: active.length === 1 ? active[0]!.id : '' };
}

interface StockFieldsProps<T extends FieldValues> {
  control: Control<T>;
  register: UseFormRegister<T>;
  errors: FieldErrors<{ stock: StockValues }>;
  idPrefix: string;
  /** Miqdordan keyin qo'shimcha maydon (masalan, partiya kelgan narxi). */
  extra?: ReactNode;
  quantityRequired?: boolean;
}

export function StockFields<T extends FieldValues>({
  control,
  register,
  errors,
  idPrefix,
  extra,
  quantityRequired,
}: StockFieldsProps<T>) {
  const { active, error, data, refetch } = useActiveWarehouses();
  const e = errors.stock;
  const name = (field: keyof StockValues) => `stock.${field}` as Path<T>;
  const id = (field: string) => `${idPrefix}-${field}`;
  return (
    <>
      <FormField
        id={id('warehouse')}
        label={t.products.stock.warehouse}
        required={quantityRequired}
        error={e?.warehouseId?.message}
        hint={error && !data ? <OptionsLoadError onRetry={() => refetch()} /> : null}
      >
        <Controller
          control={control}
          name={name('warehouseId')}
          render={({ field }) => (
            <Select value={field.value as string} onValueChange={field.onChange}>
              <SelectTrigger id={id('warehouse')} aria-invalid={!!e?.warehouseId}>
                <SelectValue placeholder={t.common.selectPlaceholder} />
              </SelectTrigger>
              <SelectContent>
                {active.map((w) => (
                  <SelectItem key={w.id} value={w.id}>
                    {w.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}
        />
      </FormField>
      <FormField
        id={id('quantity')}
        label={t.products.stock.quantity}
        required={quantityRequired}
        optional={!quantityRequired}
        error={e?.quantity?.message}
      >
        <Input
          id={id('quantity')}
          inputMode="decimal"
          aria-invalid={!!e?.quantity}
          {...register(name('quantity'))}
        />
      </FormField>
      {extra}
      <FormField id={id('date')} label={t.products.stock.date} required error={e?.date?.message}>
        <Controller
          control={control}
          name={name('date')}
          render={({ field }) => (
            <DatePicker
              id={id('date')}
              value={field.value as string}
              onChange={field.onChange}
              invalid={!!e?.date}
            />
          )}
        />
      </FormField>
      <FormField id={id('notes')} label={t.products.stock.notes} optional className="col-span-full">
        <Textarea
          id={id('notes')}
          rows={2}
          placeholder={t.products.stock.notesPlaceholder}
          {...register(name('notes'))}
        />
      </FormField>
    </>
  );
}

/** Bo'lim sarlavhasi (formani "Asosiy ma'lumot / Narx / Boshlang'ich qoldiq" qismlariga ajratadi). */
export function FormSection({
  title,
  hint,
  columns = 2,
  children,
}: {
  title: string;
  hint?: string;
  /** Katta ekrandagi ustunlar soni (telefonda doim bitta). */
  columns?: 2 | 3;
  children: ReactNode;
}) {
  return (
    <fieldset className={cn('grid gap-4', columns === 3 ? 'sm:grid-cols-3' : 'sm:grid-cols-2')}>
      <legend className="mb-3 w-full">
        <span className="block text-sm font-semibold">{title}</span>
        {hint ? <span className="mt-0.5 block text-xs text-muted-foreground">{hint}</span> : null}
      </legend>
      {children}
    </fieldset>
  );
}

/**
 * Uzun forma oynasi: telefonda pastdan chiqadi (bottom sheet), desktopda markazda; kontent
 * o'zi aylanadi, "Saqlash" paneli doim ko'rinib turadi.
 */
export const FORM_DIALOG_CLASS =
  'flex max-h-[calc(100svh-2rem)] flex-col gap-0 overflow-hidden p-0 max-sm:top-auto max-sm:bottom-0 max-sm:max-h-[92svh] max-sm:max-w-full max-sm:translate-y-0 max-sm:rounded-b-none max-sm:data-[state=open]:slide-in-from-bottom';
export const FORM_DIALOG_HEADER_CLASS = 'border-b px-4 pt-5 pb-4 sm:px-6';
export const FORM_DIALOG_BODY_CLASS = 'flex-1 overflow-y-auto px-4 py-5 sm:px-6';
export const FORM_DIALOG_FOOTER_CLASS =
  'border-t bg-card px-4 py-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] sm:px-6';
