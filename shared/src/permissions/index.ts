import { RoleCode } from '../enums/index.js';

/**
 * Permission kodlari — RBAC'ning yagona manbai (docs/RBAC.md).
 * Backend `@RequirePermissions(...)` va frontend navigatsiya/route guard aynan shu kodlarni ishlatadi.
 */
export const Permission = {
  USERS_READ: 'users.read',
  USERS_MANAGE: 'users.manage',

  PRODUCT_GROUPS_READ: 'product_groups.read',
  PRODUCT_GROUPS_MANAGE: 'product_groups.manage',

  PRODUCTS_READ: 'products.read',
  PRODUCTS_READ_COST: 'products.read_cost',
  PRODUCTS_MANAGE: 'products.manage',

  /** Faqat userga biriktirilgan omborlar (ownership service qatlamida). */
  WAREHOUSES_READ: 'warehouses.read',
  /** Barcha omborlar va ularning detali. */
  WAREHOUSES_READ_ALL: 'warehouses.read_all',
  WAREHOUSES_MANAGE: 'warehouses.manage',

  INVENTORY_READ: 'inventory.read',
  INVENTORY_RECONCILE: 'inventory.reconcile',

  INCOMING_READ: 'incoming.read',
  INCOMING_MANAGE: 'incoming.manage',
  INCOMING_CONFIRM: 'incoming.confirm',

  SALES_CREATE: 'sales.create',
  SALES_READ_OWN: 'sales.read_own',
  SALES_READ_ALL: 'sales.read_all',

  CUSTOMERS_READ: 'customers.read',
  CUSTOMERS_CREATE: 'customers.create',
  CUSTOMERS_MANAGE: 'customers.manage',
  CUSTOMERS_READ_HISTORY: 'customers.read_history',

  EXPENSES_READ: 'expenses.read',
  /** Faqat yangi xarajat qo'shish: ro'yxat, tahrirlash va o'chirishsiz (D-12 — sotuvchi). */
  EXPENSES_CREATE: 'expenses.create',
  EXPENSES_MANAGE: 'expenses.manage',

  /** Nasiya bo'limi: ko'rish, qo'shish, to'lov yozish (faqat ADMIN, D-24). */
  CREDITS_MANAGE: 'credits.manage',

  REPORTS_READ: 'reports.read',

  DASHBOARD_ADMIN: 'dashboard.admin',
  DASHBOARD_OWN: 'dashboard.own',

  AUDIT_READ: 'audit.read',

  SETTINGS_READ: 'settings.read',
  SETTINGS_MANAGE: 'settings.manage',
} as const;

export type Permission = (typeof Permission)[keyof typeof Permission];

export const ALL_PERMISSIONS = Object.values(Permission) as Permission[];

/**
 * Rol → permission xaritasi. DB'dagi `role_permissions` seed'i shu ro'yxatdan yaratiladi (Phase 2).
 * USER — faqat sotuv jarayoni va aniq ruxsat berilgan o'qish operatsiyalari (REQ-011).
 */
export const ROLE_PERMISSIONS: Readonly<Record<RoleCode, readonly Permission[]>> = {
  [RoleCode.ADMIN]: ALL_PERMISSIONS,
  [RoleCode.USER]: [
    Permission.PRODUCT_GROUPS_READ,
    Permission.PRODUCTS_READ,
    Permission.WAREHOUSES_READ,
    Permission.SALES_CREATE,
    Permission.SALES_READ_OWN,
    Permission.CUSTOMERS_READ,
    Permission.CUSTOMERS_CREATE,
    Permission.EXPENSES_CREATE,
    Permission.DASHBOARD_OWN,
  ],
};

/** Barcha talab qilingan permissionlar mavjudmi (AND semantikasi). */
export function hasAllPermissions(
  granted: Iterable<Permission>,
  required: readonly Permission[],
): boolean {
  const set = granted instanceof Set ? (granted as Set<Permission>) : new Set(granted);
  return required.every((p) => set.has(p));
}

/** Kamida bitta permission mavjudmi (OR semantikasi). */
export function hasAnyPermission(
  granted: Iterable<Permission>,
  required: readonly Permission[],
): boolean {
  const set = granted instanceof Set ? (granted as Set<Permission>) : new Set(granted);
  return required.some((p) => set.has(p));
}
