import { ErrorCode, Permission, RoleCode } from '@divine/shared';
import { describe, expect, it } from 'vitest';
import {
  type AccessContext,
  assertWarehouseAccess,
  canAccessWarehouse,
  hasAnyPermission,
  hasPermission,
  ownerScope,
  warehouseScope,
} from '../../../src/common/auth/access-context.js';
import { AppError } from '../../../src/common/errors/app-error.js';

// Ownership qoidalari (RBAC §6, OWN-01…05): rol nomi emas, permission hal qiladi.
const ctx = (permissions: Permission[], warehouseIds: string[] = []): AccessContext => ({
  userId: 'u-1',
  login: 'sotuvchi',
  role: RoleCode.USER,
  permissions: new Set(permissions),
  warehouseIds: new Set(warehouseIds),
  issuedAt: 0,
});

describe('AccessContext', () => {
  it('hasPermission / hasAnyPermission', () => {
    const seller = ctx([Permission.SALES_CREATE]);
    expect(hasPermission(seller, Permission.SALES_CREATE)).toBe(true);
    expect(hasPermission(seller, Permission.USERS_MANAGE)).toBe(false);
    expect(hasAnyPermission(seller, [Permission.USERS_MANAGE, Permission.SALES_CREATE])).toBe(true);
    expect(hasAnyPermission(seller, [Permission.USERS_MANAGE])).toBe(false);
    expect(hasAnyPermission(seller, [])).toBe(false);
  });

  it('ombor: biriktirilgani ruxsat, boshqasi — 403 WAREHOUSE_ACCESS_DENIED; read_all — hammasi', () => {
    const seller = ctx([], ['w-1']);
    expect(canAccessWarehouse(seller, 'w-1')).toBe(true);
    expect(canAccessWarehouse(seller, 'w-2')).toBe(false);
    expect(() => assertWarehouseAccess(seller, 'w-1')).not.toThrow();
    try {
      assertWarehouseAccess(seller, 'w-2');
      expect.unreachable();
    } catch (error) {
      expect(error).toBeInstanceOf(AppError);
      expect((error as AppError).code).toBe(ErrorCode.WAREHOUSE_ACCESS_DENIED);
      expect((error as AppError).status).toBe(403);
    }
    const admin = ctx([Permission.WAREHOUSES_READ_ALL]);
    expect(canAccessWarehouse(admin, 'istalgan')).toBe(true);
  });

  it('repository filtrlari: cheklovsiz → undefined, aks holda ruxsat etilganlar / o‘zi', () => {
    expect(warehouseScope(ctx([Permission.WAREHOUSES_READ_ALL], ['w-1']))).toBeUndefined();
    expect(warehouseScope(ctx([], ['w-1', 'w-2']))?.sort()).toEqual(['w-1', 'w-2']);
    expect(warehouseScope(ctx([]))).toEqual([]);
    expect(ownerScope(ctx([Permission.SALES_READ_ALL]), Permission.SALES_READ_ALL)).toBeUndefined();
    expect(ownerScope(ctx([Permission.SALES_READ_OWN]), Permission.SALES_READ_ALL)).toBe('u-1');
  });
});
