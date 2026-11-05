import { Permission } from '@divine/shared';
import type { LucideIcon } from 'lucide-react';
import {
  BarChart3,
  Boxes,
  FolderTree,
  House,
  LayoutDashboard,
  Package,
  Settings,
  ShieldCheck,
  ShoppingCart,
  UserRound,
  Users,
  Wallet,
} from 'lucide-react';
import { t } from '@/i18n/uz';

export interface NavItem {
  key: keyof typeof t.nav;
  path: string;
  label: string;
  icon: LucideIcon;
  /**
   * Sahifani ko'rish uchun kerakli permissionlardan KAMIDA BITTASI (OR).
   * Bu faqat UX (menyuni yashirish) — haqiqiy himoya backendda (docs/RBAC.md §4).
   * Phase 4'da `/auth/me` permissionlari bilan filtrlanadi.
   */
  anyOf: Permission[];
}

/** Asosiy navigatsiya — TZ §16 dagi tartib va nomlar bilan (REQ-151). */
export const NAV_ITEMS: readonly NavItem[] = [
  {
    key: 'dashboard',
    path: '/',
    label: t.nav.dashboard,
    icon: LayoutDashboard,
    anyOf: [Permission.DASHBOARD_ADMIN, Permission.DASHBOARD_OWN],
  },
  { key: 'users', path: '/users', label: t.nav.users, icon: Users, anyOf: [Permission.USERS_READ] },
  {
    key: 'products',
    path: '/products',
    label: t.nav.products,
    icon: Package,
    anyOf: [Permission.PRODUCTS_READ],
  },
  {
    key: 'productGroups',
    path: '/product-groups',
    label: t.nav.productGroups,
    icon: FolderTree,
    anyOf: [Permission.PRODUCT_GROUPS_MANAGE],
  },
  {
    key: 'warehouses',
    path: '/warehouses',
    label: t.nav.warehouses,
    icon: Boxes,
    anyOf: [Permission.WAREHOUSES_READ_ALL],
  },
  {
    key: 'sales',
    path: '/sales',
    label: t.nav.sales,
    icon: ShoppingCart,
    anyOf: [Permission.SALES_CREATE, Permission.SALES_READ_OWN, Permission.SALES_READ_ALL],
  },
  {
    key: 'customers',
    path: '/customers',
    label: t.nav.customers,
    icon: UserRound,
    anyOf: [Permission.CUSTOMERS_READ_HISTORY],
  },
  {
    key: 'credits',
    path: '/credits',
    label: t.nav.credits,
    icon: HandCoins,
    anyOf: [Permission.CREDITS_MANAGE],
  },
  {
    key: 'expenses',
    path: '/expenses',
    label: t.nav.expenses,
    icon: Wallet,
    anyOf: [Permission.EXPENSES_READ, Permission.EXPENSES_CREATE],
  },
  {
    key: 'reports',
    path: '/reports',
    label: t.nav.reports,
    icon: BarChart3,
    anyOf: [Permission.REPORTS_READ],
  },
  {
    key: 'settings',
    path: '/settings',
    label: t.nav.settings,
    icon: Settings,
    anyOf: [Permission.SETTINGS_READ],
  },
];

export interface NavSection {
  key: 'main' | 'catalog' | 'operations' | 'admin';
  title: string;
  /** Telefon pastki panelidagi qisqa nom (4 ta tugma bir qatorga sig'ishi uchun). */
  shortTitle: string;
  icon: LucideIcon;
  keys: NavItem['key'][];
}

/** Menyu guruhlari: desktop yon paneli va telefon pastki paneli uchun yagona manba. */
export const NAV_SECTIONS: readonly NavSection[] = [
  {
    key: 'main',
    title: t.nav.sectionMain,
    shortTitle: t.nav.sectionMain,
    icon: House,
    keys: ['dashboard', 'sales', 'customers'],
  },
  {
    key: 'catalog',
    title: t.nav.sectionCatalog,
    shortTitle: t.nav.sectionCatalogShort,
    icon: Package,
    keys: ['products', 'productGroups', 'warehouses'],
  },
  {
    key: 'operations',
    title: t.nav.sectionOperations,
    shortTitle: t.nav.sectionOperations,
    icon: Wallet,
    keys: ['credits', 'expenses', 'reports'],
  },
  {
    key: 'admin',
    title: t.nav.sectionAdmin,
    shortTitle: t.nav.sectionAdmin,
    icon: ShieldCheck,
    keys: ['users', 'settings'],
  },
];
