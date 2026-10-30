import { describe, expect, it } from 'vitest';
import { RoleCode } from '../enums/index.js';
import {
  ALL_PERMISSIONS,
  Permission,
  ROLE_PERMISSIONS,
  hasAllPermissions,
  hasAnyPermission,
} from './index.js';

describe('ROLE_PERMISSIONS (REQ-010, REQ-011)', () => {
  it('ADMIN barcha permissionlarga ega', () => {
    expect(new Set(ROLE_PERMISSIONS.ADMIN)).toEqual(new Set(ALL_PERMISSIONS));
  });

  it('permission kodlari takrorlanmaydi', () => {
    expect(new Set(ALL_PERMISSIONS).size).toBe(ALL_PERMISSIONS.length);
  });

  it('USER sotuv yaratishi va o‘z sotuvlarini ko‘rishi mumkin', () => {
    const user = ROLE_PERMISSIONS[RoleCode.USER];
    expect(user).toContain(Permission.SALES_CREATE);
    expect(user).toContain(Permission.SALES_READ_OWN);
    expect(user).toContain(Permission.CUSTOMERS_CREATE);
  });

  it('USER xarajat qo‘sha oladi, lekin ro‘yxatni ko‘ra va boshqara olmaydi (D-12)', () => {
    const user = ROLE_PERMISSIONS[RoleCode.USER];
    expect(user).toContain(Permission.EXPENSES_CREATE);
    expect(user).not.toContain(Permission.EXPENSES_READ);
    expect(user).not.toContain(Permission.EXPENSES_MANAGE);
  });

  it.each([
    Permission.USERS_MANAGE,
    Permission.USERS_READ,
    Permission.PRODUCTS_MANAGE,
    Permission.PRODUCTS_READ_COST,
    Permission.WAREHOUSES_MANAGE,
    Permission.WAREHOUSES_READ_ALL,
    Permission.INVENTORY_READ,
    Permission.INCOMING_MANAGE,
    Permission.INCOMING_CONFIRM,
    Permission.SALES_READ_ALL,
    Permission.CUSTOMERS_READ_HISTORY,
    Permission.EXPENSES_MANAGE,
    Permission.REPORTS_READ,
    Permission.DASHBOARD_ADMIN,
    Permission.AUDIT_READ,
    Permission.SETTINGS_MANAGE,
  ])('USER admin permissioniga ega emas: %s', (permission) => {
    expect(ROLE_PERMISSIONS[RoleCode.USER]).not.toContain(permission);
  });
});

describe('hasAllPermissions / hasAnyPermission', () => {
  const granted = [Permission.SALES_CREATE, Permission.PRODUCTS_READ];

  it('AND semantikasi', () => {
    expect(hasAllPermissions(granted, [Permission.SALES_CREATE])).toBe(true);
    expect(hasAllPermissions(granted, [Permission.SALES_CREATE, Permission.USERS_MANAGE])).toBe(
      false,
    );
    expect(hasAllPermissions(granted, [])).toBe(true);
  });

  it('OR semantikasi', () => {
    expect(hasAnyPermission(granted, [Permission.USERS_MANAGE, Permission.PRODUCTS_READ])).toBe(
      true,
    );
    expect(hasAnyPermission(granted, [Permission.USERS_MANAGE])).toBe(false);
  });
});

describe('hasAllPermissions / hasAnyPermission (AND / OR)', () => {
  const granted = [Permission.SALES_CREATE, Permission.PRODUCTS_READ];
  it('massiv va Set bilan bir xil natija', () => {
    for (const source of [granted, new Set(granted)]) {
      expect(hasAllPermissions(source, [Permission.SALES_CREATE, Permission.PRODUCTS_READ])).toBe(
        true,
      );
      expect(hasAllPermissions(source, [Permission.SALES_CREATE, Permission.USERS_MANAGE])).toBe(
        false,
      );
      expect(hasAnyPermission(source, [Permission.USERS_MANAGE, Permission.PRODUCTS_READ])).toBe(
        true,
      );
      expect(hasAnyPermission(source, [Permission.USERS_MANAGE])).toBe(false);
    }
    expect(hasAllPermissions(granted, [])).toBe(true);
    expect(hasAnyPermission(granted, [])).toBe(false);
  });
});
