import { ArrowRight, CheckCircle2, PackageX, Receipt, TrendingUp } from 'lucide-react';
import { Link } from 'react-router';
import { t } from '@/i18n/uz';
import { compareQty, toChartNumber } from '@/shared/lib/decimal';
import { formatCompactMoney, formatQuantity, formatRelative } from '@/shared/lib/format';
import { EmptyState } from '@/shared/components/EmptyState';
import { ErrorState } from '@/shared/components/ErrorState';
import { MoneyText, QtyText } from '@/shared/components/MoneyText';
import { Button } from '@/shared/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/shared/ui/card';
import { Progress } from '@/shared/ui/progress';
import { Skeleton } from '@/shared/ui/skeleton';
import type { DashboardSummaryDto } from '@/shared/types/api';
import { useSales } from '@/features/sales/api/sales';
import { useTopProducts } from '../api/dashboard';

/** Telefonda ixchamroq: ichki bo'shliq 16px, uzun nomlar kesilmasdan 2 qatorga o'tadi. */
const PAD = 'px-4 sm:px-6';

/** "Barchasini ko'rish" — telefonda kichik, sarlavhadan joy olmaydi. */
function ViewAllLink({ to }: { to: string }) {
  return (
    <Button
      asChild
      variant="ghost"
      size="sm"
      className="-mr-2 h-7 shrink-0 gap-1 px-2 text-xs sm:mr-0 sm:h-8 sm:gap-1.5 sm:px-3 sm:text-sm"
    >
      <Link to={to}>
        {t.common.viewAll}
        <ArrowRight />
      </Link>
    </Button>
  );
}

function ListSkeleton({ rows = 5 }: { rows?: number }) {
  return (
    <div className="space-y-4">
      {Array.from({ length: rows }, (_, i) => (
        <div key={i} className="space-y-2">
          <Skeleton className="h-4 w-2/3" />
          <Skeleton className="h-2 w-full" />
        </div>
      ))}
    </div>
  );
}

export function TopProductsCard() {
  const { data, isPending, error, refetch } = useTopProducts(30);
  const max = data?.[0] ? toChartNumber(data[0].amount) : 1;
  return (
    <Card className="gap-4">
      <CardHeader className={PAD}>
        <CardTitle>{t.dashboard.topProducts}</CardTitle>
        <CardDescription>{t.dashboard.topProductsHint}</CardDescription>
      </CardHeader>
      <CardContent className={PAD}>
        {error && !data ? (
          <ErrorState message={error.message} onRetry={() => refetch()} />
        ) : isPending ? (
          <ListSkeleton />
        ) : data.length === 0 ? (
          <EmptyState icon={TrendingUp} title={t.dashboard.topProductsEmpty} />
        ) : (
          <ol className="space-y-3 sm:space-y-4">
            {data.map((p, index) => (
              <li key={p.productId} className="space-y-1.5">
                <div className="flex items-baseline justify-between gap-2 text-[13px] sm:gap-3 sm:text-sm">
                  <span className="flex min-w-0 items-baseline gap-2">
                    <span className="w-4 shrink-0 text-muted-foreground tabular-nums">
                      {index + 1}
                    </span>
                    <span className="line-clamp-2 font-medium break-words sm:truncate">
                      {p.name}
                    </span>
                  </span>
                  <span className="shrink-0 font-medium tabular-nums">
                    {formatCompactMoney(p.amount)}
                  </span>
                </div>
                <div className="flex items-center gap-3 pl-6">
                  <Progress value={(toChartNumber(p.amount) / max) * 100} className="h-1.5" />
                  <span className="w-16 shrink-0 text-right text-[11px] text-muted-foreground tabular-nums sm:w-20 sm:text-xs">
                    {formatQuantity(p.quantity)} {t.units[p.unit]}
                  </span>
                </div>
              </li>
            ))}
          </ol>
        )}
      </CardContent>
    </Card>
  );
}

export function LowStockCard({
  summary,
  loading,
  error,
  onRetry,
}: {
  summary?: DashboardSummaryDto;
  loading: boolean;
  /** Xulosa yuklanmasa "hammasi yetarli" deb ko'rsatilmaydi — xato holati. */
  error?: Error | null;
  onRetry?: () => void;
}) {
  const items = summary?.lowStock.items ?? [];
  return (
    <Card className="gap-4">
      <CardHeader className={`flex flex-row items-start justify-between gap-2 ${PAD}`}>
        <div className="min-w-0 space-y-1">
          <CardTitle>{t.dashboard.lowStock}</CardTitle>
          <CardDescription className="text-xs sm:text-sm">
            {t.dashboard.lowStockHint}
          </CardDescription>
        </div>
        <ViewAllLink to="/products?stock=low" />
      </CardHeader>
      <CardContent className={PAD}>
        {error && !summary ? (
          <ErrorState message={error.message} onRetry={onRetry} />
        ) : loading ? (
          <ListSkeleton />
        ) : items.length === 0 ? (
          <EmptyState icon={CheckCircle2} title={t.dashboard.lowStockEmpty} />
        ) : (
          <ul className="divide-y">
            {items.map((item) => {
              const out = compareQty(item.stock, '0') <= 0;
              const pct = Math.min(
                100,
                (toChartNumber(item.stock) / Math.max(toChartNumber(item.threshold), 1)) * 100,
              );
              return (
                <li
                  key={item.productId}
                  className="flex items-center gap-3 py-2.5 first:pt-0 last:pb-0"
                >
                  <span className={out ? 'text-destructive' : 'text-warning'}>
                    <PackageX className="size-4" aria-hidden />
                  </span>
                  <div className="min-w-0 flex-1 space-y-1">
                    <p className="line-clamp-2 text-[13px] font-medium break-words sm:truncate sm:text-sm">
                      {item.name}
                    </p>
                    <Progress
                      value={pct}
                      className="h-1.5"
                      indicatorClassName={out ? 'bg-destructive' : 'bg-warning'}
                    />
                  </div>
                  <div className="shrink-0 text-right text-[11px] sm:text-xs">
                    <QtyText value={item.stock} unit={item.unit} className="font-medium" />
                    <p className="text-muted-foreground">
                      {t.dashboard.min} {formatQuantity(item.threshold)}
                    </p>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}

export function RecentSalesCard() {
  const { data, isPending, error, refetch } = useSales({
    page: 1,
    pageSize: 6,
    sort: 'soldAt:desc',
  });
  return (
    <Card className="gap-4">
      <CardHeader className={`flex flex-row items-start justify-between gap-2 ${PAD}`}>
        <CardTitle>{t.dashboard.recentSales}</CardTitle>
        <ViewAllLink to="/sales?tab=history" />
      </CardHeader>
      <CardContent className={PAD}>
        {error && !data ? (
          <ErrorState message={error.message} onRetry={() => refetch()} />
        ) : isPending ? (
          <ListSkeleton rows={6} />
        ) : data.data.length === 0 ? (
          <EmptyState icon={Receipt} title={t.dashboard.recentSalesEmpty} />
        ) : (
          <ul className="divide-y">
            {data.data.map((sale) => (
              <li
                key={sale.id}
                className="flex items-center justify-between gap-3 py-2.5 first:pt-0 last:pb-0"
              >
                <div className="min-w-0">
                  <p className="truncate text-[13px] font-medium sm:text-sm">
                    {sale.customer.name}
                  </p>
                  <p className="line-clamp-2 text-[11px] text-muted-foreground sm:truncate sm:text-xs">
                    {sale.number} · {sale.user.fullName ?? sale.user.login} ·{' '}
                    {formatRelative(sale.soldAt)}
                  </p>
                </div>
                <MoneyText
                  value={sale.totalAmount}
                  className="shrink-0 text-[13px] font-medium sm:text-sm"
                />
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}
