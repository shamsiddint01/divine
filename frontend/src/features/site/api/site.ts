import type { SiteAccessRequestDto, SiteLicenseDto } from '@divine/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { apiRequest } from '@/shared/lib/api-client';
import { apiMode } from '@/shared/lib/api-mode';

const ACCESS_KEY = ['site', 'access-request'] as const;
/** Superadmin kod so'raganda admin tez ko'rishi uchun. */
const ACCESS_POLL_MS = 20_000;

export function useSiteLicense() {
  return useQuery({
    queryKey: ['site', 'license'],
    queryFn: ({ signal }) => apiRequest<SiteLicenseDto | null>('/site/license', { signal }),
    enabled: apiMode === 'http',
    staleTime: 5 * 60_000,
  });
}

export function useSiteAccessRequest(enabled: boolean) {
  return useQuery({
    queryKey: ACCESS_KEY,
    queryFn: ({ signal }) =>
      apiRequest<SiteAccessRequestDto | null>('/site/access-request', { signal }),
    enabled: enabled && apiMode === 'http',
    refetchInterval: ACCESS_POLL_MS,
  });
}

export function useDenySiteAccess() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) =>
      apiRequest<void>(`/site/access-request/${id}`, { method: 'DELETE' }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ACCESS_KEY }),
  });
}
