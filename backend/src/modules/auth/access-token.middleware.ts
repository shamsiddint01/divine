import { Injectable, type NestMiddleware } from '@nestjs/common';
import type { NextFunction, Response } from 'express';
import type { AuthRequest } from '../../common/auth/request-types.js';
import { Clock } from '../../common/time/clock.js';
import { TokenService } from './token.service.js';

/**
 * Har so'rovda (guard'lardan OLDIN): `Authorization: Bearer …` bo'lsa, imzo, algoritm, iss/aud va
 * muddat tekshiriladi; to'g'ri bo'lsa `req.authToken` qo'yiladi. DB'ga murojaat yo'q.
 * Maqsad: rate limiter user bo'yicha kalitni bilishi (guard tartibidan qat'i nazar). To'liq tekshiruv
 * (user ACTIVE, password_changed_at, permissionlar) — JwtAuthGuard'da. Yaroqsiz token xato emas: himoyalangan
 * endpoint uni JwtAuthGuard'da `401` bilan rad etadi, public endpoint esa e'tiborsiz qoldiradi.
 */
@Injectable()
export class AccessTokenMiddleware implements NestMiddleware {
  constructor(
    private readonly tokens: TokenService,
    private readonly clock: Clock,
  ) {}

  async use(req: AuthRequest, _res: Response, next: NextFunction): Promise<void> {
    const header = req.headers.authorization;
    if (typeof header === 'string' && header.startsWith('Bearer ')) {
      const claims = await this.tokens.verifyAccessToken(header.slice(7).trim(), this.clock.now());
      if (claims) req.authToken = claims;
    }
    next();
  }
}
