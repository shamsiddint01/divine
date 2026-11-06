import { createHmac, timingSafeEqual } from 'node:crypto';
import { type CanActivate, type ExecutionContext, Injectable } from '@nestjs/common';
import { ErrorCode } from '@divine/shared';
import type { Request } from 'express';
import { AppError } from '../../common/errors/app-error.js';
import { InjectConfig } from '../../config/config.module.js';
import type { AppConfig } from '../../config/env.schema.js';

export const CONTROL_TOKEN_HEADER = 'x-control-token';

/** Saytning `/site-control` kaliti: alohida berilmasa, saytning o'z secret'idan hosil qilinadi. */
export function controlApiToken(
  config: Pick<AppConfig, 'CONTROL_API_TOKEN' | 'JWT_ACCESS_SECRET'>,
): string {
  return (
    config.CONTROL_API_TOKEN ??
    createHmac('sha256', config.JWT_ACCESS_SECRET).update('divine.uz/site-control').digest('hex')
  );
}

/** Superadmin panelidan keladigan so'rovlar: kalit sarlavhada, taqqoslash doimiy vaqtda. */
@Injectable()
export class ControlTokenGuard implements CanActivate {
  private readonly token: Buffer;

  constructor(@InjectConfig() config: AppConfig) {
    this.token = Buffer.from(controlApiToken(config));
  }

  canActivate(context: ExecutionContext): boolean {
    const header = context.switchToHttp().getRequest<Request>().headers[CONTROL_TOKEN_HEADER];
    const given = Buffer.from(typeof header === 'string' ? header : '');
    if (given.length !== this.token.length || !timingSafeEqual(given, this.token)) {
      throw new AppError(ErrorCode.FORBIDDEN);
    }
    return true;
  }
}
