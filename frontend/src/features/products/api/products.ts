import {
  keepPreviousData,
  useMutation,
  useQueries,
  useQuery,
  useQueryClient,
} from '@tanstack/react-query';
import type { ProductStatus } from '@divine/shared';
import { apiRequest, type QueryValue } from '@/shared/lib/api-client';
import type {
  Paginated,
  ProductDto,
  ProductInput,
  ProductSummaryDto,
  StockReceiptInput,
} from '@/shared/types/api';

export const productKeys = {
  all: ['products'] as const,
  list: (q: Record<string, QueryValue>) => [...productKeys.all, 'list', q] as const,
  detail: (id: string) => [...productKeys.all, 'detail', id] as const,
  summary: (id: string) => [...productKeys.all, 'summary', id] as const,
};

export function useProducts(
  query: Record<string, QueryValue>,
  options: { enabled?: boolean } = {},
) {
  return useQuery({
    queryKey: productKeys.list(query),
    queryFn: ({ signal }) => apiRequest<Paginated<ProductDto>>('/products', { signal, query }),
    placeholderData: keepPreviousData,
    enabled: options.enabled ?? true,
  });
}

/** Bitta mahsulot (masalan, tanlov maydonida tanlangan mahsulot nomini ko'rsatish uchun). */
export function useProduct(id: string | null) {
  return useQuery({
    queryKey: productKeys.detail(id ?? ''),
    queryFn: ({ signal }) => apiRequest<ProductDto>(`/products/${id}`, { signal }),
    enabled: Boolean(id),
    staleTime: 30_000,
  });
}

/** Bir nechta mahsulot ID bo'yicha (kirim qatorlari): `Map<id, ProductDto>`. Kesh `useProduct` bilan umumiy. */
export function useProductsById(ids: string[]) {
  const unique = [...new Set(ids.filter(Boolean))];
  return useQueries({
    queries: unique.map((id) => ({
      queryKey: productKeys.detail(id),
      queryFn: ({ signal }: { signal: AbortSignal }) =>
        apiRequest<ProductDto>(`/products/${id}`, { signal }),
      staleTime: 30_000,
    })),
    combine: (results) =>
      new Map(results.flatMap((r) => (r.data ? [[r.data.id, r.data] as const] : []))),
  });
}

/** Tanlangan mahsulotni keshga yozish — nomi/birligi qayta so'rovsiz darhol ko'rinadi. */
export function useRememberProduct() {
  const qc = useQueryClient();
  return (product: ProductDto) => qc.setQueryData(productKeys.detail(product.id), product);
}

export function useProductSummary(id: string | null) {
  return useQuery({
    queryKey: productKeys.summary(id ?? ''),
    queryFn: ({ signal }) => apiRequest<ProductSummaryDto>(`/products/${id}/summary`, { signal }),
    enabled: Boolean(id),
  });
}

export function lookupByBarcode(barcode: string, warehouseId?: string) {
  return apiRequest<ProductDto>('/products/lookup', { query: { barcode, warehouseId } });
}

function useInvalidate() {
  const qc = useQueryClient();
  return () =>
    Promise.all([
      qc.invalidateQueries({ queryKey: productKeys.all }),
      qc.invalidateQueries({ queryKey: ['product-groups'] }),
      qc.invalidateQueries({ queryKey: ['dashboard'] }),
      // Qoldiq qo'shilishi omborlar, harakatlar va hisobotlarga ham ta'sir qiladi.
      qc.invalidateQueries({ queryKey: ['warehouses'] }),
      qc.invalidateQueries({ queryKey: ['reports'] }),
    ]);
}

/** Mavjud mahsulotga qoldiq (sobiq "Kirim"): `POST /products/:id/stock`. */
export function useAddStock() {
  const invalidate = useInvalidate();
  return useMutation({
    mutationFn: ({ id, input }: { id: string; input: StockReceiptInput }) =>
      apiRequest<ProductDto>(`/products/${id}/stock`, { method: 'POST', body: input }),
    onSuccess: invalidate,
  });
}

export function useSaveProduct() {
  const invalidate = useInvalidate();
  return useMutation({
    mutationFn: ({ id, input }: { id?: string; input: ProductInput }) =>
      id
        ? apiRequest<ProductDto>(`/products/${id}`, { method: 'PATCH', body: input })
        : apiRequest<ProductDto>('/products', { method: 'POST', body: input }),
    onSuccess: invalidate,
  });
}

export function useSetProductStatus() {
  const invalidate = useInvalidate();
  return useMutation({
    mutationFn: ({ id, status }: { id: string; status: ProductStatus }) =>
      apiRequest<ProductDto>(`/products/${id}/status`, { method: 'PATCH', body: { status } }),
    onSuccess: invalidate,
  });
}
