import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { CreditDetailDto, CreditReminderDto, CreditsListResponse } from '@divine/shared';
import { apiRequest, type QueryValue } from '@/shared/lib/api-client';

export const creditKeys = {
  all: ['credits'] as const,
  list: (q: Record<string, QueryValue>) => [...creditKeys.all, 'list', q] as const,
  detail: (id: string) => [...creditKeys.all, 'detail', id] as const,
  reminders: () => [...creditKeys.all, 'reminders'] as const,
};

export interface CreditInput {
  debtorName: string;
  debtorPhone?: string;
  amount: string;
  takenAt: string;
  firstDueDate: string;
  installments: number;
  intervalDays: number;
  note?: string | null;
}

export function useCredits(query: Record<string, QueryValue>) {
  return useQuery({
    queryKey: creditKeys.list(query),
    queryFn: ({ signal }) => apiRequest<CreditsListResponse>('/credits', { signal, query }),
    placeholderData: keepPreviousData,
  });
}

export function useCredit(id: string | null) {
  return useQuery({
    queryKey: creditKeys.detail(id ?? ''),
    queryFn: ({ signal }) => apiRequest<CreditDetailDto>(`/credits/${id}`, { signal }),
    enabled: Boolean(id),
  });
}

/** Ertaga to'lovi borlar (qo'ng'iroqcha va sahifa tepasi). */
export function useCreditReminders(enabled = true) {
  return useQuery({
    queryKey: creditKeys.reminders(),
    queryFn: ({ signal }) => apiRequest<CreditReminderDto[]>('/credits/reminders', { signal }),
    enabled,
    staleTime: 60_000,
  });
}

export function useCreateCredit() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: CreditInput) =>
      apiRequest<CreditDetailDto>('/credits', { method: 'POST', body: input }),
    onSuccess: () => qc.invalidateQueries({ queryKey: creditKeys.all }),
  });
}

export function useAddCreditPayment() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({
      id,
      input,
    }: {
      id: string;
      input: { amount: string; date: string; note?: string | null };
    }) => apiRequest<CreditDetailDto>(`/credits/${id}/payments`, { method: 'POST', body: input }),
    onSuccess: () => qc.invalidateQueries({ queryKey: creditKeys.all }),
  });
}
