import { LogOut } from 'lucide-react';
import { NavLink } from 'react-router';
import { useCurrentUser } from '@/features/session/api/session';
import { useSignOut } from '@/features/session/hooks/use-sign-out';
import { t } from '@/i18n/uz';
import { initials } from '@/shared/lib/format';
import { cn } from '@/shared/lib/utils';
import { Avatar, AvatarFallback } from '@/shared/ui/avatar';
import { Button } from '@/shared/ui/button';
import { Sheet, SheetContent, SheetDescription, SheetTitle } from '@/shared/ui/sheet';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/shared/ui/tooltip';
import { useUiStore } from '@/stores/ui.store';
import { useNavSections } from './use-nav-sections';

/** Mayda vaqtinchalik ko'rsatgich: icon-only rejimda nom tooltip'da chiqadi. */
function WithTooltip({
  show,
  label,
  children,
}: {
  show: boolean;
  label: string;
  children: React.ReactElement;
}) {
  if (!show) return children;
  return (
    <Tooltip>
      <TooltipTrigger asChild>{children}</TooltipTrigger>
      <TooltipContent side="right">{label}</TooltipContent>
    </Tooltip>
  );
}

function SidebarContent({
  collapsed = false,
  onNavigate,
}: {
  collapsed?: boolean;
  onNavigate?: () => void;
}) {
  const { data: me } = useCurrentUser();
  const name = me?.fullName ?? me?.login ?? '';
  const { signOut, pending } = useSignOut();
  const sections = useNavSections();

  return (
    <div className="flex h-full flex-col">
      <div
        className={cn(
          'flex h-16 shrink-0 items-center gap-2.5 border-b border-sidebar-border',
          collapsed ? 'justify-center px-2' : 'px-5',
        )}
      >
        {collapsed ? (
          <BrandMark className="size-8" />
        ) : (
          <div className="min-w-0 leading-tight">
            <BrandLogo className="h-7" />
            <p className="mt-1 truncate text-xs text-muted-foreground">{t.app.tagline}</p>
          </div>
        )}
      </div>

      <nav
        aria-label={t.nav.mainMenu}
        className={cn('flex-1 space-y-4 overflow-y-auto py-4', collapsed ? 'px-2' : 'px-3')}
      >
        {sections.map((section, index) => (
          <div key={section.key} className="space-y-0.5">
            {collapsed ? (
              index > 0 ? (
                <div className="mx-2 mb-2 border-t border-sidebar-border" aria-hidden />
              ) : null
            ) : (
              <p className="px-3 pb-1 text-[11px] font-semibold tracking-wider text-muted-foreground uppercase">
                {section.title}
              </p>
            )}
            {section.items.map((item) => {
              const Icon = item.icon;
              return (
                <WithTooltip key={item.key} show={collapsed} label={item.label}>
                  <NavLink
                    to={item.path}
                    end={item.path === '/'}
                    onClick={onNavigate}
                    aria-label={collapsed ? item.label : undefined}
                    className={({ isActive }) =>
                      cn(
                        'group relative flex h-9 items-center gap-3 rounded-md text-sm font-medium transition-colors outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50',
                        collapsed ? 'justify-center px-0' : 'px-3',
                        isActive
                          ? 'bg-sidebar-accent text-sidebar-accent-foreground before:absolute before:inset-y-1.5 before:left-0 before:w-[3px] before:rounded-full before:bg-primary'
                          : 'text-muted-foreground hover:bg-sidebar-accent/60 hover:text-sidebar-foreground',
                      )
                    }
                  >
                    <Icon className="size-4 shrink-0" aria-hidden />
                    {collapsed ? null : <span className="truncate">{item.label}</span>}
                  </NavLink>
                </WithTooltip>
              );
            })}
          </div>
        ))}
      </nav>

      <div
        className={cn(
          'shrink-0 border-t border-sidebar-border',
          collapsed ? 'space-y-1 p-2' : 'p-3',
        )}
      >
        <div
          className={cn(
            'flex items-center gap-3 rounded-md',
            collapsed ? 'flex-col' : 'px-2 py-1.5',
          )}
        >
          <WithTooltip show={collapsed} label={name}>
            <Avatar className="size-8">
              <AvatarFallback className="bg-primary/10 text-primary">
                {initials(name)}
              </AvatarFallback>
            </Avatar>
          </WithTooltip>
          {collapsed ? null : (
            <div className="min-w-0 flex-1 leading-tight">
              <p className="truncate text-sm font-medium">{name || t.common.loading}</p>
              <p className="truncate text-xs text-muted-foreground">
                {me ? t.roles[me.role] : null}
              </p>
            </div>
          )}
          <WithTooltip show label={t.topbar.logout}>
            <Button
              variant="ghost"
              size="icon"
              className="size-8 shrink-0 text-muted-foreground hover:text-destructive"
              onClick={signOut}
              disabled={pending}
              aria-label={t.topbar.logout}
            >
              <LogOut />
            </Button>
          </WithTooltip>
        </div>
        {collapsed ? null : (
          <p className="mt-2 px-2 text-[11px] text-muted-foreground">{t.app.version}</p>
        )}
      </div>
    </div>
  );
}

/**
 * Desktop'da doimiy (yig'iladigan) yon panel, planshetda — chapdan ochiladigan drawer. Telefonda menyu —
 * pastki panel (`MobileNav`); drawer ochish tugmasi u yerda ko'rsatilmaydi.
 */
export function Sidebar() {
  const { mobileSidebarOpen, closeMobileSidebar, sidebarCollapsed } = useUiStore();

  return (
    <>
      <aside
        className={cn(
          'sticky top-0 hidden h-svh shrink-0 border-r border-sidebar-border bg-sidebar transition-[width] duration-200 lg:block',
          sidebarCollapsed ? 'w-[68px]' : 'w-64',
        )}
      >
        <SidebarContent collapsed={sidebarCollapsed} />
      </aside>
      <Sheet open={mobileSidebarOpen} onOpenChange={(open) => !open && closeMobileSidebar()}>
        <SheetContent side="left" className="w-72 bg-sidebar p-0 sm:max-w-72 lg:hidden">
          <SheetTitle className="sr-only">{t.nav.mainMenu}</SheetTitle>
          <SheetDescription className="sr-only">{t.app.tagline}</SheetDescription>
          <SidebarContent onNavigate={closeMobileSidebar} />
        </SheetContent>
      </Sheet>
    </>
  );
}
