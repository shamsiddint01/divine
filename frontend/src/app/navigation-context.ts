import { NAV_ITEMS, type NavItem } from './navigation';

/** Joriy URL qaysi bo'limga tegishli (`/warehouses/123` → "Ombor"). */
export function findNavItem(pathname: string): NavItem | undefined {
  if (pathname === '/') return NAV_ITEMS.find((i) => i.path === '/');
  return NAV_ITEMS.filter((i) => i.path !== '/' && pathname.startsWith(i.path)).sort(
    (a, b) => b.path.length - a.path.length,
  )[0];
}
