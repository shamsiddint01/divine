import { Controller, Delete, Get, HttpCode, Param, Patch, Post, Req, Res, UseGuards } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import {
  type ControlLoginInput,
  controlLoginSchema,
  type ControlPaymentInput,
  controlPaymentSchema,
  type ControlSiteCreateInput,
  controlSiteCreateSchema,
  type ControlSiteUpdateInput,
  controlSiteUpdateSchema,
  type SiteViewVerifyInput,
  siteViewVerifySchema,
} from '@divine/shared';
import type { Request, Response } from 'express';
import { Public } from '../../common/auth/auth.decorators.js';
import { RateLimitGroup } from '../../common/throttling/app-throttler.guard.js';
import { ZodBody } from '../../common/validation/zod-validation.pipe.js';
import { InjectConfig } from '../../config/config.module.js';
import type { AppConfig } from '../../config/env.schema.js';
import { assertCsrfSafe } from '../auth/auth.http.js';
import { CONTROL_TTL_SECONDS } from '../auth/token.service.js';
import {
  CONTROL_COOKIE,
  CONTROL_COOKIE_PATH,
  ControlEnabledGuard,
  ControlSessionGuard,
} from './control.guard.js';
import { ControlService } from './control.service.js';

const cookieOptions = (config: AppConfig) => ({
  httpOnly: true,
  secure: config.AUTH_COOKIE_SECURE,
  sameSite: 'strict' as const,
  path: CONTROL_COOKIE_PATH,
});

/** Superadmin kirishi: `users`dan alohida hisob, sessiya HttpOnly cookie'da. */
@ApiTags('Control')
@Public()
@UseGuards(ControlEnabledGuard)
@Controller('control/auth')
export class ControlAuthController {
  constructor(
    private readonly control: ControlService,
    @InjectConfig() private readonly config: AppConfig,
  ) {}

  @Post('login')
  @RateLimitGroup('login')
  @HttpCode(204)
  @ApiOperation({ summary: 'Superadmin kirishi' })
  async login(
    @ZodBody(controlLoginSchema) body: ControlLoginInput,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ): Promise<void> {
    assertCsrfSafe(req, this.config);
    const token = await this.control.login(body);
    res.cookie(CONTROL_COOKIE, token, {
      ...cookieOptions(this.config),
      maxAge: CONTROL_TTL_SECONDS * 1000,
    });
  }

  @Post('logout')
  @HttpCode(204)
  @ApiOperation({ summary: 'Superadmin chiqishi' })
  logout(@Req() req: Request, @Res({ passthrough: true }) res: Response): void {
    assertCsrfSafe(req, this.config);
    res.cookie(CONTROL_COOKIE, '', { ...cookieOptions(this.config), maxAge: 0 });
  }
}

/** Mijoz saytlari, kelishuv, to'lovlar va ko'rish so'rovi. */
@ApiTags('Control')
@Public()
@UseGuards(ControlEnabledGuard, ControlSessionGuard)
@Controller('control/sites')
export class ControlSitesController {
  constructor(private readonly control: ControlService) {}

  @Get()
  @ApiOperation({ summary: 'Saytlar ro‘yxati' })
  list() {
    return this.control.list();
  }

  @Post()
  @ApiOperation({ summary: 'Sayt qo‘shish' })
  create(@ZodBody(controlSiteCreateSchema) body: ControlSiteCreateInput) {
    return this.control.create(body);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Sayt tafsiloti va to‘lovlar tarixi' })
  get(@Param('id') id: string) {
    return this.control.get(id);
  }

  @Patch(':id')
  @ApiOperation({ summary: 'Kelishuv va egasi nomini o‘zgartirish' })
  update(@Param('id') id: string, @ZodBody(controlSiteUpdateSchema) body: ControlSiteUpdateInput) {
    return this.control.update(id, body);
  }

  @Post(':id/payments')
  @ApiOperation({ summary: 'To‘lov yozish (muddat uzayadi)' })
  addPayment(@Param('id') id: string, @ZodBody(controlPaymentSchema) body: ControlPaymentInput) {
    return this.control.addPayment(id, body);
  }

  @Delete(':id/payments/:paymentId')
  @ApiOperation({ summary: 'Adashib yozilgan to‘lovni o‘chirish' })
  deletePayment(@Param('id') id: string, @Param('paymentId') paymentId: string) {
    return this.control.deletePayment(id, paymentId);
  }

  @Post(':id/sync')
  @HttpCode(200)
  @ApiOperation({ summary: 'Muddatni saytga qayta yuborish' })
  sync(@Param('id') id: string) {
    return this.control.sync(id);
  }

  @Post(':id/view-requests')
  @ApiOperation({ summary: 'Adminga ko‘rish so‘rovi' })
  requestView(@Param('id') id: string) {
    return this.control.requestView(id);
  }

  @Post(':id/view-requests/:requestId/verify')
  @HttpCode(200)
  @ApiOperation({ summary: 'Admin aytgan kod bilan ko‘rish havolasini olish' })
  verifyView(
    @Param('id') id: string,
    @Param('requestId') requestId: string,
    @ZodBody(siteViewVerifySchema) body: SiteViewVerifyInput,
  ) {
    return this.control.verifyView(id, requestId, body.code);
  }
}
