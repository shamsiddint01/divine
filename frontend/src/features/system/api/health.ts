import type { HealthResponse } from '@divine/shared';
import { useQuery } from '@tanstack/react-query';
import { apiRequest } from '@/shared/lib/api-client';

export const healthKeys = {
  all: ['system', 'health'] as const,
};

/** `GET /health` — 503 (degraded) ham to'g'ri javob sifatida qabul qilinadi. */
export function fetchHealth(signal?: AbortSignal): Promise<HealthResponse> {
  return apiRequest<HealthResponse>('/health', { signal, acceptStatuses: [503] });
}

export function useHealthQuery() {
  return useQuery({
    queryKey: healthKeys.all,
    queryFn: ({ signal }) => fetchHealth(signal),
    refetchInterval: 60_000,
    retry: false,
  });
}
