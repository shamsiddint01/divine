import {
  type MiddlewareConsumer,
  Module,
  type NestModule,
  type OnModuleInit,
  RequestMethod,
} from '@nestjs/common';
import { APP_GUARD, DiscoveryModule } from '@nestjs/core';
import { PermissionsGuard } from '../../common/auth/permissions.guard.js';
import { RouteSecurityAuditor } from '../../common/auth/route-security.auditor.js';
import { AppThrottlerGuard } from '../../common/throttling/app-throttler.guard.js';
import { APP_CONFIG } from '../../config/config.module.js';
import type { AppConfig } from '../../config/env.schema.js';
import { AccessTokenMiddleware } from './access-token.middleware.js';
import { AuthController } from './auth.controller.js';
import { AuthRepository } from './auth.repository.js';
import { AuthService } from './auth.service.js';
import { JwtAuthGuard } from './jwt-auth.guard.js';
import { PasswordHasher } from './password/password-hasher.js';
import { SessionCleanupJob } from './session-cleanup.job.js';
import { TokenService } from './token.service.js';
import { UnknownLoginLockout } from './unknown-login-lockout.js';

/**
 * Autentifikatsiya va RBAC (Phase 4). Global guard'lar shu yerda, ANIQ tartibda (ARCHITECTURE §9):
 * 1) rate limit → 2) JwtAuthGuard (kim?) → 3) PermissionsGuard (ruxsat bormi?).
 * `AccessTokenMiddleware` guard'lardan oldin token imzosini tekshiradi (rate limit user bo'yicha bo'lsin).
 */
@Module({
  imports: [DiscoveryModule],
  controllers: [AuthController],
  providers: [
    AuthService,
    AuthRepository,
    TokenService,
    UnknownLoginLockout,
    SessionCleanupJob,
    RouteSecurityAuditor,
    {
      provide: PasswordHasher,
      inject: [APP_CONFIG],
      useFactory: (config: AppConfig) =>
        new PasswordHasher(config.PASSWORD_PEPPER, config.PASSWORD_PEPPER_V2),
    },
    { provide: APP_GUARD, useClass: AppThrottlerGuard },
    { provide: APP_GUARD, useClass: JwtAuthGuard },
    { provide: APP_GUARD, useClass: PermissionsGuard },
  ],
  exports: [PasswordHasher, TokenService],
})
export class AuthModule implements NestModule, OnModuleInit {
  constructor(private readonly hasher: PasswordHasher) {}

  configure(consumer: MiddlewareConsumer): void {
    consumer
      .apply(AccessTokenMiddleware)
      .forRoutes({ path: '{*splat}', method: RequestMethod.ALL });
  }

  /** Mavjud bo'lmagan login uchun soxta hash oldindan — birinchi so'rov javob vaqti bilan farq qilmasin. */
  async onModuleInit(): Promise<void> {
    await this.hasher.warmUp();
  }
}
