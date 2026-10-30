import { keepPreviousData, useInfiniteQuery } from '@tanstack/react-query';
import { apiRequest, type QueryValue } from '@/shared/lib/api-client';
import type { AuditLogPage } from '@/shared/types/api';

export const auditKeys = {
  all: ['audit'] as const,
  list: (filters: Record<string, QueryValue>) => [...auditKeys.all, 'list', filters] as const,
};

/** Audit jurnali (API §15): cursor pagination — "Yana yuklash" keyingi sahifani qo'shadi. */
export function useAuditLogs(filters: Record<string, QueryValue>) {
  return useInfiniteQuery({
    queryKey: auditKeys.list(filters),
    queryFn: ({ signal, pageParam }) =>
      apiRequest<AuditLogPage>('/audit-logs', {
        signal,
        query: { ...filters, ...(pageParam ? { cursor: pageParam } : {}) },
      }),
    initialPageParam: '',
    getNextPageParam: (last) => last.nextCursor ?? undefined,
    placeholderData: keepPreviousData,
  });
}
