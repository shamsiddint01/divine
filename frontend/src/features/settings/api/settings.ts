import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { apiRequest } from '@/shared/lib/api-client';
import type { SettingsDto } from '@/shared/types/api';

export function useSettings() {
  return useQuery({
    queryKey: ['settings'],
    queryFn: ({ signal }) => apiRequest<SettingsDto>('/settings', { signal }),
  });
}

export function useSaveSettings() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: Partial<SettingsDto>) =>
      apiRequest<SettingsDto>('/settings', { method: 'PATCH', body: input }),
    onSuccess: (data) => {
      qc.setQueryData(['settings'], data);
      // Kam qoldiq chegarasi dashboard, mahsulot, ombor va hisobotlarda darhol qo'llanadi.
      void qc.invalidateQueries({ predicate: (q) => q.queryKey[0] !== 'settings' });
    },
  });
}

/** Faqat mock rejim: demo ma'lumotlarni qayta yuklash. */
export function useResetDemo() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => apiRequest<void>('/__demo/reset', { method: 'POST' }),
    onSuccess: () => qc.invalidateQueries(),
  });
}
