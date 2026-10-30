import { entityNameSchema } from '@divine/shared';
import { Loader2 } from 'lucide-react';
import { useEffect } from 'react';
import { useForm } from 'react-hook-form';
import { toast } from 'sonner';
import { z, zodResolver } from '@/shared/forms/zod';
import { t } from '@/i18n/uz';
import { FormField } from '@/shared/components/FormField';
import { applyFieldErrors, toastError } from '@/shared/lib/mutation';
import { Button } from '@/shared/ui/button';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/shared/ui/dialog';
import { Input } from '@/shared/ui/input';
import type { WarehouseDto } from '@/shared/types/api';
import { useSaveWarehouse } from '../api/warehouses';

const schema = z.object({ name: entityNameSchema, address: z.string().max(300) });
type FormValues = z.infer<typeof schema>;

export function WarehouseFormDialog({
  open,
  onOpenChange,
  warehouse,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  warehouse?: WarehouseDto | null;
}) {
  const save = useSaveWarehouse();
  const { register, handleSubmit, reset, setError, formState } = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: { name: '', address: '' },
  });
  useEffect(() => {
    if (open) reset({ name: warehouse?.name ?? '', address: warehouse?.address ?? '' });
  }, [open, warehouse, reset]);

  const onSubmit = handleSubmit(async (v) => {
    try {
      await save.mutateAsync({
        id: warehouse?.id,
        input: { name: v.name, address: v.address.trim() || null },
      });
      toast.success(warehouse ? t.warehouses.form.updated : t.warehouses.form.created);
      onOpenChange(false);
    } catch (error) {
      if (!applyFieldErrors(error, setError)) toastError(error);
    }
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>
            {warehouse ? t.warehouses.form.editTitle : t.warehouses.form.createTitle}
          </DialogTitle>
        </DialogHeader>
        <form id="warehouse-form" onSubmit={onSubmit} className="grid gap-4" noValidate>
          <FormField
            id="w-name"
            label={t.warehouses.form.name}
            required
            error={formState.errors.name?.message}
          >
            <Input
              id="w-name"
              placeholder={t.warehouses.form.namePlaceholder}
              aria-invalid={!!formState.errors.name}
              autoFocus
              {...register('name')}
            />
          </FormField>
          <FormField id="w-address" label={t.warehouses.form.address} optional>
            <Input
              id="w-address"
              placeholder={t.warehouses.form.addressPlaceholder}
              {...register('address')}
            />
          </FormField>
        </form>
        <DialogFooter>
          <Button
            variant="outline"
            onClick={() => onOpenChange(false)}
            disabled={formState.isSubmitting}
          >
            {t.common.cancel}
          </Button>
          <Button type="submit" form="warehouse-form" disabled={formState.isSubmitting}>
            {formState.isSubmitting ? <Loader2 className="animate-spin" /> : null}
            {warehouse ? t.common.saveChanges : t.common.create}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
