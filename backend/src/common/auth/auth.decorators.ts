import { createParamDecorator, type ExecutionContext, SetMetadata } from '@nestjs/common';
import type { Permission } from '@divine/shared';
import type { AccessContext } from './access-context.js';

/**
 * Endpoint xavfsizligini e'lon qilish (RBAC §4). Har bir endpoint AYNAN bittasini oladi —
 * `RouteSecurityAuditor` decorator'siz endpoint bo'lsa ilovani ishga tushirmaydi (deny by default).
 */
export const PUBLIC_KEY = 'divine:auth:public';
export const AUTHENTICATED_KEY = 'divine:auth:authenticated';
export const PERMISSIONS_ALL_KEY = 'divine:auth:permissions-all';
export const PERMISSIONS_ANY_KEY = 'divine:auth:permissions-any';

export const SECURITY_METADATA_KEYS = [
  PUBLIC_KEY,
  AUTHENTICATED_KEY,
  PERMISSIONS_ALL_KEY,
  PERMISSIONS_ANY_KEY,
] as const;

/** Autentifikatsiyasiz endpoint (masalan, `POST /auth/login`, `GET /health`). */
export const Public = () => SetMetadata(PUBLIC_KEY, true);

/** Har qanday tizimga kirgan user (permission talab qilinmaydi), masalan `GET /auth/me`. */
export const Authenticated = () => SetMetadata(AUTHENTICATED_KEY, true);

/** Barcha permissionlar kerak (AND). */
export const RequirePermissions = (...permissions: [Permission, ...Permission[]]) =>
  SetMetadata(PERMISSIONS_ALL_KEY, permissions);

/** Kamida bittasi kerak (OR), masalan `sales.read_all | sales.read_own`. */
export const RequireAnyPermission = (...permissions: [Permission, ...Permission[]]) =>
  SetMetadata(PERMISSIONS_ANY_KEY, permissions);

/** Joriy user konteksti: `handler(@Ctx() ctx: AccessContext)`. Faqat himoyalangan endpointlarda. */
export const Ctx = createParamDecorator(
  (_data: unknown, context: ExecutionContext): AccessContext => {
    const ctx = context
      .switchToHttp()
      .getRequest<{ accessContext?: AccessContext }>().accessContext;
    if (!ctx)
      throw new Error('AccessContext yo‘q: @Ctx() faqat himoyalangan endpointlarda ishlatiladi');
    return ctx;
  },
);
