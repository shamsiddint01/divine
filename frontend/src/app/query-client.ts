import { QueryClient } from '@tanstack/react-query';
import { ApiError } from '@/shared/lib/api-client';

export function createQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: {
        staleTime: 30_000,
        refetchOnWindowFocus: false,
        // 4xx xatolarda (ruxsat yo'q, topilmadi, validatsiya) qayta urinish ma'nosiz.
        retry: (failureCount, error) =>
          !(error instanceof ApiError && error.status >= 400 && error.status < 500) &&
          failureCount < 2,
      },
      mutations: {
        // Mutatsiyalar avtomatik takrorlanmaydi: sotuv kabi amallar idempotency-key bilan
        // faqat foydalanuvchi qayta bosganda yuboriladi.
        retry: false,
      },
    },
  });
}
