import 'reflect-metadata';
import { Controller, Get, Module } from '@nestjs/common';
import { DiscoveryModule } from '@nestjs/core';
import { Test } from '@nestjs/testing';
import { ALL_PERMISSIONS, Permission, ROLE_PERMISSIONS } from '@divine/shared';
import { describe, expect, it } from 'vitest';
import {
  type AccessContext,
  assertWarehouseAccess,
  canAccessWarehouse,
  ownerScope,
  warehouseScope,
} from '../../../src/common/auth/access-context.js';
import { Authenticated, Public } from '../../../src/common/auth/auth.decorators.js';
import { RouteSecurityAuditor } from '../../../src/common/auth/route-security.auditor.js';
import { AppError } from '../../../src/common/errors/app-error.js';

const ctxOf = (role: 'ADMIN' | 'USER', warehouseIds: string[] = []): AccessContext => ({
  userId: `${role}-id`,
  login: role.toLowerCase(),
  role,
  permissions: new Set(role === 'ADMIN' ? ALL_PERMISSIONS : ROLE_PERMISSIONS.USER),
  warehouseIds: new Set(warehouseIds),
  issuedAt: 0,
});

describe('ombor ownership helper‘lari (RBAC §6)', () => {
  it('USER faqat biriktirilgan omborlar; ADMIN (warehouses.read_all) — hammasi', () => {
    const user = ctxOf('USER', ['a']);
    expect(canAccessWarehouse(user, 'a')).toBe(true);
    expect(canAccessWarehouse(user, 'b')).toBe(false);
    expect(canAccessWarehouse(ctxOf('ADMIN'), 'b')).toBe(true);
  });

  it('assertWarehouseAccess → 403 WAREHOUSE_ACCESS_DENIED; omborsiz USER hech qayerga (OWN-09)', () => {
    expect(() => assertWarehouseAccess(ctxOf('USER'), 'a')).toThrowError(AppError);
    try {
      assertWarehouseAccess(ctxOf('USER'), 'a');
    } catch (error) {
      expect(error).toMatchObject({ code: 'WAREHOUSE_ACCESS_DENIED', status: 403 });
    }
  });

  it('repository filtrlari: warehouseScope va ownerScope', () => {
    expect(warehouseScope(ctxOf('ADMIN'))).toBeUndefined();
    expect(warehouseScope(ctxOf('USER', ['a', 'b']))).toEqual(['a', 'b']);
    expect(ownerScope(ctxOf('ADMIN'), Permission.SALES_READ_ALL)).toBeUndefined();
    expect(ownerScope(ctxOf('USER'), Permission.SALES_READ_ALL)).toBe('USER-id');
  });
});

@Controller('ochiq')
class Unprotected {
  @Get()
  leaked() {
    return 'x';
  }

  @Get('ok')
  @Authenticated()
  ok() {
    return 'ok';
  }
}

@Public()
@Controller('public-class')
class PublicClass {
  @Get()
  fine() {
    return 'ok';
  }
}

@Module({
  imports: [DiscoveryModule],
  controllers: [Unprotected, PublicClass],
  providers: [RouteSecurityAuditor],
})
class FixtureModule {}

describe('RouteSecurityAuditor ("himoyasiz endpoint qolmasin")', () => {
  it('decorator‘siz endpoint topiladi va ilova ishga tushmaydi', async () => {
    const moduleRef = await Test.createTestingModule({ imports: [FixtureModule] }).compile();
    expect(moduleRef.get(RouteSecurityAuditor).findUnprotectedRoutes()).toEqual([
      'Unprotected.leaked',
    ]);
    const app = moduleRef.createNestApplication({ logger: false });
    await expect(app.init()).rejects.toThrow(/Unprotected\.leaked/);
  });
});
