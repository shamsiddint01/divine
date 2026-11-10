import { zodResolver } from '@/shared/forms/zod';
import { type LoginRequest, loginRequestSchema } from '@divine/shared';
import { useQueryClient } from '@tanstack/react-query';
import {
  AlertCircle,
  ArrowLeft,
  Check,
  Eye,
  EyeOff,
  Info,
  Loader2,
  LogIn,
  Phone,
  ShieldCheck,
  Sparkles,
  WifiOff,
} from 'lucide-react';
import { useEffect, useState } from 'react';
import { useForm } from 'react-hook-form';
import { Link, Navigate, useSearchParams } from 'react-router';
import { MOCK_DEMO_PASSWORD } from '@/mocks/handlers/auth.constants';
import { t } from '@/i18n/uz';
import { FormField } from '@/shared/components/FormField';
import { ApiError } from '@/shared/lib/api-client';
import { PHONE_HREF, TRIAL_BOT_URL } from '@/shared/lib/contacts';
import { authMode } from '@/shared/lib/api-mode';
import { applyFieldErrors } from '@/shared/lib/mutation';
import { cn } from '@/shared/lib/utils';
import { BrandLogo } from '@/shared/ui/brand-logo';
import { Button } from '@/shared/ui/button';
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
  const notice = useAuthStore((s) => s.notice);
  const queryClient = useQueryClient();
  const [params] = useSearchParams();
  const [showPassword, setShowPassword] = useState(false);
  const [forgotOpen, setForgotOpen] = useState(false);
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

  const signInWithDemo = () => {
    setValue('login', 'admin');
    setValue('password', MOCK_DEMO_PASSWORD);
    void onSubmit();
  };

  const serverError =
    login.isError && !(login.error instanceof ApiError && login.error.details.length > 0);

  return (
    <main className="grid min-h-svh bg-background lg:grid-cols-[minmax(0,1.05fr)_minmax(0,1fr)]">
      {/* Brend paneli — har ikki mavzuda ham to'q (landing bilan bir uslub), faqat katta ekranda */}
      <aside className="relative hidden overflow-hidden bg-[#05060a] text-white lg:flex lg:flex-col lg:justify-between lg:p-12 xl:p-14">
        <div aria-hidden className="pointer-events-none absolute inset-0">
          <div className="absolute -top-40 -left-32 size-[520px] rounded-full bg-primary/45 blur-[130px]" />
          <div className="absolute -right-40 -bottom-48 size-[460px] rounded-full bg-primary/25 blur-[140px]" />
          <div className="absolute inset-0 bg-[linear-gradient(to_right,rgb(255_255_255/0.045)_1px,transparent_1px),linear-gradient(to_bottom,rgb(255_255_255/0.045)_1px,transparent_1px)] [mask-image:radial-gradient(ellipse_at_40%_45%,black_20%,transparent_72%)] bg-[size:56px_56px]" />
        </div>

        <Link
          to="/welcome"
          className="relative flex w-fit items-center gap-3 rounded-lg outline-none focus-visible:ring-[3px] focus-visible:ring-white/40"
        >
          <BrandLogo variant="dark" className="h-9" />
        </Link>

        <div className="relative max-w-lg space-y-6">
          <span className="inline-flex items-center gap-2 rounded-full border border-white/15 bg-white/5 px-3 py-1 text-xs font-medium text-white/80">
            <span className="size-1.5 rounded-full bg-primary" aria-hidden />
            {t.app.tagline}
          </span>
          <p className="text-4xl leading-[1.15] font-semibold tracking-tight xl:text-[44px]">
            {t.auth.panelTitle}
          </p>
          <p className="text-base text-white/65">{t.auth.panelLead}</p>
          <ul className="space-y-3 pt-2">
            {t.auth.panelPoints.map((point) => (
              <li key={point} className="flex items-center gap-3 text-[15px] text-white/85">
                <span className="flex size-6 shrink-0 items-center justify-center rounded-full bg-primary/20 text-primary ring-1 ring-primary/40">
                  <Check className="size-3.5" aria-hidden />
                </span>
                {point}
              </li>
            ))}
          </ul>
        </div>

        <div className="relative flex items-center justify-between gap-4 text-sm text-white/55">
          <span className="flex items-center gap-2">
            <ShieldCheck className="size-4" aria-hidden />
            {t.app.version}
          </span>
          <a
            href={PHONE_HREF}
            className="flex items-center gap-2 rounded outline-none hover:text-white focus-visible:ring-[3px] focus-visible:ring-white/40"
          >
            <Phone className="size-4" aria-hidden />
            {t.landing.footer.phone}
          </a>
        </div>
      </aside>

      <section className="flex min-h-svh flex-col px-4 pt-3 pb-5 sm:px-8 sm:pt-6 sm:pb-6">
        <header className="flex items-center justify-between gap-3">
          <Button
            asChild
            variant="ghost"
            size="sm"
            className="-ml-2 text-muted-foreground hover:text-foreground"
          >
            <Link to="/welcome">
              <ArrowLeft aria-hidden />
              {t.auth.backHome}
            </Link>
          </Button>
          <Button
            asChild
            variant="ghost"
            size="sm"
            className="-mr-2 text-muted-foreground hover:text-foreground"
          >
            <a href={PHONE_HREF} title={t.landing.footer.phone}>
              <Phone aria-hidden />
              {t.auth.help}
            </a>
          </Button>
        </header>

        <div className="flex flex-1 items-center justify-center py-6 sm:py-10">
          <div className="w-full max-w-[400px]">
            <div className="mb-6 space-y-2 text-center sm:mb-8">
              <BrandLogo className="mx-auto mb-5 h-10 lg:hidden" />
              <h1 className="text-2xl font-semibold tracking-tight sm:text-[28px]">
                {t.auth.title}
              </h1>
              <p className="text-sm text-muted-foreground">{t.auth.subtitle}</p>
            </div>

            <div className="space-y-5 rounded-2xl border bg-card p-5 text-card-foreground shadow-sm sm:p-7">
              {reason === 'expired' && !login.isError ? (
                <Notice tone="info" icon={Info}>
                  {t.auth.sessionExpired}
                </Notice>
              ) : null}
              {reason === 'blocked' && notice && !login.isError ? (
                <Notice tone="error" icon={AlertCircle}>
                  {notice}
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
                    className="h-11"
                    {...register('login')}
                  />
                </FormField>

                <FormField
                  id="login-password"
                  label={t.auth.password}
                  error={formState.errors.password?.message}
                  hint={forgotOpen ? t.auth.passwordHint : undefined}
                  action={
                    <button
                      type="button"
                      className="rounded-sm text-xs font-medium text-primary outline-none hover:underline focus-visible:ring-[3px] focus-visible:ring-ring/50"
                      aria-expanded={forgotOpen}
                      aria-controls={forgotOpen ? 'login-password-hint' : undefined}
                      onClick={() => setForgotOpen((v) => !v)}
                    >
                      {t.auth.forgot}
                    </button>
                  }
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
                      className="h-11 pr-11 font-mono tracking-[0.3em] placeholder:font-sans placeholder:tracking-normal"
                      {...register('password')}
                    />
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      className="absolute top-1/2 right-1 size-9 -translate-y-1/2 text-muted-foreground"
                      onClick={() => setShowPassword((v) => !v)}
                      aria-label={showPassword ? t.auth.hidePassword : t.auth.showPassword}
                      aria-pressed={showPassword}
                      aria-controls="login-password"
                    >
                      {showPassword ? <EyeOff /> : <Eye />}
                    </Button>
                  </div>
                </FormField>

                <Button
                  type="submit"
                  className="mt-2 h-11 w-full text-[15px]"
                  disabled={login.isPending}
                >
                  {login.isPending ? <Loader2 className="animate-spin" /> : <LogIn />}
                  {login.isPending ? t.auth.submitting : t.auth.submit}
                </Button>
              </form>

              {authMode === 'mock' ? (
                <>
                  <div className="flex items-center gap-3 text-xs text-muted-foreground">
                    <span className="h-px flex-1 bg-border" />
                    {t.auth.or}
                    <span className="h-px flex-1 bg-border" />
                  </div>
                  <div className="space-y-2.5">
                    <Button
                      type="button"
                      variant="outline"
                      className="h-11 w-full bg-transparent"
                      disabled={login.isPending}
                      onClick={signInWithDemo}
                    >
                      <Sparkles aria-hidden />
                      {t.auth.demoSignIn}
                    </Button>
                    <p className="text-center text-xs leading-relaxed text-muted-foreground">
                      <span className="font-medium text-foreground">{t.auth.demoTitle}.</span>{' '}
                      {t.auth.demoHint(MOCK_DEMO_PASSWORD)}
                    </p>
                  </div>
                </>
              ) : null}
            </div>

            <p className="mt-6 text-center text-sm text-muted-foreground">
              {t.auth.noAccount}{' '}
              <a
                href={TRIAL_BOT_URL}
                target="_blank"
                rel="noopener noreferrer"
                className="rounded-sm font-medium text-primary outline-none hover:underline focus-visible:ring-[3px] focus-visible:ring-ring/50"
              >
                {t.landing.tryFree}
              </a>
            </p>
          </div>
        </div>

        {/* Katta ekranda versiya brend panelida — bu yerda takrorlanmaydi */}
        <footer className="flex flex-col items-center gap-1 text-center text-xs text-muted-foreground lg:items-start">
          <span>{t.landing.footer.copyright}</span>
          <span className="lg:hidden">{t.app.version}</span>
        </footer>
      </section>
    </main>
  );
}
