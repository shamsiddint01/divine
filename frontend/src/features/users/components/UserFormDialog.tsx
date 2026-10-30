import { ROLE_CODES, loginSchema } from '@divine/shared';
import { AlertTriangle, Loader2 } from 'lucide-react';
import { useEffect } from 'react';
import { Controller, useForm, useWatch } from 'react-hook-form';
import { toast } from 'sonner';
import { z, zodResolver } from '@/shared/forms/zod';
import { t } from '@/i18n/uz';
import { FormField } from '@/shared/components/FormField';
import { OptionsLoadError } from '@/shared/components/OptionsLoadError';
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
import type { UserDto } from '@/shared/types/api';
import { useCreateUser, useUpdateUser, useWarehouseOptions } from '../api/users';

const schema = z.object({
  login: loginSchema,
  fullName: z.string().max(150),
  role: z.enum(ROLE_CODES),
  warehouseIds: z.array(z.string()),
});
type FormValues = z.infer<typeof schema>;

interface UserFormDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  user?: UserDto | null;
  /** Yaratilgandan keyin bir martalik parolni ko'rsatish. */
  onCreated: (login: string, password: string) => void;
  /** O'z hisobini tahrirlayotgan admin: rolni o'zgartira olmaydi (BR-27, backend ham rad etadi). */
  isSelf?: boolean;
}

/** Parol maydoni YO'Q: parolni server yaratadi (BR-02, BR-04). */
export function UserFormDialog({
  open,
  onOpenChange,
  user,
  onCreated,
  isSelf = false,
}: UserFormDialogProps) {
  const {
    data: warehouses,
    error: warehousesError,
    refetch: refetchWarehouses,
  } = useWarehouseOptions(open);
  const create = useCreateUser();
  const update = useUpdateUser();
  const { register, control, handleSubmit, reset, setError, formState } = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: { login: '', fullName: '', role: 'USER', warehouseIds: [] },
  });
  const [role, warehouseIds] = useWatch({ control, name: ['role', 'warehouseIds'] });

  useEffect(() => {
    if (open) {
      reset(
        user
          ? {
              login: user.login,
              fullName: user.fullName ?? '',
              role: user.role,
              warehouseIds: user.warehouses.map((w) => w.id),
            }
          : { login: '', fullName: '', role: 'USER', warehouseIds: [] },
      );
    }
  }, [open, user, reset]);

  const onSubmit = handleSubmit(async (v) => {
    try {
      if (user) {
        await update.mutateAsync({
          id: user.id,
          input: {
            fullName: v.fullName.trim() || null,
            ...(isSelf ? {} : { role: v.role }),
            warehouseIds: v.warehouseIds,
          },
        });
        toast.success(t.users.form.updated);
      } else {
        const res = await create.mutateAsync({
          login: v.login,
          fullName: v.fullName.trim() || null,
          role: v.role,
          warehouseIds: v.warehouseIds,
        });
        toast.success(t.users.form.created);
        onCreated(res.user.login, res.generatedPassword);
      }
      onOpenChange(false);
    } catch (error) {
      if (!applyFieldErrors(error, setError)) toastError(error);
    }
  });

  const e = formState.errors;
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{user ? t.users.form.editTitle : t.users.form.createTitle}</DialogTitle>
          {!user ? <DialogDescription>{t.users.form.createDescription}</DialogDescription> : null}
        </DialogHeader>
        <form id="user-form" onSubmit={onSubmit} className="grid gap-4" noValidate>
          <FormField
            id="u-login"
            label={t.users.form.login}
            required
            error={e.login?.message}
            hint={t.users.form.loginHint}
          >
            <Input
              id="u-login"
              placeholder={t.users.form.loginPlaceholder}
              autoComplete="off"
              autoCapitalize="none"
              spellCheck={false}
              disabled={Boolean(user)}
              aria-invalid={!!e.login}
              autoFocus={!user}
              {...register('login')}
            />
          </FormField>
          <FormField id="u-name" label={t.users.form.fullName} optional>
            <Input
              id="u-name"
              placeholder={t.users.form.fullNamePlaceholder}
              {...register('fullName')}
            />
          </FormField>
          <FormField
            id="u-role"
            label={t.users.form.role}
            required
            hint={isSelf ? t.users.form.selfRoleHint : undefined}
          >
            <Controller
              control={control}
              name="role"
              render={({ field }) => (
                <Select value={field.value} onValueChange={field.onChange} disabled={isSelf}>
                  <SelectTrigger id="u-role">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {ROLE_CODES.map((r) => (
                      <SelectItem key={r} value={r}>
                        {t.roles[r]}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              )}
            />
          </FormField>
          <FormField
            id="u-warehouses"
            label={t.users.form.warehouses}
            hint={
              warehousesError && !warehouses ? (
                <OptionsLoadError onRetry={() => refetchWarehouses()} />
              ) : (
                t.users.form.warehousesHint
              )
            }
          >
            <Controller
              control={control}
              name="warehouseIds"
              render={({ field }) => (
                <div id="u-warehouses" className="divide-y rounded-lg border">
                  {warehouses && warehouses.length === 0 ? (
                    <p className="px-3 py-2.5 text-sm text-muted-foreground">
                      {t.users.form.noActiveWarehouses}
                    </p>
                  ) : null}
                  {(warehouses ?? []).map((w) => {
                    const checked = field.value.includes(w.id);
                    return (
                      <label
                        key={w.id}
                        className="flex cursor-pointer items-center justify-between gap-3 px-3 py-2.5 text-sm"
                      >
                        <span>
                          <span className="block font-medium">{w.name}</span>
                          <span className="block text-xs text-muted-foreground">
                            {w.address ?? t.common.notSet}
                          </span>
                        </span>
                        <Switch
                          checked={checked}
                          onCheckedChange={(on) =>
                            field.onChange(
                              on ? [...field.value, w.id] : field.value.filter((x) => x !== w.id),
                            )
                          }
                          aria-label={w.name}
                        />
                      </label>
                    );
                  })}
                </div>
              )}
            />
          </FormField>
          {role === 'USER' && warehouseIds.length === 0 ? (
            <p className="flex items-center gap-2 rounded-md bg-warning/10 p-3 text-sm text-warning">
              <AlertTriangle className="size-4 shrink-0" />
              {t.users.form.noWarehouseWarning}
            </p>
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
          <Button type="submit" form="user-form" disabled={formState.isSubmitting}>
            {formState.isSubmitting ? <Loader2 className="animate-spin" /> : null}
            {user ? t.common.saveChanges : t.common.create}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
