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
import { Textarea } from '@/shared/ui/textarea';
import type { ProductGroupDto } from '@/shared/types/api';
import { useSaveGroup } from '../api/groups';

const schema = z.object({
  name: entityNameSchema,
  description: z.string().max(1000),
});
type FormValues = z.infer<typeof schema>;

interface GroupFormDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  group?: ProductGroupDto | null;
}

export function GroupFormDialog({ open, onOpenChange, group }: GroupFormDialogProps) {
  const save = useSaveGroup();
  const { register, handleSubmit, reset, setError, formState } = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: { name: '', description: '' },
  });

  useEffect(() => {
    if (open) reset({ name: group?.name ?? '', description: group?.description ?? '' });
  }, [open, group, reset]);

  const onSubmit = handleSubmit(async (v) => {
    try {
      await save.mutateAsync({
        id: group?.id,
        input: { name: v.name, description: v.description.trim() || null },
      });
      toast.success(group ? t.groups.form.updated : t.groups.form.created);
      onOpenChange(false);
    } catch (error) {
      if (!applyFieldErrors(error, setError)) toastError(error);
    }
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{group ? t.groups.form.editTitle : t.groups.form.createTitle}</DialogTitle>
        </DialogHeader>
        <form id="group-form" onSubmit={onSubmit} className="grid gap-4" noValidate>
          <FormField
            id="g-name"
            label={t.groups.form.name}
            required
            error={formState.errors.name?.message}
          >
            <Input
              id="g-name"
              placeholder={t.groups.form.namePlaceholder}
              aria-invalid={!!formState.errors.name}
              autoFocus
              {...register('name')}
            />
          </FormField>
          <FormField
            id="g-desc"
            label={t.groups.form.description}
            optional
            error={formState.errors.description?.message}
          >
            <Textarea
              id="g-desc"
              rows={3}
              placeholder={t.groups.form.descriptionPlaceholder}
              {...register('description')}
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
          <Button type="submit" form="group-form" disabled={formState.isSubmitting}>
            {formState.isSubmitting ? <Loader2 className="animate-spin" /> : null}
            {group ? t.common.saveChanges : t.common.create}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
