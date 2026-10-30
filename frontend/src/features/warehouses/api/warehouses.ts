import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { WarehouseStatus } from '@divine/shared';
import { apiRequest, type QueryValue } from '@/shared/lib/api-client';
import type {
  MovementDto,
  Paginated,
  StockRowDto,
  WarehouseDetailDto,
  WarehouseDto,
  WarehouseInput,
  WarehouseListItemDto,
} from '@/shared/types/api';

export const warehouseKeys = {
  all: ['warehouses'] as const,
  options: () => [...warehouseKeys.all, 'options'] as const,
  list: (q: Record<string, QueryValue>) => [...warehouseKeys.all, 'list', q] as const,
  detail: (id: string) => [...warehouseKeys.all, 'detail', id] as const,
  stock: (id: string, q: Record<string, QueryValue>) =>
    [...warehouseKeys.all, 'stock', id, q] as const,
  movements: (id: string, q: Record<string, QueryValue>) =>
    [...warehouseKeys.all, 'movements', id, q] as const,
};

/** Filtr va tanlovlar uchun omborlar (USER — faqat biriktirilgan ACTIVE omborlar, OWN-01). */
export function useWarehouses() {
  return useQuery({
    queryKey: warehouseKeys.options(),
    queryFn: ({ signal }) =>
      apiRequest<Paginated<WarehouseListItemDto>>('/warehouses', {
        signal,
        query: { pageSize: 100 },
      }),
    select: (res) => res.data,
  });
}

/** Ombor sahifasi: qidiruv va holat filtri bilan (server tomonda). */
export function useWarehouseList(query: Record<string, QueryValue>) {
  return useQuery({
    queryKey: warehouseKeys.list(query),
    queryFn: ({ signal }) =>
      apiRequest<Paginated<WarehouseListItemDto>>('/warehouses', { signal, query }),
    placeholderData: keepPreviousData,
  });
}

export function useWarehouse(id: string) {
  return useQuery({
    queryKey: warehouseKeys.detail(id),
    queryFn: ({ signal }) => apiRequest<WarehouseDetailDto>(`/warehouses/${id}`, { signal }),
  });
}

export function useWarehouseStock(id: string, query: Record<string, QueryValue>) {
  return useQuery({
    queryKey: warehouseKeys.stock(id, query),
    queryFn: ({ signal }) =>
      apiRequest<Paginated<StockRowDto>>(`/warehouses/${id}/stock`, { signal, query }),
    placeholderData: keepPreviousData,
  });
}

export function useWarehouseMovements(id: string, query: Record<string, QueryValue>) {
  return useQuery({
    queryKey: warehouseKeys.movements(id, query),
    queryFn: ({ signal }) =>
      apiRequest<Paginated<MovementDto>>(`/warehouses/${id}/movements`, { signal, query }),
    placeholderData: keepPreviousData,
  });
}

/** Ombor o'zgarsa — user formasidagi ombor tanlovi ham yangilanadi (`/users/warehouse-options`). */
function useInvalidateWarehouses() {
  const qc = useQueryClient();
  return () =>
    Promise.all([
      qc.invalidateQueries({ queryKey: warehouseKeys.all }),
      qc.invalidateQueries({ queryKey: ['users', 'warehouse-options'] }),
    ]);
}

export function useSaveWarehouse() {
  const invalidate = useInvalidateWarehouses();
  return useMutation({
    mutationFn: ({ id, input }: { id?: string; input: WarehouseInput }) =>
      id
        ? apiRequest<WarehouseDto>(`/warehouses/${id}`, { method: 'PATCH', body: input })
        : apiRequest<WarehouseDto>('/warehouses', { method: 'POST', body: input }),
    onSuccess: invalidate,
  });
}

export function useSetWarehouseStatus() {
  const invalidate = useInvalidateWarehouses();
  return useMutation({
    mutationFn: ({ id, status }: { id: string; status: WarehouseStatus }) =>
      apiRequest<WarehouseDto>(`/warehouses/${id}/status`, { method: 'PATCH', body: { status } }),
    onSuccess: invalidate,
  });
}
