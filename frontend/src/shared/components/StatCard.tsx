import type { LucideIcon } from 'lucide-react';
import type { ReactNode } from 'react';
import { cn } from '@/shared/lib/utils';
import { Card } from '@/shared/ui/card';
import { Skeleton } from '@/shared/ui/skeleton';

type Tone = 'default' | 'success' | 'warning' | 'danger' | 'info';

const TONES: Record<Tone, string> = {
  default: 'bg-primary/10 text-primary',
  success: 'bg-success/12 text-success',
  warning: 'bg-warning/15 text-warning',
  danger: 'bg-destructive/10 text-destructive',
  info: 'bg-info/12 text-info',
};

interface StatCardProps {
  label: string;
  value: ReactNode;
  hint?: ReactNode;
  icon: LucideIcon;
  tone?: Tone;
  loading?: boolean;
  className?: string;
}

/**
 * KPI kartasi: katta raqam + qisqa izoh (dataviz: bitta raqam uchun grafik emas, stat tile). Telefonda
 * (`sm` dan kichik) ixchamroq — ikki ustunli to'rga sig'adi.
 */
export function StatCard({
  label,
  value,
  hint,
  icon: Icon,
  tone = 'default',
  loading,
  className,
}: StatCardProps) {
  return (
    <Card className={cn('h-full gap-2 p-3 sm:gap-3 sm:p-5', className)}>
      <div className="flex items-start justify-between gap-2 sm:gap-3">
        <p className="text-xs leading-snug font-medium text-muted-foreground sm:text-sm">{label}</p>
        <span
          className={cn(
            'flex size-7 shrink-0 items-center justify-center rounded-md sm:size-9 sm:rounded-lg',
            TONES[tone],
          )}
        >
          <Icon className="size-4 sm:size-[18px]" aria-hidden />
        </span>
      </div>
      {loading ? (
        <div className="space-y-2">
          <Skeleton className="h-6 w-full max-w-32 sm:h-7" />
          <Skeleton className="h-4 w-3/4 max-w-24" />
        </div>
      ) : (
        <div className="space-y-0.5 sm:space-y-1">
          <p className="text-lg font-semibold tracking-tight tabular-nums sm:text-2xl">{value}</p>
          {/* Izoh qatoriga doim joy ajratiladi — barcha kartalarda raqam bir xil balandlikda turadi */}
          <div className="min-h-4 text-[11px] leading-snug text-muted-foreground sm:text-xs">
            {hint}
          </div>
        </div>
      )}
    </Card>
  );
}
