import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { IDEMPOTENCY_HEADER } from '@divine/shared';
import { apiRequest, type QueryValue } from '@/shared/lib/api-client';
import type { CreateSaleInput, SaleDto, SalesListResponse } from '@/shared/types/api';

export const saleKeys = {
  all: ['sales'] as const,
  list: (q: Record<string, QueryValue>) => [...saleKeys.all, 'list', q] as const,
  detail: (id: string) => [...saleKeys.all, 'detail', id] as const,
};

export function useSales(query: Record<string, QueryValue>) {
  return useQuery({
    queryKey: saleKeys.list(query),
    queryFn: ({ signal }) => apiRequest<SalesListResponse>('/sales', { signal, query }),
    placeholderData: keepPreviousData,
  });
}

export function useSale(id: string | null) {
  return useQuery({
    queryKey: saleKeys.detail(id ?? ''),
    queryFn: ({ signal }) => apiRequest<SaleDto>(`/sales/${id}`, { signal }),
    enabled: Boolean(id),
  });
}

/**
 * Sotuvni yaratish. `idempotencyKey` sotuv formasi ochilganda yaratiladi va qayta urinishda
 * o'zgarmaydi — tarmoq xatosidan keyin takroriy bosish ikkinchi sotuv yaratmaydi (REQ-145).
 */
export function useCreateSale() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ input, idempotencyKey }: { input: CreateSaleInput; idempotencyKey: string }) =>
      apiRequest<SaleDto>('/sales', {
        method: 'POST',
        body: input,
        headers: { [IDEMPOTENCY_HEADER]: idempotencyKey },
      }),
    onSuccess: () =>
      Promise.all(
        ['sales', 'products', 'warehouses', 'dashboard', 'customers', 'reports', 'credits'].map((key) =>
          qc.invalidateQueries({ queryKey: [key] }),
        ),
      ),
  });
}
