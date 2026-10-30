import { type CanActivate, type ExecutionContext, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { ErrorCode, type Permission } from '@divine/shared';
import { AppError } from '../errors/app-error.js';
import {
  AUTHENTICATED_KEY,
  PERMISSIONS_ALL_KEY,
  PERMISSIONS_ANY_KEY,
  PUBLIC_KEY,
} from './auth.decorators.js';
import type { AuthRequest } from './request-types.js';

/**
 * Global guard (RBAC §4.1, 2-qadam) — JwtAuthGuard'dan keyin.
 * `@RequirePermissions` → AND, `@RequireAnyPermission` → OR, `@Authenticated` → istalgan user.
 * Hech qaysi decorator yo'q endpoint — rad etiladi (RouteSecurityAuditor bunday endpointni ishga
 * tushirishgacha aniqlaydi; bu — ikkinchi himoya). Ruxsat yo'q → `403 FORBIDDEN`.
 * Rol nomi tekshirilmaydi — faqat permission kodlari (RBAC §1).
 */
@Injectable()
export class PermissionsGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const targets = [context.getHandler(), context.getClass()];
    if (this.reflector.getAllAndOverride<boolean>(PUBLIC_KEY, targets)) return true;

    const ctx = context.switchToHttp().getRequest<AuthRequest>().accessContext;
    if (!ctx) throw new AppError(ErrorCode.UNAUTHENTICATED);

    const all = this.reflector.getAllAndOverride<Permission[] | undefined>(
      PERMISSIONS_ALL_KEY,
      targets,
    );
    const any = this.reflector.getAllAndOverride<Permission[] | undefined>(
      PERMISSIONS_ANY_KEY,
      targets,
    );
    const authenticatedOnly = this.reflector.getAllAndOverride<boolean>(AUTHENTICATED_KEY, targets);

    if (all && !all.every((permission) => ctx.permissions.has(permission))) {
      throw new AppError(ErrorCode.FORBIDDEN);
    }
    if (any && !any.some((permission) => ctx.permissions.has(permission))) {
      throw new AppError(ErrorCode.FORBIDDEN);
    }
    if (!all && !any && !authenticatedOnly) throw new AppError(ErrorCode.FORBIDDEN);
    return true;
  }
}
