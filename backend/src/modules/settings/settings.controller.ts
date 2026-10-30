import { Controller, Get, Patch, Req } from '@nestjs/common';
import { ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import {
  ErrorCode,
  Permission,
  type SettingsDto,
  type SettingsUpdateInput,
  settingsUpdateSchema,
} from '@divine/shared';
import type { Request } from 'express';
import type { AccessContext } from '../../common/auth/access-context.js';
import { Ctx, RequirePermissions } from '../../common/auth/auth.decorators.js';
import { ApiErrorResponses } from '../../common/swagger/api-schemas.js';
import { ZodBody } from '../../common/validation/zod-validation.pipe.js';
import { requestMeta } from '../auth/auth.http.js';
import { SettingsService } from './settings.service.js';

/** Sozlamalar (Phase 12, API §16): o'qish — `settings.read`, o'zgartirish — `settings.manage`. */
@ApiTags('Settings')
@Controller('settings')
export class SettingsController {
  constructor(private readonly settings: SettingsService) {}

  @Get()
  @RequirePermissions(Permission.SETTINGS_READ)
  @ApiOperation({ summary: 'Sozlamalar' })
  @ApiOkResponse({ description: 'SettingsDto' })
  @ApiErrorResponses(ErrorCode.FORBIDDEN)
  get(): Promise<SettingsDto> {
    return this.settings.get();
  }

  @Patch()
  @RequirePermissions(Permission.SETTINGS_MANAGE)
  @ApiOperation({ summary: 'Sozlamalarni o‘zgartirish (qisman)' })
  @ApiErrorResponses(ErrorCode.VALIDATION_ERROR, ErrorCode.FORBIDDEN)
  update(
    @Ctx() ctx: AccessContext,
    @ZodBody(settingsUpdateSchema) body: SettingsUpdateInput,
    @Req() req: Request,
  ): Promise<SettingsDto> {
    return this.settings.update(ctx, body, requestMeta(req));
  }
}
