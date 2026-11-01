import { useId, useState } from 'react';
import { BarChart3 } from 'lucide-react';
import {
  Area,
  AreaChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { t } from '@/i18n/uz';
import { divideMoney, sumMoney, toChartNumber } from '@/shared/lib/decimal';
import {
  formatCompactMoney,
  formatDate,
  formatDayShort,
  formatInteger,
  formatMoney,
} from '@/shared/lib/format';
import { EmptyState } from '@/shared/components/EmptyState';
import { ErrorState } from '@/shared/components/ErrorState';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/shared/ui/card';
import { Skeleton } from '@/shared/ui/skeleton';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/shared/ui/table';
import { Tabs, TabsList, TabsTrigger } from '@/shared/ui/tabs';
import type { SalesTrendPoint } from '@/shared/types/api';
import { useSalesTrend } from '../api/dashboard';

const RANGES = [
  { days: 7, label: t.dashboard.chart.days7 },
  { days: 14, label: t.dashboard.chart.days14 },
  { days: 30, label: t.dashboard.chart.days30 },
];

interface ChartRow {
  date: string;
  amount: number;
  amountText: string;
  count: number;
}

function ChartTooltip({
  active,
  payload,
}: {
  active?: boolean;
  payload?: { payload: ChartRow }[];
}) {
  const row = payload?.[0]?.payload;
  if (!active || !row) return null;
  // Matn — matn rangida (seriya rangida emas); seriya belgisi kichik rangli kvadrat.
  return (
    <div className="rounded-lg border bg-popover px-3 py-2 text-sm shadow-md">
      <p className="mb-1 font-medium">{formatDate(row.date)}</p>
      <div className="flex items-center gap-2">
        <span className="size-2.5 rounded-sm bg-chart-1" aria-hidden />
        <span className="text-muted-foreground">{t.dashboard.chart.amount}:</span>
        <span className="font-medium tabular-nums">{formatMoney(row.amountText)}</span>
      </div>
      <div className="mt-0.5 pl-[18px] text-muted-foreground">
        {t.dashboard.chart.count}: <span className="text-foreground tabular-nums">{row.count}</span>
      </div>
    </div>
  );
}

function TrendTable({ points }: { points: SalesTrendPoint[] }) {
  return (
    <div className="max-h-72 overflow-y-auto rounded-md border">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>{t.dashboard.chart.day}</TableHead>
            <TableHead className="text-right">{t.dashboard.chart.count}</TableHead>
            <TableHead className="text-right">{t.dashboard.chart.amount}</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {[...points].reverse().map((p) => (
            <TableRow key={p.date}>
              <TableCell>{formatDate(p.date)}</TableCell>
              <TableCell className="text-right tabular-nums">{p.count}</TableCell>
              <TableCell className="text-right tabular-nums">{formatMoney(p.amount)}</TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}

/**
 * Kunlik savdo summasi — bitta seriya, bitta o'q: chiziq (2px) + ostida och soha (dataviz qoidalari),
 * hover'da vertikal kursor va nuqta. Telefonda enidan uzun (past) — sahifa scroll'ida kam joy oladi.
 */
export function SalesChart() {
  const gradientId = `sales-fill-${useId().replace(/:/g, '')}`;
  const [days, setDays] = useState(14);
  const [view, setView] = useState<'chart' | 'table'>('chart');
  const { data, isPending, error, refetch } = useSalesTrend(days);

  const rows: ChartRow[] = (data ?? []).map((p) => ({
    date: p.date,
    amount: toChartNumber(p.amount),
    amountText: p.amount,
    count: p.count,
  }));
  const total = sumMoney((data ?? []).map((p) => p.amount));
  const count = (data ?? []).reduce((a, p) => a + p.count, 0);

  return (
    <Card className="gap-4">
      <CardHeader className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="space-y-1">
          <CardTitle>{t.dashboard.chart.title}</CardTitle>
          <CardDescription>{t.dashboard.chart.description}</CardDescription>
        </div>
        <div className="flex flex-wrap gap-2">
          <Tabs value={view} onValueChange={(v) => setView(v as 'chart' | 'table')}>
            <TabsList className="h-8">
              <TabsTrigger value="chart" className="text-xs">
                {t.dashboard.chart.chartView}
              </TabsTrigger>
              <TabsTrigger value="table" className="text-xs">
                {t.dashboard.chart.tableView}
              </TabsTrigger>
            </TabsList>
          </Tabs>
          <Tabs value={String(days)} onValueChange={(v) => setDays(Number(v))}>
            <TabsList className="h-8">
              {RANGES.map((r) => (
                <TabsTrigger key={r.days} value={String(r.days)} className="text-xs">
                  {r.label}
                </TabsTrigger>
              ))}
            </TabsList>
          </Tabs>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex flex-wrap gap-x-8 gap-y-2">
          <div>
            <p className="text-xs text-muted-foreground">{t.dashboard.chart.periodTotal}</p>
            {isPending ? (
              <Skeleton className="mt-1 h-6 w-36" />
            ) : (
              <p className="text-lg font-semibold tabular-nums sm:text-xl">{formatMoney(total)}</p>
            )}
          </div>
          <div>
            <p className="text-xs text-muted-foreground">{t.dashboard.chart.dailyAverage}</p>
            {isPending ? (
              <Skeleton className="mt-1 h-6 w-28" />
            ) : (
              <p className="text-lg font-semibold tabular-nums sm:text-xl">
                {formatCompactMoney(divideMoney(total, days))}
              </p>
            )}
          </div>
          <div>
            <p className="text-xs text-muted-foreground">{t.dashboard.chart.count}</p>
            {isPending ? (
              <Skeleton className="mt-1 h-6 w-16" />
            ) : (
              <p className="text-lg font-semibold tabular-nums sm:text-xl">
                {formatInteger(count)}
              </p>
            )}
          </div>
        </div>
        {error && !data ? (
          <ErrorState message={error.message} onRetry={() => refetch()} />
        ) : isPending ? (
          <Skeleton className="h-48 w-full sm:h-72" />
        ) : count === 0 ? (
          <div className="flex h-48 flex-col justify-center sm:h-72">
            <EmptyState icon={BarChart3} title={t.dashboard.chart.empty} />
          </div>
        ) : view === 'table' ? (
          <TrendTable points={data ?? []} />
        ) : (
          <div className="h-48 w-full sm:h-72" role="img" aria-label={t.dashboard.chart.title}>
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={rows} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
                <defs>
                  <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="var(--chart-1)" stopOpacity={0.28} />
                    <stop offset="100%" stopColor="var(--chart-1)" stopOpacity={0.02} />
                  </linearGradient>
                </defs>
                <CartesianGrid vertical={false} stroke="var(--chart-grid)" />
                <XAxis
                  dataKey="date"
                  tickFormatter={formatDayShort}
                  tickLine={false}
                  axisLine={false}
                  tick={{ fill: 'var(--chart-axis)', fontSize: 11 }}
                  interval="preserveStartEnd"
                  minTickGap={16}
                />
                <YAxis
                  tickFormatter={(v: number) =>
                    formatCompactMoney(String(Math.round(v)), { withCurrency: false })
                  }
                  tickLine={false}
                  axisLine={false}
                  width={56}
                  tick={{ fill: 'var(--chart-axis)', fontSize: 11 }}
                />
                <Tooltip
                  content={<ChartTooltip />}
                  cursor={{ stroke: 'var(--chart-axis)', strokeDasharray: '3 3' }}
                />
                <Area
                  type="monotone"
                  dataKey="amount"
                  stroke="var(--chart-1)"
                  strokeWidth={2}
                  fill={`url(#${gradientId})`}
                  dot={false}
                  activeDot={{
                    r: 5,
                    fill: 'var(--chart-1)',
                    stroke: 'var(--card)',
                    strokeWidth: 2,
                  }}
                  isAnimationActive={false}
                />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
