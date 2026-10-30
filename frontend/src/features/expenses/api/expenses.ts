import {
  keepPreviousData,
  type QueryClient,
  useMutation,
  useQuery,
  useQueryClient,
} from '@tanstack/react-query';
import { apiRequest, type QueryValue } from '@/shared/lib/api-client';
import type {
  ExpenseCategoryDto,
  ExpenseDto,
  ExpenseInput,
  ExpensesListResponse,
} from '@/shared/types/api';

export const expenseKeys = {
  all: ['expenses'] as const,
  list: (q: Record<string, QueryValue>) => [...expenseKeys.all, 'list', q] as const,
  categories: () => [...expenseKeys.all, 'categories'] as const,
};

export function useExpenses(query: Record<string, QueryValue>) {
  return useQuery({
    queryKey: expenseKeys.list(query),
    queryFn: ({ signal }) => apiRequest<ExpensesListResponse>('/expenses', { signal, query }),
    placeholderData: keepPreviousData,
  });
}

/**
 * Kategoriyalar (D-19). Admin — hammasi (faol va nofaol, xarajatlar soni bilan); sotuvchi — server
 * faqat faollarini `id, name` bilan qaytaradi.
 */
export function useExpenseCategories() {
  return useQuery({
    queryKey: expenseKeys.categories(),
    queryFn: ({ signal }) => apiRequest<ExpenseCategoryDto[]>('/expense-categories', { signal }),
    staleTime: 60_000,
  });
}

/** Xarajatlar, kategoriya nomlari — xarajatlar hisoboti va moliyaviy xulosada ham (Phase 12). */
function invalidateExpenses(qc: QueryClient) {
  return Promise.all([
    qc.invalidateQueries({ queryKey: expenseKeys.all }),
    qc.invalidateQueries({ queryKey: ['reports'] }),
  ]);
}

export function useSaveExpense() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, input }: { id?: string; input: ExpenseInput }) =>
      id
        ? apiRequest<ExpenseDto>(`/expenses/${id}`, { method: 'PATCH', body: input })
        : apiRequest<ExpenseDto>('/expenses', { method: 'POST', body: input }),
    onSuccess: () => invalidateExpenses(qc),
  });
}

export function useDeleteExpense() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => apiRequest<void>(`/expenses/${id}`, { method: 'DELETE' }),
    onSuccess: () => invalidateExpenses(qc),
  });
}

export function useSaveExpenseCategory() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, input }: { id?: string; input: { name?: string; isActive?: boolean } }) =>
      id
        ? apiRequest<ExpenseCategoryDto>(`/expense-categories/${id}`, {
            method: 'PATCH',
            body: input,
          })
        : apiRequest<ExpenseCategoryDto>('/expense-categories', { method: 'POST', body: input }),
    // Kategoriya nomi xarajatlar ro'yxatida ham ko'rinadi.
    onSuccess: () => invalidateExpenses(qc),
  });
}

export function useDeleteExpenseCategory() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => apiRequest<void>(`/expense-categories/${id}`, { method: 'DELETE' }),
    onSuccess: () => qc.invalidateQueries({ queryKey: expenseKeys.categories() }),
  });
}
