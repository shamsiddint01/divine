import {
  Boxes,
  PackageCheck,
  PackageX,
  Receipt,
  ShoppingBag,
  ShoppingCart,
  TrendingUp,
  Users,
  Wallet,
} from 'lucide-react';
import { lazy, Suspense } from 'react';
import { Link } from 'react-router';
import { Permission } from '@divine/shared';
import { useCurrentUser } from '@/features/session/api/session';
import { useHasAnyPermission } from '@/features/session/hooks/use-permissions';
import { t } from '@/i18n/uz';
import { divideMoney } from '@/shared/lib/decimal';
import { formatCompactMoney, formatDate, formatQuantity } from '@/shared/lib/format';
import { cn } from '@/shared/lib/utils';
import { EmptyState } from '@/shared/components/EmptyState';
import { ErrorState } from '@/shared/components/ErrorState';
import { PageHeader } from '@/shared/components/PageHeader';
import { StatCard } from '@/shared/components/StatCard';
import { Button } from '@/shared/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/shared/ui/card';
import { Skeleton } from '@/shared/ui/skeleton';
import { useDashboardSummary, useMyDashboardSummary } from '../api/dashboard';
import { LowStockCard, RecentSalesCard, TopProductsCard } from '../components/DashboardPanels';
import { salesChange } from '../lib/sales-change';

// Grafik kutubxonasi (recharts) — sahifaning eng katta qismi: KPI'lar uni kutmasdan chiqadi.
const SalesChart = lazy(async () => ({
  default: (await import('../components/SalesChart')).SalesChart,
}));

/**
 * `dashboard.admin` — kompaniya bo'yicha KPI'lar, grafik, top va kam qoldiq; aks holda (sotuvchi,
 * `dashboard.own`, OWN-08) — faqat o'zining bugungi ko'rsatkichlari va oxirgi sotuvlari.
 */
export function DashboardPage() {
  const isAdmin = useHasAnyPermission([Permission.DASHBOARD_ADMIN]);
  return isAdmin ? <AdminDashboard /> : <SellerDashboard />;
}

function SellerDashboard() {
  const { data: me } = useCurrentUser();
  const { data, isPending, error, refetch } = useMyDashboardSummary();
  const warehouses = data?.warehouses ?? [];
  return (
    <>
      <PageHeader
        title={me ? t.dashboard.greeting(me.fullName?.split(' ')[0] ?? me.login) : t.nav.dashboard}
        description={
          <>
            {t.dashboard.my.description}
            {data ? (
              <span className="text-muted-foreground"> · {formatDate(data.businessDate)}</span>
            ) : null}
          </>
        }
        actions={
          <Button asChild>
            <Link to="/sales">
              <ShoppingCart />
              {t.dashboard.my.newSale}
            </Link>
          </Button>
        }
      />

      {error && !data ? (
        <ErrorState message={error.message} onRetry={() => refetch()} />
      ) : (
        <div className="grid gap-4 sm:grid-cols-3">
          <StatCard
            label={t.dashboard.my.todaySales}
            icon={Wallet}
            tone="success"
            loading={isPending}
            value={data ? formatCompactMoney(data.today.salesAmount) : null}
            hint={data ? t.dashboard.kpi.salesCount(data.today.salesCount) : null}
          />
          <StatCard
            label={t.dashboard.my.todaySoldQty}
            icon={ShoppingBag}
            loading={isPending}
            value={data ? formatQuantity(data.today.soldQuantity) : null}
          />
          <StatCard
            label={t.dashboard.kpi.averageCheck}
            icon={Receipt}
            tone="info"
            loading={isPending}
            value={
              data
                ? formatCompactMoney(divideMoney(data.today.salesAmount, data.today.salesCount))
                : null
            }
            hint={t.dashboard.kpi.averageCheckHint}
          />
        </div>
      )}

      <div className="grid gap-4 lg:grid-cols-2">
        <RecentSalesCard />
        <Card className="gap-4">
          <CardHeader>
            <CardTitle>{t.dashboard.my.warehouses}</CardTitle>
          </CardHeader>
          <CardContent>
            {isPending ? (
              <Skeleton className="h-16 w-full" />
            ) : warehouses.length === 0 ? (
              <EmptyState icon={Boxes} title={t.dashboard.my.noWarehouses} />
            ) : (
              <ul className="divide-y">
                {warehouses.map((w) => (
                  <li key={w.id} className="flex items-center gap-3 py-2.5 first:pt-0 last:pb-0">
                    <Boxes className="size-4 text-muted-foreground" aria-hidden />
                    <span className="truncate text-sm font-medium">{w.name}</span>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>
      </div>
    </>
  );
}

function AdminDashboard() {
  const { data: me } = useCurrentUser();
  const { data, isPending, error, refetch } = useDashboardSummary();
  const change = data ? salesChange(data) : null;

  return (
    <>
      <PageHeader
        title={me ? t.dashboard.greeting(me.fullName?.split(' ')[0] ?? me.login) : t.nav.dashboard}
        description={
          <>
            {t.dashboard.description}
            {data ? (
              <span className="text-muted-foreground"> · {formatDate(data.businessDate)}</span>
            ) : null}
          </>
        }
      />

      {error && !data ? (
        <ErrorState message={error.message} onRetry={() => refetch()} />
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          <StatCard
            label={t.dashboard.kpi.todaySoldQty}
            icon={ShoppingBag}
            loading={isPending}
            value={data ? formatQuantity(data.today.soldQuantity) : null}
            hint={data ? t.dashboard.kpi.salesCount(data.today.salesCount) : null}
          />
          <StatCard
            label={t.dashboard.kpi.todaySales}
            icon={Wallet}
            tone="success"
            loading={isPending}
            value={data ? formatCompactMoney(data.today.salesAmount) : null}
            hint={
              change ? (
                <span>
                  <span
                    className={cn('font-medium', change.up ? 'text-success' : 'text-destructive')}
                  >
                    {change.text}
                  </span>{' '}
                  {t.dashboard.kpi.vsYesterday}
                </span>
              ) : null
            }
          />
          <StatCard
            label={t.dashboard.kpi.totalSoldQty}
            icon={PackageCheck}
            tone="info"
            loading={isPending}
            value={data ? formatQuantity(data.allTime.soldQuantity) : null}
            hint={t.dashboard.kpi.allTime}
          />
          <StatCard
            label={t.dashboard.kpi.totalSales}
            icon={TrendingUp}
            tone="info"
            loading={isPending}
            value={data ? formatCompactMoney(data.allTime.salesAmount) : null}
            hint={data ? t.dashboard.kpi.salesCount(data.allTime.salesCount) : null}
          />
          <StatCard
            label={t.dashboard.kpi.stockTotal}
            icon={Boxes}
            loading={isPending}
            value={data ? formatQuantity(data.warehouse.totalQuantity) : null}
            hint={data ? t.dashboard.kpi.positions(data.warehouse.productCount) : null}
          />
          <StatCard
            label={t.dashboard.kpi.lowStock}
            icon={PackageX}
            tone={data && data.lowStock.count > 0 ? 'warning' : 'success'}
            loading={isPending}
            value={data ? data.lowStock.count : null}
            hint={
              data
                ? data.lowStock.count > 0
                  ? t.dashboard.kpi.needsAttention
                  : t.dashboard.kpi.allGood
                : null
            }
          />
          <StatCard
            label={t.dashboard.kpi.activeUsers}
            icon={Users}
            loading={isPending}
            value={data ? `${data.users.active} / ${data.users.total}` : null}
            hint={data ? t.dashboard.kpi.soldToday(data.users.soldToday) : null}
          />
          <StatCard
            label={t.dashboard.kpi.averageCheck}
            icon={Receipt}
            tone="success"
            loading={isPending}
            value={
              data
                ? formatCompactMoney(divideMoney(data.today.salesAmount, data.today.salesCount))
                : null
            }
            hint={t.dashboard.kpi.averageCheckHint}
          />
        </div>
      )}

      <div className="grid gap-4 lg:grid-cols-3">
        <div className="lg:col-span-2">
          <Suspense fallback={<Skeleton className="h-[26rem] w-full rounded-xl" />}>
            <SalesChart />
          </Suspense>
        </div>
        <TopProductsCard />
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <LowStockCard summary={data} loading={isPending} error={error} onRetry={() => refetch()} />
        <RecentSalesCard />
      </div>
    </>
  );
}
