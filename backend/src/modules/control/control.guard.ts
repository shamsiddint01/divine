import { type CanActivate, type ExecutionContext, Injectable } from '@nestjs/common';
import { ErrorCode } from '@divine/shared';
import type { Request } from 'express';
import { AppError } from '../../common/errors/app-error.js';
import { Clock } from '../../common/time/clock.js';
import { InjectConfig } from '../../config/config.module.js';
import type { AppConfig } from '../../config/env.schema.js';
import { assertCsrfSafe } from '../auth/auth.http.js';
import { TokenService } from '../auth/token.service.js';

export const CONTROL_COOKIE = 'dv_control';
export const CONTROL_COOKIE_PATH = '/api/v1/control';

export function readControlCookie(req: Request): string | undefined {
  for (const part of (req.headers.cookie ?? '').split(';')) {
    const index = part.indexOf('=');
    if (index !== -1 && part.slice(0, index).trim() === CONTROL_COOKIE) {
      return part.slice(index + 1).trim() || undefined;
    }
  }
  return undefined;
}

/** Panel o'chiq saytda `/control/*` umuman yo'qdek: 404. */
@Injectable()
export class ControlEnabledGuard implements CanActivate {
  constructor(@InjectConfig() private readonly config: AppConfig) {}

  canActivate(): boolean {
    if (!this.config.CONTROL_PANEL_ENABLED) throw new AppError(ErrorCode.NOT_FOUND);
    return true;
  }
}

/** Superadmin sessiyasi: HttpOnly cookie; yozish so'rovlarida CSRF tekshiruvi (SECURITY §9). */
@Injectable()
export class ControlSessionGuard implements CanActivate {
  constructor(
    private readonly tokens: TokenService,
    private readonly clock: Clock,
    @InjectConfig() private readonly config: AppConfig,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const req = context.switchToHttp().getRequest<Request>();
    const token = readControlCookie(req);
    const adminId = token && (await this.tokens.verifyControlToken(token, this.clock.now()));
    if (!adminId) throw new AppError(ErrorCode.UNAUTHENTICATED);
    if (req.method !== 'GET') assertCsrfSafe(req, this.config);
    return true;
  }
}
