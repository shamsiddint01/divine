import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { apiRequest, type QueryValue } from '@/shared/lib/api-client';
import type {
  CustomerDto,
  CustomerInput,
  CustomerPurchasesResponse,
  Paginated,
} from '@/shared/types/api';

export const customerKeys = {
  all: ['customers'] as const,
  list: (q: Record<string, QueryValue>) => [...customerKeys.all, 'list', q] as const,
  detail: (id: string) => [...customerKeys.all, 'detail', id] as const,
  purchases: (id: string, q: Record<string, QueryValue>) =>
    [...customerKeys.all, 'purchases', id, q] as const,
};

export function useCustomers(query: Record<string, QueryValue>, enabled = true) {
  return useQuery({
    queryKey: customerKeys.list(query),
    queryFn: ({ signal }) => apiRequest<Paginated<CustomerDto>>('/customers', { signal, query }),
    placeholderData: keepPreviousData,
    enabled,
  });
}

export function useCustomer(id: string) {
  return useQuery({
    queryKey: customerKeys.detail(id),
    queryFn: ({ signal }) => apiRequest<CustomerDto>(`/customers/${id}`, { signal }),
  });
}

export function useCustomerPurchases(id: string, query: Record<string, QueryValue>) {
  return useQuery({
    queryKey: customerKeys.purchases(id, query),
    queryFn: ({ signal }) =>
      apiRequest<CustomerPurchasesResponse>(`/customers/${id}/purchases`, { signal, query }),
    placeholderData: keepPreviousData,
  });
}

export function useSaveCustomer() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, input }: { id?: string; input: CustomerInput }) =>
      id
        ? apiRequest<CustomerDto>(`/customers/${id}`, { method: 'PATCH', body: input })
        : apiRequest<CustomerDto>('/customers', { method: 'POST', body: input }),
    onSuccess: () => qc.invalidateQueries({ queryKey: customerKeys.all }),
  });
}
