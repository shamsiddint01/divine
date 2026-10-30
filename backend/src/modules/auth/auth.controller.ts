import { Controller, Get, HttpCode, Post, Req, Res } from '@nestjs/common';
import { ApiOkResponse, ApiOperation, ApiResponse, ApiTags, getSchemaPath } from '@nestjs/swagger';
import {
  type CurrentUser,
  ErrorCode,
  loginRequestSchema,
  type LoginRequest,
  type LoginResponse,
} from '@divine/shared';
import type { Request, Response } from 'express';
import type { AccessContext } from '../../common/auth/access-context.js';
import { Authenticated, Ctx, Public } from '../../common/auth/auth.decorators.js';
import { AppError } from '../../common/errors/app-error.js';
import { ApiErrorBodyDto, ApiErrorResponses } from '../../common/swagger/api-schemas.js';
import { RateLimitGroup } from '../../common/throttling/app-throttler.guard.js';
import { Clock } from '../../common/time/clock.js';
import { ZodBody } from '../../common/validation/zod-validation.pipe.js';
import { InjectConfig } from '../../config/config.module.js';
import type { AppConfig } from '../../config/env.schema.js';
import {
  assertCsrfSafe,
  clearRefreshCookie,
  readRefreshCookie,
  requestMeta,
  setRefreshCookie,
} from './auth.http.js';
import { AccountLockedError, AuthService, type IssuedSession } from './auth.service.js';

/**
 * Auth endpointlari (API §3). Controller faqat HTTP bilan ishlaydi: cookie, CSRF, header'lar.
 * Token va sessiya javoblari keshlanmaydi (`Cache-Control: no-store`).
 */
@ApiTags('Auth')
@Controller('auth')
export class AuthController {
  constructor(
    private readonly auth: AuthService,
    private readonly clock: Clock,
    @InjectConfig() private readonly config: AppConfig,
  ) {}

  @Post('login')
  @Public()
  @RateLimitGroup('login')
  @HttpCode(200)
  @ApiOperation({ summary: 'Tizimga kirish (login + 6 xonali parol)' })
  @ApiErrorResponses(
    ErrorCode.VALIDATION_ERROR,
    ErrorCode.INVALID_CREDENTIALS,
    ErrorCode.ACCOUNT_LOCKED,
  )
  @ApiResponse({
    status: 403,
    description: 'ACCOUNT_BLOCKED — to‘g‘ri parol, lekin user bloklangan',
    schema: { $ref: getSchemaPath(ApiErrorBodyDto) },
  })
  async login(
    @ZodBody(loginRequestSchema) body: LoginRequest,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ): Promise<LoginResponse> {
    res.setHeader('Cache-Control', 'no-store');
    try {
      return this.issue(res, await this.auth.login(body, requestMeta(req)));
    } catch (error) {
      if (error instanceof AccountLockedError) {
        res.setHeader('Retry-After', String(error.retryAfterSeconds));
      }
      throw error;
    }
  }

  @Post('refresh')
  @Public()
  @RateLimitGroup('refresh')
  @HttpCode(200)
  @ApiOperation({ summary: 'Access tokenni yangilash (refresh cookie, rotation)' })
  @ApiErrorResponses(ErrorCode.SESSION_EXPIRED, ErrorCode.FORBIDDEN)
  async refresh(
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ): Promise<LoginResponse> {
    res.setHeader('Cache-Control', 'no-store');
    assertCsrfSafe(req, this.config);
    try {
      return this.issue(res, await this.auth.refresh(readRefreshCookie(req), requestMeta(req)));
    } catch (error) {
      if (error instanceof AppError && error.status === 401) clearRefreshCookie(res, this.config);
      throw error;
    }
  }

  @Post('logout')
  @Public()
  @HttpCode(204)
  @ApiOperation({ summary: 'Tizimdan chiqish (joriy sessiya bekor qilinadi)' })
  @ApiErrorResponses(ErrorCode.FORBIDDEN)
  async logout(@Req() req: Request, @Res({ passthrough: true }) res: Response): Promise<void> {
    assertCsrfSafe(req, this.config);
    await this.auth.logout(readRefreshCookie(req), requestMeta(req));
    clearRefreshCookie(res, this.config);
  }

  @Get('me')
  @Authenticated()
  @ApiOperation({ summary: 'Joriy foydalanuvchi, rol, permissionlar va omborlar' })
  @ApiOkResponse({ description: 'CurrentUser' })
  @ApiErrorResponses(ErrorCode.UNAUTHENTICATED)
  me(@Ctx() ctx: AccessContext, @Res({ passthrough: true }) res: Response): Promise<CurrentUser> {
    res.setHeader('Cache-Control', 'no-store');
    return this.auth.me(ctx.userId);
  }

  private issue(res: Response, session: IssuedSession): LoginResponse {
    setRefreshCookie(
      res,
      this.config,
      session.refreshToken,
      session.refreshExpiresAt,
      this.clock.now(),
    );
    return session.response;
  }
}
