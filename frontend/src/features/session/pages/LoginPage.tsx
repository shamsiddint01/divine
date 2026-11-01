import { zodResolver } from '@/shared/forms/zod';
import { type LoginRequest, loginRequestSchema } from '@divine/shared';
import { useQueryClient } from '@tanstack/react-query';
import { AlertCircle, Eye, EyeOff, Info, Loader2, LogIn, ShieldCheck, WifiOff } from 'lucide-react';
import { useEffect, useState } from 'react';
import { useForm } from 'react-hook-form';
import { Navigate, useSearchParams } from 'react-router';
import { MOCK_DEMO_PASSWORD } from '@/mocks/handlers/auth.constants';
import { t } from '@/i18n/uz';
import { FormField } from '@/shared/components/FormField';
import { ApiError } from '@/shared/lib/api-client';
import { authMode } from '@/shared/lib/api-mode';
import { applyFieldErrors } from '@/shared/lib/mutation';
import { cn } from '@/shared/lib/utils';
import { Button } from '@/shared/ui/button';
import { Card, CardContent } from '@/shared/ui/card';
import { Input } from '@/shared/ui/input';
import { bootstrapSession, useLogin } from '../api/session';
import { useAuthStore } from '../auth-store';
import { SessionLoader } from '../components/RequireAuth';
import { safeRedirect } from '../lib/safe-redirect';

/** Server xatosi → foydalanuvchi uchun xabar (SECURITY §4: lock xabari login mavjudligini oshkor qilmaydi). */
function errorMessage(error: unknown): string {
  if (!(error instanceof ApiError)) return t.errors.unexpected;
  if (error.code === 'NETWORK_ERROR') return t.errors.network;
  if (error.code === 'ACCOUNT_LOCKED' && error.retryAfterSeconds) {
    return t.auth.lockedFor(Math.max(1, Math.ceil(error.retryAfterSeconds / 60)));
  }
  if (error.code === 'RATE_LIMITED' && error.retryAfterSeconds) {
    return t.auth.rateLimitedFor(error.retryAfterSeconds);
  }
  return error.message;
}

function Notice({
  tone,
  icon: Icon,
  children,
}: {
  tone: 'error' | 'info';
  icon: typeof Info;
  children: string;
}) {
  return (
    <div
      role={tone === 'error' ? 'alert' : 'status'}
      className={cn(
        'flex items-start gap-2.5 rounded-lg border px-3 py-2.5 text-sm',
        tone === 'error'
          ? 'border-destructive/30 bg-destructive/5 text-destructive'
          : 'border-info/30 bg-info/5 text-foreground',
      )}
    >
      <Icon className="mt-0.5 size-4 shrink-0" aria-hidden />
      <p>{children}</p>
    </div>
  );
}

/** `/login` (REQ-027): login + 6 xonali parol. Muvaffaqiyatli kirishdan keyin `redirect` (yoki bosh sahifa). */
export function LoginPage() {
  const status = useAuthStore((s) => s.status);
  const reason = useAuthStore((s) => s.reason);
  const queryClient = useQueryClient();
  const [params] = useSearchParams();
  const [showPassword, setShowPassword] = useState(false);
  const login = useLogin();
  const form = useForm<LoginRequest>({
    resolver: zodResolver(loginRequestSchema),
    defaultValues: { login: '', password: '' },
  });
  const { register, handleSubmit, setError, setValue, setFocus, formState } = form;

  // To'g'ridan-to'g'ri /login ochilganda ham mavjud sessiya (refresh cookie) tekshiriladi.
  useEffect(() => {
    const { status: current, reason: why, setStatus } = useAuthStore.getState();
    if (current === 'checking') void bootstrapSession(queryClient);
    // "O'zi chiqdi" belgisi faqat chiqish paytidagi redirect'ni bekor qilish uchun; keyin oddiy holat.
    else if (why === 'signedOut') setStatus('anonymous');
  }, [queryClient]);

  if (status === 'checking') return <SessionLoader />;
  if (status === 'authenticated')
    return <Navigate to={safeRedirect(params.get('redirect'))} replace />;

  const onSubmit = handleSubmit((values) =>
    login.mutate(values, {
      onError: (error) => {
        if (applyFieldErrors(error, setError)) return;
        if (error instanceof ApiError && error.code === 'INVALID_CREDENTIALS') {
          setValue('password', '');
          setFocus('password');
        }
      },
    }),
  );

  const serverError =
    login.isError && !(login.error instanceof ApiError && login.error.details.length > 0);

  return (
    <main className="grid min-h-svh bg-muted/40 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.1fr)]">
      <section
        aria-hidden
        className="relative hidden overflow-hidden bg-primary text-primary-foreground lg:flex lg:flex-col lg:justify-between lg:p-12"
      >
        <div className="flex items-center gap-3">
          <div className="flex size-10 items-center justify-center rounded-xl bg-primary-foreground/15 text-lg font-bold">
            {t.app.name.charAt(0)}
          </div>
          <span className="text-lg font-semibold">{t.app.name}</span>
        </div>
        <div className="max-w-md space-y-4">
          <p className="text-3xl leading-tight font-semibold">{t.app.tagline}</p>
          <p className="text-primary-foreground/80">{t.auth.subtitle}</p>
        </div>
        <p className="flex items-center gap-2 text-sm text-primary-foreground/70">
          <ShieldCheck className="size-4" />
          {t.app.version}
        </p>
      </section>

      <section className="flex items-center justify-center px-4 py-10 sm:px-6">
        <div className="w-full max-w-sm space-y-6">
          <div className="space-y-2 text-center lg:text-left">
            <div className="mx-auto flex size-11 items-center justify-center rounded-xl bg-primary text-lg font-bold text-primary-foreground shadow-sm lg:hidden">
              {t.app.name.charAt(0)}
            </div>
            <h1 className="text-xl font-semibold tracking-tight sm:text-2xl">{t.auth.title}</h1>
            <p className="text-sm text-muted-foreground">{t.auth.subtitle}</p>
          </div>

          <Card className="shadow-sm">
            <CardContent className="space-y-5 p-5 sm:p-6">
              {reason === 'expired' && !login.isError ? (
                <Notice tone="info" icon={Info}>
                  {t.auth.sessionExpired}
                </Notice>
              ) : null}
              {reason === 'offline' && !login.isError ? (
                <Notice tone="error" icon={WifiOff}>
                  {t.errors.network}
                </Notice>
              ) : null}
              {serverError ? (
                <Notice tone="error" icon={AlertCircle}>
                  {errorMessage(login.error)}
                </Notice>
              ) : null}

              <form className="space-y-4" onSubmit={onSubmit} noValidate aria-label={t.auth.title}>
                <FormField
                  id="login-login"
                  label={t.auth.login}
                  error={formState.errors.login?.message}
                >
                  <Input
                    id="login-login"
                    autoComplete="username"
                    autoCapitalize="none"
                    autoCorrect="off"
                    spellCheck={false}
                    autoFocus
                    placeholder={t.auth.loginPlaceholder}
                    aria-invalid={formState.errors.login ? true : undefined}
                    className="h-10"
                    {...register('login')}
                  />
                </FormField>

                <FormField
                  id="login-password"
                  label={t.auth.password}
                  error={formState.errors.password?.message}
                  hint={t.auth.passwordHint}
                >
                  <div className="relative">
                    <Input
                      id="login-password"
                      type={showPassword ? 'text' : 'password'}
                      inputMode="numeric"
                      autoComplete="current-password"
                      maxLength={6}
                      placeholder={t.auth.passwordPlaceholder}
                      aria-invalid={formState.errors.password ? true : undefined}
                      className="h-10 pr-10 font-mono tracking-widest"
                      {...register('password')}
                    />
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      className="absolute top-1/2 right-1 size-8 -translate-y-1/2 text-muted-foreground"
                      onClick={() => setShowPassword((v) => !v)}
                      aria-label={showPassword ? t.auth.hidePassword : t.auth.showPassword}
                      aria-pressed={showPassword}
                      aria-controls="login-password"
                    >
                      {showPassword ? <EyeOff /> : <Eye />}
                    </Button>
                  </div>
                </FormField>

                <Button type="submit" className="h-10 w-full" disabled={login.isPending}>
                  {login.isPending ? <Loader2 className="animate-spin" /> : <LogIn />}
                  {login.isPending ? t.auth.submitting : t.auth.submit}
                </Button>
              </form>
            </CardContent>
          </Card>

          {authMode === 'mock' ? (
            <div className="rounded-lg border border-dashed bg-card px-4 py-3 text-sm">
              <p className="font-medium">{t.auth.demoTitle}</p>
              <p className="mt-1 text-muted-foreground">{t.auth.demoHint(MOCK_DEMO_PASSWORD)}</p>
            </div>
          ) : (
            <p className="text-center text-xs text-muted-foreground">{t.auth.serverModeHint}</p>
          )}
        </div>
      </section>
    </main>
  );
}
