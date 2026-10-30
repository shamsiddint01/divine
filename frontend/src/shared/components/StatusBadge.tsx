import { t } from '@/i18n/uz';
import { Badge } from '@/shared/ui/badge';

type StatusKey = keyof typeof t.status;

const VARIANT: Record<StatusKey, 'success' | 'warning' | 'destructive' | 'secondary' | 'info'> = {
  ACTIVE: 'success',
  INACTIVE: 'secondary',
  BLOCKED: 'destructive',
  DRAFT: 'warning',
  CONFIRMED: 'success',
  CANCELLED: 'secondary',
  COMPLETED: 'success',
  lowStock: 'warning',
  outOfStock: 'destructive',
  inStock: 'success',
};

/** Holat belgisi: rang + matn (rang hech qachon yolg'iz ma'no tashimaydi). */
export function StatusBadge({ status }: { status: string }) {
  const key = status as StatusKey;
  if (!(key in VARIANT)) return <Badge variant="secondary">{status}</Badge>;
  return (
    <Badge variant={VARIANT[key]}>
      <span className="size-1.5 rounded-full bg-current" aria-hidden />
      {t.status[key]}
    </Badge>
  );
}
