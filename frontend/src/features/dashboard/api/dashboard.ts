import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { apiRequest } from '@/shared/lib/api-client';
import type {
  DashboardSummaryDto,
  MyDashboardSummaryDto,
  SalesTrendPoint,
  TopProductDto,
} from '@/shared/types/api';

export const dashboardKeys = {
  all: ['dashboard'] as const,
  summary: () => [...dashboardKeys.all, 'summary'] as const,
  my: () => [...dashboardKeys.all, 'my'] as const,
  trend: (days: number) => [...dashboardKeys.all, 'trend', days] as const,
  top: (days: number) => [...dashboardKeys.all, 'top', days] as const,
};

export function useDashboardSummary() {
  return useQuery({
    queryKey: dashboardKeys.summary(),
    queryFn: ({ signal }) => apiRequest<DashboardSummaryDto>('/dashboard/summary', { signal }),
    refetchInterval: 60_000,
  });
}

/** Sotuvchi: faqat o'zining bugungi ko'rsatkichlari va omborlari (`dashboard.own`, OWN-08). */
export function useMyDashboardSummary() {
  return useQuery({
    queryKey: dashboardKeys.my(),
    queryFn: ({ signal }) => apiRequest<MyDashboardSummaryDto>('/dashboard/my-summary', { signal }),
    refetchInterval: 60_000,
  });
}

export function useSalesTrend(days: number) {
  return useQuery({
    queryKey: dashboardKeys.trend(days),
    queryFn: ({ signal }) =>
      apiRequest<SalesTrendPoint[]>('/dashboard/sales-trend', { signal, query: { days } }),
    placeholderData: keepPreviousData,
  });
}

export function useTopProducts(days = 30) {
  return useQuery({
    queryKey: dashboardKeys.top(days),
    queryFn: ({ signal }) =>
      apiRequest<TopProductDto[]>('/dashboard/top-products', { signal, query: { days, limit: 5 } }),
  });
}
