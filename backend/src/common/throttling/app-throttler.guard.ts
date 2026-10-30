import { type ExecutionContext, Injectable, SetMetadata } from '@nestjs/common';
import {
  SkipThrottle,
  ThrottlerGuard,
  type ThrottlerLimitDetail,
  type ThrottlerOptions,
} from '@nestjs/throttler';
import { ErrorCode } from '@divine/shared';
import type { Response } from 'express';
import type { AuthRequest } from '../auth/request-types.js';
import { AppError } from '../errors/app-error.js';

const WRITE_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);
const RATE_LIMIT_GROUP_KEY = 'divine:rate-limit-group';

export type RateLimitGroupName = 'login' | 'refresh';

/**
 * Endpointga alohida (qattiqroq) IP limiti: `@RateLimitGroup('login')` — 10/daq, `'refresh'` — 30/daq
 * (API §1.5, SECURITY §4, §7). Umumiy limitlar ham amal qilishda davom etadi.
 */
export const RateLimitGroup = (group: RateLimitGroupName) =>
  SetMetadata(RATE_LIMIT_GROUP_KEY, group);

const requestOf = (context: ExecutionContext) => context.switchToHttp().getRequest<AuthRequest>();
/** `AccessTokenMiddleware` imzosini tekshirgan token bo'lsa — user (DB tekshiruvi JwtAuthGuard'da). */
const isAuthenticated = (context: ExecutionContext) => Boolean(requestOf(context).authToken?.sub);
const isWrite = (context: ExecutionContext) => WRITE_METHODS.has(requestOf(context).method);
const groupOf = (context: ExecutionContext): RateLimitGroupName | undefined =>
  Reflect.getMetadata(RATE_LIMIT_GROUP_KEY, context.getHandler()) as RateLimitGroupName | undefined;
const ipTracker = (req: Record<string, unknown>) =>
  `ip:${(req as unknown as AuthRequest).ip ?? 'unknown'}`;

const MINUTE = 60_000;

/**
 * Rate limit guruhlari (API §1.5, SECURITY §7):
 * - `anonymous` — autentifikatsiyasiz so'rovlar, IP bo'yicha 60/daq;
 * - `read` / `write` — autentifikatsiyalangan user bo'yicha 600 / 120 daq (kalit — user ID);
 * - `login` / `refresh` — faqat `@RateLimitGroup` belgilangan endpointlarda, doim IP bo'yicha.
 * Health-check (`@SkipThrottle`) cheklanmaydi — orkestrator probe'lari 429 olmasin.
 */
export const THROTTLERS: ThrottlerOptions[] = [
  { name: 'anonymous', ttl: MINUTE, limit: 60, skipIf: (ctx) => isAuthenticated(ctx) },
  {
    name: 'read',
    ttl: MINUTE,
    limit: 600,
    skipIf: (ctx) => !isAuthenticated(ctx) || isWrite(ctx),
  },
  {
    name: 'write',
    ttl: MINUTE,
    limit: 120,
    skipIf: (ctx) => !isAuthenticated(ctx) || !isWrite(ctx),
  },
  {
    name: 'login',
    ttl: MINUTE,
    limit: 10,
    skipIf: (ctx) => groupOf(ctx) !== 'login',
    getTracker: ipTracker,
  },
  {
    name: 'refresh',
    ttl: MINUTE,
    limit: 30,
    skipIf: (ctx) => groupOf(ctx) !== 'refresh',
    getTracker: ipTracker,
  },
];

/**
 * Barcha nomli limitlardan ozod qilish. `@SkipThrottle()` standart holatda faqat `default` nomli
 * throttler'ni o'tkazib yuboradi — bizda nomli throttler'lar, shuning uchun hammasi aniq sanaladi.
 */
export const SkipAllThrottles = () =>
  SkipThrottle(Object.fromEntries(THROTTLERS.map((throttler) => [throttler.name!, true])));

@Injectable()
export class AppThrottlerGuard extends ThrottlerGuard {
  /**
   * Kalit: tekshirilgan access token bo'lsa `user:<id>`, aks holda `ip:<req.ip>`. `req.ip` Express
   * `trust proxy` (= `TRUST_PROXY`) bo'yicha: proksisiz `X-Forwarded-For` e'tiborga olinmaydi.
   */
  protected override async getTracker(req: Record<string, unknown>): Promise<string> {
    const request = req as unknown as AuthRequest;
    return request.authToken?.sub ? `user:${request.authToken.sub}` : ipTracker(req);
  }

  /** `429 RATE_LIMITED` + standart `Retry-After` (soniya) — yagona xato strukturasi bilan. */
  protected override async throwThrottlingException(
    context: ExecutionContext,
    detail: ThrottlerLimitDetail,
  ): Promise<void> {
    const res = context.switchToHttp().getResponse<Response>();
    res.setHeader('Retry-After', String(Math.max(1, detail.timeToBlockExpire)));
    throw new AppError(ErrorCode.RATE_LIMITED);
  }
}
