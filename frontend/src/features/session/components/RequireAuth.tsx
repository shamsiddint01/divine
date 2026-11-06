import { useQueryClient } from '@tanstack/react-query';
import { Loader2 } from 'lucide-react';
import { type ReactNode, useEffect } from 'react';
import { Navigate, useLocation } from 'react-router';
import { t } from '@/i18n/uz';
import { authSession } from '@/shared/lib/auth-session';
import { bootstrapSession, SESSION_KEY } from '../api/session';
import { useAuthStore } from '../auth-store';

export function SessionLoader() {
  return (
    <div
      className="flex min-h-svh items-center justify-center bg-background"
      role="status"
      aria-live="polite"
    >
      <div className="flex items-center gap-3 text-sm text-muted-foreground">
        <Loader2 className="size-5 animate-spin text-primary" aria-hidden />
        {t.auth.checking}
      </div>
    </div>
  );
}

/**
 * Himoyalangan qism (RBAC §5): sessiya tekshirilmaguncha hech narsa ko'rsatilmaydi; anonim bo'lsa —
 * `/welcome?redirect=…` (u yerdan "Kirish" → `/login?redirect=…`). Sessiya tugasa (refresh ham o'tmadi) — login sahifasi "sessiya tugadi" xabari bilan.
 * 403 bo'lsa — permissionlar eskirgan bo'lishi mumkin: `/auth/me` qayta yuklanadi.
 */
export function RequireAuth({ children }: { children: ReactNode }) {
  const status = useAuthStore((s) => s.status);
  const reason = useAuthStore((s) => s.reason);
  const queryClient = useQueryClient();
  const location = useLocation();

  useEffect(() => {
    if (useAuthStore.getState().status === 'checking') void bootstrapSession(queryClient);
  }, [queryClient]);

  useEffect(() => {
    const offExpired = authSession.onExpired(() => {
      queryClient.clear();
      useAuthStore.getState().setStatus('anonymous', 'expired');
    });
    const offForbidden = authSession.onForbidden(() => {
      void queryClient.invalidateQueries({ queryKey: SESSION_KEY });
    });
    return () => {
      offExpired();
      offForbidden();
    };
  }, [queryClient]);

  if (status === 'checking') return <SessionLoader />;
  if (status === 'anonymous') {
    // O'zi chiqqan userning sahifasi keyingi kirgan odamga (boshqa user bo'lishi mumkin) qaytarilmaydi.
    if (reason === 'signedOut') return <Navigate to="/login" replace />;
    const redirect = `${location.pathname}${location.search}`;
    const query = redirect === '/' ? '' : `?redirect=${encodeURIComponent(redirect)}`;
    // Aloqa uzilgan user — to'g'ridan-to'g'ri qayta kirishga (xabar bilan); mehmon va sessiyasi tugagan
    // user — avval tanishtiruv sahifasiga, u yerdan "Kirish" (redirect saqlanadi).
    const target = reason === 'offline' ? '/login' : '/welcome';
    return <Navigate to={`${target}${query}`} replace />;
  }
  return children;
}
