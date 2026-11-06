import type { Request } from 'express';
import type { RoleCode } from '@divine/shared';
import type { AccessContext } from './access-context.js';

/**
 * So'rovga auth qatlami biriktiradigan ma'lumotlar:
 * - `authToken` — `AccessTokenMiddleware`: Bearer token imzosi va muddati tekshirilgan (DB'siz).
 *   Throttler user bo'yicha limit uchun, JwtAuthGuard to'liq tekshiruv uchun ishlatadi.
 * - `accessContext` — `JwtAuthGuard`: DB'dan yig'ilgan to'liq kontekst (status, permissionlar, omborlar).
 */
export type AuthRequest = Request & {
  id?: unknown;
  authToken?: { sub: string; role: RoleCode; iat: number; view?: boolean };
  accessContext?: AccessContext;
};
