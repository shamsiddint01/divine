import type { LoginRequest, LoginResponse } from '@divine/shared';
import { type QueryClient, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { apiRequest, isServerUnavailable, refreshSession } from '@/shared/lib/api-client';
import { authMode } from '@/shared/lib/api-mode';
import { authSession } from '@/shared/lib/auth-session';
import { readViewToken } from '@/shared/lib/view-session';
import { playSplash } from '@/shared/lib/splash';
import type { CurrentUserDto } from '@/shared/types/api';
import { useAuthStore } from '../auth-store';

export const SESSION_KEY = ['session', 'me'] as const;

/** Joriy user (`GET /auth/me`) — faqat autentifikatsiyadan keyin; login/refresh javobi keshga yoziladi. */
export function useCurrentUser() {
  const status = useAuthStore((s) => s.status);
  return useQuery({
    queryKey: SESSION_KEY,
    queryFn: ({ signal }) => apiRequest<CurrentUserDto>('/auth/me', { signal }),
    enabled: status === 'authenticated',
    staleTime: 5 * 60_000,
  });
}

function applySession(queryClient: QueryClient, session: LoginResponse): void {
  authSession.setToken(session.accessToken);
  queryClient.setQueryData(SESSION_KEY, session.user);
  useAuthStore.getState().setStatus('authenticated');
}

/**
 * Ilova ochilganda sessiyani tiklash:
 * - `http`: HttpOnly refresh cookie bilan `POST /auth/refresh` (access token xotirada bo'lmagani uchun);
 * - `mock`: mock sessiya (`GET /auth/me`).
 * Server ishlamasa — anonim holat va login sahifasida "server bilan aloqa yo'q".
 */
export async function bootstrapSession(queryClient: QueryClient): Promise<void> {
  const { setStatus } = useAuthStore.getState();
  try {
    if (authMode === 'http') {
      const viewToken = readViewToken();
      if (viewToken) {
        authSession.setToken(viewToken);
        queryClient.setQueryData(SESSION_KEY, await apiRequest<CurrentUserDto>('/auth/me'));
        setStatus('authenticated');
        return;
      }
      const session = await refreshSession();
      if (session) applySession(queryClient, session);
      else setStatus('anonymous');
      return;
    }
    const user = await apiRequest<CurrentUserDto>('/auth/me');
    queryClient.setQueryData(SESSION_KEY, user);
    setStatus('authenticated');
  } catch (error) {
    setStatus('anonymous', isServerUnavailable(error) ? 'offline' : null);
  }
}

export function useLogin() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: LoginRequest) =>
      apiRequest<LoginResponse>('/auth/login', { method: 'POST', body: input }),
    onSuccess: (session) => {
      // Kirgandan keyin logotip animatsiyasi (2026-11-03). Hook darajasida: sessiya qo'llangach LoginPage
      // darhol yopiladi va `mutate(…, { onSuccess })` chaqiruvi endi ishga tushmaydi (haqiqiy backend'da).
      playSplash();
      return applySession(queryClient, session);
    },
  });
}

/** Chiqish: server sessiyasi bekor qilinadi; xato bo'lsa ham lokal holat tozalanadi. */
export function useLogout() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: () => apiRequest<void>('/auth/logout', { method: 'POST' }).catch(() => undefined),
    onSettled: () => {
      authSession.setToken(null);
      useAuthStore.getState().setStatus('anonymous', 'signedOut');
      queryClient.clear();
    },
  });
}
