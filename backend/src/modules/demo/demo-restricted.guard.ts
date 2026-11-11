import { type CanActivate, type ExecutionContext, Injectable } from '@nestjs/common';
import { ErrorCode } from '@divine/shared';
import type { AuthRequest } from '../../common/auth/request-types.js';
import { AppError } from '../../common/errors/app-error.js';
import { DemoUsageService } from './demo-usage.service.js';

/**
 * Demo saytda sinov hisobi uchun yopiq amallar (foydalanuvchi qo'shish, o'zgartirish, bloklash):
 * `403 DEMO_RESTRICTED`. Sinov yozuvi yo'q hisob (egasining o'z admini) cheklanmaydi (2026-11-11).
 */
@Injectable()
export class DemoRestrictedGuard implements CanActivate {
  constructor(private readonly demo: DemoUsageService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    if (!this.demo.enabled) return true;
    const userId = context.switchToHttp().getRequest<AuthRequest>().accessContext?.userId;
    if (!userId || (await this.demo.isTrial(userId))) {
      throw new AppError(ErrorCode.DEMO_RESTRICTED);
    }
    return true;
  }
}
