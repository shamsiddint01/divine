import { type CanActivate, Injectable } from '@nestjs/common';
import { ErrorCode } from '@divine/shared';
import { AppError } from '../../common/errors/app-error.js';
import { InjectConfig } from '../../config/config.module.js';
import type { AppConfig } from '../../config/env.schema.js';

/** Demo saytda yopiq amallar (foydalanuvchi qo'shish, o'zgartirish, bloklash): `403 DEMO_RESTRICTED`. */
@Injectable()
export class DemoRestrictedGuard implements CanActivate {
  constructor(@InjectConfig() private readonly config: AppConfig) {}

  canActivate(): boolean {
    if (this.config.DEMO_MODE) throw new AppError(ErrorCode.DEMO_RESTRICTED);
    return true;
  }
}
