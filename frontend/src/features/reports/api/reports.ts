import { REPORT_PATHS } from '@divine/shared';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { apiRequest, type QueryValue } from '@/shared/lib/api-client';
import type { FinanceSummaryDto, ReportResponse, ReportType } from '@/shared/types/api';

export function useReport(type: ReportType, query: Record<string, QueryValue>, enabled = true) {
  return useQuery({
    queryKey: ['reports', type, query],
    queryFn: ({ signal }) =>
      apiRequest<ReportResponse>(`/reports/${REPORT_PATHS[type]}`, { signal, query }),
    placeholderData: keepPreviousData,
    enabled,
  });
}

/** Moliyaviy xulosa (API §13, D-21): ombor tanlansa `expenses` va `netProfit` — `null`. */
export function useFinanceSummary(query: Record<string, QueryValue>, enabled = true) {
  return useQuery({
    queryKey: ['reports', 'finance', query],
    queryFn: ({ signal }) =>
      apiRequest<FinanceSummaryDto>('/reports/finance-summary', { signal, query }),
    placeholderData: keepPreviousData,
    enabled,
  });
}
