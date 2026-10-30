import { Permission, customerNameSchema, optionalPhoneSchema } from '@divine/shared';
import { Loader2 } from 'lucide-react';
import { useEffect } from 'react';
import { useForm } from 'react-hook-form';
import { toast } from 'sonner';
import { z, zodResolver } from '@/shared/forms/zod';
import { useHasAnyPermission } from '@/features/session/hooks/use-permissions';
import { t } from '@/i18n/uz';
import { FormField } from '@/shared/components/FormField';
import { formatPhone } from '@/shared/lib/format';
import { applyFieldErrors, toastError } from '@/shared/lib/mutation';
import { Button } from '@/shared/ui/button';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/shared/ui/dialog';
import { Input } from '@/shared/ui/input';
import { Textarea } from '@/shared/ui/textarea';
import type { CustomerDto } from '@/shared/types/api';
import { useSaveCustomer } from '../api/customers';

const schema = z.object({
  name: customerNameSchema,
  phone: z.string().refine((v) => optionalPhoneSchema.safeParse(v).success, {
    error: t.validation.phoneFormat,
  }),
  notes: z.string().max(1000),
});
type FormValues = z.infer<typeof schema>;

export function CustomerFormDialog({
  open,
  onOpenChange,
  customer,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  customer?: CustomerDto | null;
}) {
  const save = useSaveCustomer();
  const canWriteNotes = useHasAnyPermission([Permission.CUSTOMERS_MANAGE]);
  const { register, handleSubmit, reset, setError, formState } = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: { name: '', phone: '', notes: '' },
  });
  useEffect(() => {
    if (open) {
      reset({
        name: customer?.name ?? '',
        phone: customer?.phone ? formatPhone(customer.phone) : '',
        notes: customer?.notes ?? '',
      });
    }
  }, [open, customer, reset]);

  const onSubmit = handleSubmit(async (v) => {
    try {
      await save.mutateAsync({
        id: customer?.id,
        input: {
          name: v.name,
          phone: optionalPhoneSchema.parse(v.phone) ?? null,
          // Izohni faqat `customers.manage` yozadi (backend boshqalarga 403 qaytaradi).
          ...(canWriteNotes ? { notes: v.notes.trim() || null } : {}),
        },
      });
      toast.success(customer ? t.customers.form.updated : t.customers.form.created);
      onOpenChange(false);
    } catch (error) {
      if (!applyFieldErrors(error, setError)) toastError(error);
    }
  });

  const e = formState.errors;
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>
            {customer ? t.customers.form.editTitle : t.customers.form.createTitle}
          </DialogTitle>
        </DialogHeader>
        <form id="customer-form" onSubmit={onSubmit} className="grid gap-4" noValidate>
          <FormField id="c-name" label={t.customers.form.name} required error={e.name?.message}>
            <Input
              id="c-name"
              placeholder={t.sales.customer.namePlaceholder}
              aria-invalid={!!e.name}
              autoFocus
              {...register('name')}
            />
          </FormField>
          <FormField id="c-phone" label={t.customers.form.phone} optional error={e.phone?.message}>
            <Input
              id="c-phone"
              type="tel"
              placeholder={t.sales.customer.phonePlaceholder}
              aria-invalid={!!e.phone}
              {...register('phone')}
            />
          </FormField>
          {canWriteNotes ? (
            <FormField id="c-notes" label={t.customers.form.notes} optional>
              <Textarea id="c-notes" rows={3} {...register('notes')} />
            </FormField>
          ) : null}
        </form>
        <DialogFooter>
          <Button
            variant="outline"
            onClick={() => onOpenChange(false)}
            disabled={formState.isSubmitting}
          >
            {t.common.cancel}
          </Button>
          <Button type="submit" form="customer-form" disabled={formState.isSubmitting}>
            {formState.isSubmitting ? <Loader2 className="animate-spin" /> : null}
            {customer ? t.common.saveChanges : t.common.create}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
