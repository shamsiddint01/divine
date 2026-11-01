import { Fragment, useState } from 'react';
import { NavLink, useLocation } from 'react-router';
import { t } from '@/i18n/uz';
import { cn } from '@/shared/lib/utils';
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from '@/shared/ui/sheet';
import { findNavItem } from '../navigation-context';
import type { NavSection } from '../navigation';
import { useNavSections } from './use-nav-sections';

const TAB_CLASS =
  'flex h-full w-full flex-col items-center justify-center gap-1 text-[11px] font-medium transition-colors outline-none focus-visible:bg-accent';

/**
 * Telefon menyusi: ekran pastida guruhlar (Asosiy, Katalog, Operatsiyalar, Boshqaruv). Guruh bosilsa —
 * uning bo'limlari pastdan ochiladi; bitta bo'limli guruh to'g'ridan-to'g'ri o'sha sahifaga o'tadi.
 * Faqat `md` dan kichik ekranda; planshet va desktop — yon panel.
 */
export function MobileNav() {
  const sections = useNavSections();
  const { pathname } = useLocation();
  const current = findNavItem(pathname);
  // Yopilish animatsiyasi paytida sarlavha va ro'yxat yo'qolmasin — oxirgi guruh saqlanadi.
  const [sheet, setSheet] = useState<{ key: NavSection['key']; open: boolean } | null>(null);
  const opened = sections.find((section) => section.key === sheet?.key);
  const close = () => setSheet((s) => (s ? { ...s, open: false } : s));

  // Kassa — sotuvchining asosiy ishi: guruh ichida yashirinmasin, pastki panel o'rtasida alohida tugma.
  const sell = sections.flatMap((section) => section.items).find((item) => item.key === 'sales');
  const sellActive = current?.key === 'sales';
  const sellAt = Math.floor(sections.length / 2);

  if (sections.length === 0) return null;

  return (
    <>
      <nav
        aria-label={t.nav.bottomMenu}
        className="fixed inset-x-0 bottom-0 z-40 border-t bg-background/95 pb-[env(safe-area-inset-bottom)] backdrop-blur md:hidden"
      >
        <ul
          className="grid h-16"
          style={{
            gridTemplateColumns: `repeat(${sections.length + (sell ? 1 : 0)}, minmax(0, 1fr))`,
          }}
        >
          {sections.map((section, index) => {
            const Icon = section.icon;
            const active = current && !sellActive ? section.keys.includes(current.key) : false;
            const content = (
              <>
                <span
                  className={cn(
                    'flex h-7 w-12 items-center justify-center rounded-full transition-colors',
                    active && 'bg-primary/10',
                  )}
                >
                  <Icon className="size-5" aria-hidden />
                </span>
                <span className="max-w-full truncate px-1">{section.shortTitle}</span>
              </>
            );
            const only = section.items.length === 1 ? section.items[0] : undefined;
            return (
              <Fragment key={section.key}>
                {sell && index === sellAt ? (
                  <li>
                    <NavLink
                      to={sell.path}
                      className={cn(
                        TAB_CLASS,
                        sellActive ? 'text-primary' : 'text-muted-foreground',
                      )}
                    >
                      <span
                        className={cn(
                          'flex size-9 items-center justify-center rounded-full bg-primary text-primary-foreground shadow-md shadow-primary/30 transition-transform',
                          sellActive && 'ring-4 ring-primary/15',
                        )}
                      >
                        <sell.icon className="size-[18px]" aria-hidden />
                      </span>
                      <span className="max-w-full truncate px-1">{t.nav.sellShort}</span>
                    </NavLink>
                  </li>
                ) : null}
                <li>
                  {only ? (
                    <NavLink
                      to={only.path}
                      end={only.path === '/'}
                      className={cn(TAB_CLASS, active ? 'text-primary' : 'text-muted-foreground')}
                    >
                      {content}
                    </NavLink>
                  ) : (
                    <button
                      type="button"
                      aria-haspopup="dialog"
                      aria-expanded={sheet?.key === section.key && sheet.open}
                      aria-current={active ? 'page' : undefined}
                      onClick={() => setSheet({ key: section.key, open: true })}
                      className={cn(TAB_CLASS, active ? 'text-primary' : 'text-muted-foreground')}
                    >
                      {content}
                    </button>
                  )}
                </li>
              </Fragment>
            );
          })}
        </ul>
      </nav>

      <Sheet open={Boolean(sheet?.open && opened)} onOpenChange={(open) => !open && close()}>
        <SheetContent
          side="bottom"
          className="gap-2 rounded-t-2xl pb-[calc(env(safe-area-inset-bottom)+1rem)] md:hidden"
        >
          <SheetHeader className="px-5 py-4">
            <SheetTitle>{opened?.title}</SheetTitle>
            <SheetDescription className="sr-only">
              {opened ? t.nav.sectionPages(opened.title) : null}
            </SheetDescription>
          </SheetHeader>
          <nav aria-label={opened ? t.nav.sectionPages(opened.title) : undefined}>
            <ul className="space-y-1 px-3">
              {opened?.items.map((item) => {
                const Icon = item.icon;
                return (
                  <li key={item.key}>
                    <NavLink
                      to={item.path}
                      end={item.path === '/'}
                      onClick={close}
                      className={({ isActive }) =>
                        cn(
                          'flex h-12 items-center gap-3 rounded-lg px-3 text-sm font-medium transition-colors outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50',
                          isActive
                            ? 'bg-primary/10 text-primary'
                            : 'text-foreground hover:bg-accent',
                        )
                      }
                    >
                      <Icon className="size-5 shrink-0" aria-hidden />
                      <span className="truncate">{item.label}</span>
                    </NavLink>
                  </li>
                );
              })}
            </ul>
          </nav>
        </SheetContent>
      </Sheet>
    </>
  );
}
