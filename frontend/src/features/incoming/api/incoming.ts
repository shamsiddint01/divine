import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { apiRequest, type QueryValue } from '@/shared/lib/api-client';
import type { IncomingDto, IncomingInput, Paginated } from '@/shared/types/api';

export const incomingKeys = {
  all: ['incoming'] as const,
  list: (q: Record<string, QueryValue>) => [...incomingKeys.all, 'list', q] as const,
  detail: (id: string) => [...incomingKeys.all, 'detail', id] as const,
};

export function useIncomingList(query: Record<string, QueryValue>) {
  return useQuery({
    queryKey: incomingKeys.list(query),
    queryFn: ({ signal }) => apiRequest<Paginated<IncomingDto>>('/incoming', { signal, query }),
    placeholderData: keepPreviousData,
  });
}

export function useIncoming(id: string | undefined) {
  return useQuery({
    queryKey: incomingKeys.detail(id ?? ''),
    queryFn: ({ signal }) => apiRequest<IncomingDto>(`/incoming/${id}`, { signal }),
    enabled: Boolean(id),
  });
}

function useInvalidate() {
  const qc = useQueryClient();
  return () =>
    Promise.all(
      ['incoming', 'products', 'warehouses', 'dashboard', 'reports'].map((key) =>
        qc.invalidateQueries({ queryKey: [key] }),
      ),
    );
}

export function useSaveIncoming() {
  const invalidate = useInvalidate();
  return useMutation({
    mutationFn: ({ id, input }: { id?: string; input: IncomingInput }) =>
      id
        ? apiRequest<IncomingDto>(`/incoming/${id}`, { method: 'PATCH', body: input })
        : apiRequest<IncomingDto>('/incoming', { method: 'POST', body: input }),
    onSuccess: invalidate,
  });
}

export function useIncomingAction() {
  const invalidate = useInvalidate();
  return useMutation({
    mutationFn: ({ id, action }: { id: string; action: 'confirm' | 'cancel' }) =>
      apiRequest<IncomingDto>(`/incoming/${id}/${action}`, { method: 'POST' }),
    onSuccess: invalidate,
  });
}
