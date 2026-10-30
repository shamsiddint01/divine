import { type CanActivate, type ExecutionContext, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { ErrorCode, type Permission } from '@divine/shared';
import { PUBLIC_KEY } from '../../common/auth/auth.decorators.js';
import type { AuthRequest } from '../../common/auth/request-types.js';
import { AppError } from '../../common/errors/app-error.js';
import { Clock } from '../../common/time/clock.js';
import { AuthRepository } from './auth.repository.js';

/** Rol permissionlari keshi (RBAC §4.1): seed bilan o'zgaradi, shuning uchun qisqa TTL. */
const PERMISSION_CACHE_TTL_MS = 60_000;

/**
 * Global guard (deny by default, SECURITY §1, RBAC §4.1). `@Public()` bo'lmagan har bir endpoint:
 * 1) imzosi tekshirilgan access token (`AccessTokenMiddleware`) — yo'q/yaroqsiz → `401 UNAUTHENTICATED`;
 * 2) user DB'dan PK bo'yicha: yo'q → 401; `status != ACTIVE` → `401 ACCOUNT_BLOCKED` (bloklash darhol);
 * 3) `iat >= password_changed_at` (soniya aniqligida) — parol tiklangandan oldingi token → `401 SESSION_EXPIRED`;
 * 4) `req.accessContext` = { userId, role, permissions, warehouseIds }.
 */
@Injectable()
export class JwtAuthGuard implements CanActivate {
  private readonly permissionCache = new Map<
    number,
    { permissions: Set<Permission>; at: number }
  >();

  constructor(
    private readonly reflector: Reflector,
    private readonly repository: AuthRepository,
    private readonly clock: Clock,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const isPublic = this.reflector.getAllAndOverride<boolean>(PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPublic) return true;

    const req = context.switchToHttp().getRequest<AuthRequest>();
    const claims = req.authToken;
    if (!claims) throw new AppError(ErrorCode.UNAUTHENTICATED);

    const user = await this.repository.findAuthUser(claims.sub);
    if (!user) throw new AppError(ErrorCode.UNAUTHENTICATED);
    if (user.status !== 'ACTIVE') throw new AppError(ErrorCode.ACCOUNT_BLOCKED);
    if (claims.iat < Math.floor(user.passwordChangedAt.getTime() / 1000)) {
      throw new AppError(ErrorCode.SESSION_EXPIRED);
    }

    req.accessContext = {
      userId: user.id,
      login: user.login,
      role: user.role,
      permissions: await this.permissionsFor(user.roleId),
      warehouseIds: new Set(user.warehouseIds),
      issuedAt: claims.iat,
    };
    return true;
  }

  private async permissionsFor(roleId: number): Promise<Set<Permission>> {
    const now = this.clock.now().getTime();
    const cached = this.permissionCache.get(roleId);
    if (cached && now - cached.at < PERMISSION_CACHE_TTL_MS) return cached.permissions;
    const permissions = new Set(await this.repository.permissionsForRole(roleId));
    this.permissionCache.set(roleId, { permissions, at: now });
    return permissions;
  }
}
