import type { CreditRowState, CreditStatus } from '@divine/shared';
import { t } from '@/i18n/uz';
import { cn } from '@/shared/lib/utils';
import { Badge } from '@/shared/ui/badge';

const TONE = {
  success: 'border-success/30 bg-success/10 text-success',
  warning: 'border-warning/30 bg-warning/10 text-warning',
  danger: 'border-destructive/30 bg-destructive/10 text-destructive',
  info: 'border-info/30 bg-info/10 text-info',
  muted: '',
};

const STATUS_TONE: Record<CreditStatus, keyof typeof TONE> = {
  ACTIVE: 'info',
  OVERDUE: 'danger',
  PAID: 'success',
};

const ROW_TONE: Record<CreditRowState, keyof typeof TONE> = {
  PENDING: 'muted',
  PARTIAL: 'info',
  PAID: 'success',
  CARRIED: 'warning',
  OVERDUE: 'danger',
};

export function CreditStatusBadge({ status }: { status: CreditStatus }) {
  return (
    <Badge variant="outline" className={cn(TONE[STATUS_TONE[status]])}>
      {t.credits.status[status]}
    </Badge>
  );
}

export function CreditRowBadge({ state }: { state: CreditRowState }) {
  return (
    <Badge variant="outline" className={cn('whitespace-nowrap', TONE[ROW_TONE[state]])}>
      {t.credits.rowState[state]}
    </Badge>
  );
}
