import { Suspense, useEffect } from 'react';
import { Outlet, useLocation } from 'react-router';
import { useCurrentUser } from '@/features/session/api/session';
import { SiteBanners } from '@/features/site/components/SiteBanners';
import { WhatsNewDialog } from '@/features/support/components/WhatsNewDialog';
import { hasAny, usePermissions } from '@/features/session/hooks/use-permissions';
import { playSplashOnce } from '@/shared/lib/splash';
import { Skeleton } from '@/shared/ui/skeleton';
import { findNavItem } from '../navigation-context';
import { ForbiddenPage } from '../pages/ForbiddenPage';
import { MobileNav } from './MobileNav';
import { Sidebar } from './Sidebar';
import { Topbar } from './Topbar';

function PageFallback() {
  return (
    <div className="space-y-6" aria-busy="true">
      <div className="space-y-2">
        <Skeleton className="h-8 w-56" />
        <Skeleton className="h-4 w-80" />
      </div>
      <Skeleton className="h-10 w-full max-w-xl" />
      <Skeleton className="h-96 w-full" />
    </div>
  );
}

/**
 * Bo'lim ruxsati (RBAC §5): ruxsatsiz bo'limga to'g'ridan-to'g'ri URL bilan kirilsa — "Ruxsat yo'q".
 * Faqat UX: backend har bir so'rovni qayta tekshiradi.
 */
function SectionGate() {
  const { pathname } = useLocation();
  const { data: me } = useCurrentUser();
  const permissions = usePermissions();
  const section = findNavItem(pathname);
  if (!me) return <PageFallback />;
  if (section && !hasAny(permissions, section.anyOf)) return <ForbiddenPage />;
  return <Outlet />;
}

/**
 * Asosiy karkas: yon panel + yuqori panel + sahifa (sahifalar lazy yuklanadi). Telefonda menyu pastda
 * (`MobileNav`): `--mobile-nav-h` — uning balandligi; sahifa oxiri va sticky paneller uning ostida qolmaydi.
 */
export function AppLayout() {
  // Ichki saytga kirganda logotip animatsiyasi — sessiyada bir marta (logindan keyin esa har safar).
  useEffect(() => playSplashOnce(), []);
  // Bo'lim almashganda sahifa animatsiya bilan kiradi (`key` — faqat yo'l; filtr/tab `?…` emas).
  const { pathname } = useLocation();
  return (
    <div className="flex min-h-svh [--mobile-nav-h:calc(4rem+env(safe-area-inset-bottom))] md:[--mobile-nav-h:0px]">
      <Sidebar />
      <div className="flex min-w-0 flex-1 flex-col">
        <Topbar />
        <SiteBanners />
        <main className="flex-1 p-4 pb-[calc(var(--mobile-nav-h)+1rem)] sm:p-6 sm:pb-[calc(var(--mobile-nav-h)+1.5rem)]">
          <div key={pathname} className="page-enter mx-auto w-full max-w-[1440px] space-y-6">
            <Suspense fallback={<PageFallback />}>
              <SectionGate />
            </Suspense>
          </div>
        </main>
      </div>
      <MobileNav />
      <WhatsNewDialog />
    </div>
  );
}
