import type { ReactNode } from 'react';
import { t } from '@/i18n/uz';
import { cn } from '@/shared/lib/utils';
import { Label } from '@/shared/ui/label';

interface FormFieldProps {
  id: string;
  label: string;
  error?: string;
  hint?: ReactNode;
  /** Label qatorining o'ng tomonidagi kichik amal (masalan, "Parolni unutdingizmi?"). */
  action?: ReactNode;
  required?: boolean;
  optional?: boolean;
  className?: string;
  children: ReactNode;
}

/** Forma maydoni: label, majburiy/ixtiyoriy belgisi, xato va izoh — barcha formalarda bir xil. */
export function FormField({
  id,
  label,
  error,
  hint,
  action,
  required,
  optional,
  className,
  children,
}: FormFieldProps) {
  return (
    <div className={cn('grid gap-1.5', className)}>
      {action ? (
        <div className="flex items-center justify-between gap-2">
        <Label htmlFor={id}>
          {label}
          {required ? (
            <span className="text-destructive" aria-label={t.common.required}>
              *
            </span>
          ) : null}
          {optional ? (
            <span className="font-normal text-muted-foreground">({t.common.optional})</span>
          ) : null}
        </Label>
          {action}
        </div>
      ) : (
        <Label htmlFor={id}>
          {label}
          {required ? (
            <span className="text-destructive" aria-label={t.common.required}>
              *
            </span>
          ) : null}
          {optional ? (
            <span className="font-normal text-muted-foreground">({t.common.optional})</span>
          ) : null}
        </Label>
      )}
      {children}
      {error ? (
        <p role="alert" className="text-xs text-destructive">
          {error}
        </p>
      ) : hint ? (
        <p id={`${id}-hint`} className="text-xs text-muted-foreground">
          {hint}
        </p>
      ) : null}
    </div>
  );
}
