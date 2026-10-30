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
      <CardHeader>
        <CardTitle>{t.dashboard.topProducts}</CardTitle>
        <CardDescription>{t.dashboard.topProductsHint}</CardDescription>
      </CardHeader>
      <CardContent>
        {error && !data ? (
          <ErrorState message={error.message} onRetry={() => refetch()} />
        ) : isPending ? (
          <ListSkeleton />
        ) : data.length === 0 ? (
          <EmptyState icon={TrendingUp} title={t.dashboard.topProductsEmpty} />
        ) : (
          <ol className="space-y-4">
            {data.map((p, index) => (
              <li key={p.productId} className="space-y-1.5">
                <div className="flex items-baseline justify-between gap-3 text-sm">
                  <span className="flex min-w-0 items-baseline gap-2">
                    <span className="w-4 shrink-0 text-muted-foreground tabular-nums">
                      {index + 1}
                    </span>
                    <span className="truncate font-medium">{p.name}</span>
                  </span>
                  <span className="shrink-0 font-medium tabular-nums">
                    {formatCompactMoney(p.amount)}
                  </span>
                </div>
                <div className="flex items-center gap-3 pl-6">
                  <Progress value={(toChartNumber(p.amount) / max) * 100} className="h-1.5" />
                  <span className="w-20 shrink-0 text-right text-xs text-muted-foreground tabular-nums">
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
      <CardHeader className="flex flex-row items-start justify-between gap-2">
        <div className="space-y-1">
          <CardTitle>{t.dashboard.lowStock}</CardTitle>
          <CardDescription>{t.dashboard.lowStockHint}</CardDescription>
        </div>
        <Button asChild variant="ghost" size="sm">
          <Link to="/products?stock=low">
            {t.common.viewAll}
            <ArrowRight />
          </Link>
        </Button>
      </CardHeader>
      <CardContent>
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
                    <p className="truncate text-sm font-medium">{item.name}</p>
                    <Progress
                      value={pct}
                      className="h-1.5"
                      indicatorClassName={out ? 'bg-destructive' : 'bg-warning'}
                    />
                  </div>
                  <div className="shrink-0 text-right text-xs">
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
      <CardHeader className="flex flex-row items-start justify-between gap-2">
        <CardTitle>{t.dashboard.recentSales}</CardTitle>
        <Button asChild variant="ghost" size="sm">
          <Link to="/sales?tab=history">
            {t.common.viewAll}
            <ArrowRight />
          </Link>
        </Button>
      </CardHeader>
      <CardContent>
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
                  <p className="truncate text-sm font-medium">{sale.customer.name}</p>
                  <p className="truncate text-xs text-muted-foreground">
                    {sale.number} · {sale.user.fullName ?? sale.user.login} ·{' '}
                    {formatRelative(sale.soldAt)}
                  </p>
                </div>
                <MoneyText value={sale.totalAmount} className="shrink-0 text-sm font-medium" />
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}
