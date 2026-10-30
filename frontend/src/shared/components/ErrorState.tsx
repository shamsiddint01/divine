import { AlertTriangle, RotateCw } from 'lucide-react';
import { t } from '@/i18n/uz';
import { Button } from '@/shared/ui/button';

interface ErrorStateProps {
  /** Foydalanuvchiga ko'rsatiladigan o'zbekcha xabar (ApiError.message). */
  message: string;
  onRetry?: () => void;
}

/** Xato holati (REQ-154): texnik tafsilotlarsiz, qayta urinish imkoniyati bilan. */
export function ErrorState({ message, onRetry }: ErrorStateProps) {
  return (
    <div
      role="alert"
      className="flex flex-col items-center justify-center gap-3 rounded-xl border border-destructive/30 bg-destructive/5 px-6 py-10 text-center"
    >
      <AlertTriangle className="size-6 text-destructive" aria-hidden />
      <div className="space-y-1">
        <p className="font-medium">{t.common.errorTitle}</p>
        <p className="max-w-md text-sm text-muted-foreground">{message}</p>
      </div>
      {onRetry ? (
        <Button variant="outline" size="sm" onClick={onRetry}>
          <RotateCw />
          {t.common.retry}
        </Button>
      ) : null}
    </div>
  );
}
