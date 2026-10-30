import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { apiRequest, type QueryValue } from '@/shared/lib/api-client';
import type { Paginated, ProductGroupDto, ProductGroupInput } from '@/shared/types/api';

export const groupKeys = {
  all: ['product-groups'] as const,
  list: (q: Record<string, QueryValue>) => [...groupKeys.all, 'list', q] as const,
  options: () => [...groupKeys.all, 'options'] as const,
};

export function useGroups(query: Record<string, QueryValue>) {
  return useQuery({
    queryKey: groupKeys.list(query),
    queryFn: ({ signal }) =>
      apiRequest<Paginated<ProductGroupDto>>('/product-groups', { signal, query }),
    placeholderData: keepPreviousData,
  });
}

/** Filtr va formalardagi tanlov ro'yxati uchun guruhlar. */
export function useGroupOptions() {
  return useQuery({
    queryKey: groupKeys.options(),
    queryFn: ({ signal }) =>
      apiRequest<Paginated<ProductGroupDto>>('/product-groups', {
        signal,
        query: { pageSize: 100, sort: 'name:asc' },
      }),
    select: (res) => res.data,
    staleTime: 60_000,
  });
}

function useInvalidate() {
  const qc = useQueryClient();
  return () =>
    Promise.all([
      qc.invalidateQueries({ queryKey: groupKeys.all }),
      qc.invalidateQueries({ queryKey: ['products'] }),
    ]);
}

export function useSaveGroup() {
  const invalidate = useInvalidate();
  return useMutation({
    mutationFn: ({ id, input }: { id?: string; input: ProductGroupInput }) =>
      id
        ? apiRequest<ProductGroupDto>(`/product-groups/${id}`, { method: 'PATCH', body: input })
        : apiRequest<ProductGroupDto>('/product-groups', { method: 'POST', body: input }),
    onSuccess: invalidate,
  });
}

export function useDeleteGroup() {
  const invalidate = useInvalidate();
  return useMutation({
    mutationFn: (id: string) => apiRequest<void>(`/product-groups/${id}`, { method: 'DELETE' }),
    onSuccess: invalidate,
  });
}
