import {
  Bell,
  HandCoins,
  LogOut,
  Menu,
  PackageX,
  PanelLeftClose,
  PanelLeftOpen,
} from 'lucide-react';
import { Link, useLocation } from 'react-router';
import { Permission } from '@divine/shared';
import { useCreditReminders } from '@/features/credits/api/credits';
import { useDashboardSummary } from '@/features/dashboard/api/dashboard';
import { useCurrentUser } from '@/features/session/api/session';
import { useHasAnyPermission } from '@/features/session/hooks/use-permissions';
import { useSignOut } from '@/features/session/hooks/use-sign-out';
import { ApiStatusBadge } from '@/features/system/components/ApiStatusBadge';
import { t } from '@/i18n/uz';
import { formatDate, formatMoney, formatQuantity, initials } from '@/shared/lib/format';
import { Avatar, AvatarFallback } from '@/shared/ui/avatar';
import { Button } from '@/shared/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/shared/ui/dropdown-menu';
import { useUiStore } from '@/stores/ui.store';
import { findNavItem } from '../navigation-context';

/**
 * Bildirishnomalar: real ma'lumotdan — kam qolgan mahsulotlar (`dashboard/summary`). Faqat
 * `dashboard.admin` bilan ko'rsatiladi: sotuvchi uchun bu so'rov `403` bo'lardi (OWN-08).
 */
function NotificationsMenu() {
  const { data } = useDashboardSummary();
  const canSeeCredits = useHasAnyPermission([Permission.CREDITS_MANAGE]);
  const { data: reminders } = useCreditReminders(canSeeCredits);
  const items = data?.lowStock.items ?? [];
  const credits = reminders ?? [];
  const count = (data?.lowStock.count ?? 0) + credits.length;

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          className="relative"
          aria-label={t.topbar.notifications}
        >
          <Bell />
          {count > 0 ? (
            <span className="absolute top-1 right-1 flex min-w-4 items-center justify-center rounded-full bg-destructive px-1 text-[10px] font-semibold text-white">
              {count}
            </span>
          ) : null}
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-80">
        <DropdownMenuLabel>{t.topbar.notifications}</DropdownMenuLabel>
        <DropdownMenuSeparator />
        {credits.length > 0 ? (
          <>
            <p className="px-2 pb-1 text-xs font-medium text-muted-foreground">
              {t.topbar.creditsTitle}
            </p>
            {credits.map((r) => (
              <DropdownMenuItem key={r.creditId} asChild>
                <Link to={`/credits?q=${encodeURIComponent(r.number)}`} className="gap-3">
                  <HandCoins className="text-warning" />
                  <span className="min-w-0 whitespace-normal">
                    {t.topbar.creditAlert(
                      r.debtorName,
                      formatDate(r.dueDate),
                      formatMoney(r.amount),
                    )}
                  </span>
                </Link>
              </DropdownMenuItem>
            ))}
            {items.length > 0 ? <DropdownMenuSeparator /> : null}
          </>
        ) : null}
        {items.length === 0 ? (
          credits.length > 0 ? null : (
            <p className="px-2 py-6 text-center text-sm text-muted-foreground">
              {t.topbar.noNotifications}
            </p>
          )
        ) : (
          <>
            <p className="px-2 pb-1 text-xs font-medium text-muted-foreground">
              {t.topbar.lowStockTitle}
            </p>
            {items.map((item) => (
              <DropdownMenuItem key={item.productId} asChild>
                <Link to={`/products?q=${encodeURIComponent(item.name)}`} className="gap-3">
                  <PackageX className="text-warning" />
                  <span className="truncate">
                    {t.topbar.lowStockAlert(
                      item.name,
                      `${formatQuantity(item.stock)} ${t.units[item.unit]}`,
                    )}
                  </span>
                </Link>
              </DropdownMenuItem>
            ))}
            <DropdownMenuSeparator />
            <DropdownMenuItem asChild>
              <Link to="/products?stock=low" className="justify-center text-primary">
                {t.common.viewAll}
              </Link>
            </DropdownMenuItem>
          </>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function UserMenu() {
  const { data: me } = useCurrentUser();
  const { signOut } = useSignOut();
  const name = me?.fullName ?? me?.login ?? '';
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" className="h-9 gap-2 px-1.5" aria-label={t.topbar.userMenu}>
          <Avatar className="size-7">
            <AvatarFallback className="bg-primary/10 text-primary">{initials(name)}</AvatarFallback>
          </Avatar>
          <span className="hidden text-sm font-medium md:inline">{me?.login}</span>
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-56">
        <DropdownMenuLabel className="space-y-0.5">
          <p className="truncate">{name}</p>
          <p className="text-xs font-normal text-muted-foreground">
            {me ? `${me.login} · ${t.roles[me.role]}` : null}
          </p>
        </DropdownMenuLabel>
        <DropdownMenuSeparator />
        <DropdownMenuItem onSelect={signOut}>
          <LogOut />
          {t.topbar.logout}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/** Yuqori panel: menyu tugmasi, joriy bo'lim, server/demo holati, bildirishnomalar, foydalanuvchi. */
export function Topbar() {
  const openMobileSidebar = useUiStore((s) => s.openMobileSidebar);
  const collapsed = useUiStore((s) => s.sidebarCollapsed);
  const toggleSidebar = useUiStore((s) => s.toggleSidebar);
  const { pathname } = useLocation();
  const section = findNavItem(pathname);
  const SectionIcon = section?.icon;
  const canSeeLowStock = useHasAnyPermission([Permission.DASHBOARD_ADMIN]);

  return (
    <header className="sticky top-0 z-30 flex h-16 items-center gap-2 border-b bg-background/85 px-4 backdrop-blur sm:px-6">
      <Button
        variant="ghost"
        size="icon"
        className="hidden md:inline-flex lg:hidden"
        onClick={openMobileSidebar}
        aria-label={t.nav.openMenu}
      >
        <Menu />
      </Button>
      <Button
        variant="ghost"
        size="icon"
        className="hidden lg:inline-flex"
        onClick={toggleSidebar}
        aria-label={collapsed ? t.nav.expand : t.nav.collapse}
      >
        {collapsed ? <PanelLeftOpen /> : <PanelLeftClose />}
      </Button>
      {section && SectionIcon ? (
        <div className="flex min-w-0 items-center gap-2 text-sm font-medium text-muted-foreground">
          <SectionIcon className="size-4 shrink-0" aria-hidden />
          <span className="truncate">{section.label}</span>
        </div>
      ) : null}
      <div className="ml-auto flex items-center gap-1 sm:gap-2">
        <div className="hidden sm:block">
          <ApiStatusBadge />
        </div>
        {canSeeLowStock ? <NotificationsMenu /> : null}
        <UserMenu />
      </div>
    </header>
  );
}
