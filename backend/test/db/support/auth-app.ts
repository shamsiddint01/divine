/**
 * Auth integration testlari uchun: HAQIQIY AppModule + haqiqiy PostgreSQL (Testcontainers) va Redis,
 * boshqariladigan soat (`ManualClock`) va faqat test uchun RBAC probe endpointlari.
 */
import 'reflect-metadata';
import { Controller, Get, Module, Param } from '@nestjs/common';
import type { NestExpressApplication } from '@nestjs/platform-express';
import type { DestinationStream } from 'pino';
import { Test } from '@nestjs/testing';
import { Permission, type RoleCode, type UserStatus } from '@divine/shared';
import request from 'supertest';
import { inject } from 'vitest';
import { AppModule } from '../../../src/app.module.js';
import { configureApp } from '../../../src/bootstrap/configure-app.js';
import {
  type AccessContext,
  assertWarehouseAccess,
} from '../../../src/common/auth/access-context.js';
import {
  Authenticated,
  Ctx,
  RequireAnyPermission,
  RequirePermissions,
} from '../../../src/common/auth/auth.decorators.js';
import { Clock, ManualClock } from '../../../src/common/time/clock.js';
import { APP_CONFIG } from '../../../src/config/config.module.js';
import { type AppConfig, parseConfig } from '../../../src/config/env.schema.js';
import { LOG_STREAM } from '../../../src/infrastructure/logger/logger.module.js';
import { PrismaService } from '../../../src/infrastructure/prisma/prisma.service.js';
import { PasswordHasher } from '../../../src/modules/auth/password/password-hasher.js';

export const ORIGIN = 'http://localhost:5180';

/** Faqat test uchun: har xil himoya turlaridagi endpointlar (RBAC §4). */
@Controller('__rbac')
class RbacProbeController {
  @Get('users-manage')
  @RequirePermissions(Permission.USERS_MANAGE)
  usersManage() {
    return { ok: true };
  }

  @Get('sales-any')
  @RequireAnyPermission(Permission.SALES_READ_ALL, Permission.SALES_READ_OWN)
  salesAny() {
    return { ok: true };
  }

  @Get('reports-and-audit')
  @RequirePermissions(Permission.REPORTS_READ, Permission.AUDIT_READ)
  both() {
    return { ok: true };
  }

  @Get('context')
  @Authenticated()
  context(@Ctx() ctx: AccessContext) {
    return {
      userId: ctx.userId,
      role: ctx.role,
      permissions: [...ctx.permissions].sort(),
      warehouseIds: [...ctx.warehouseIds].sort(),
    };
  }

  @Get('warehouses/:id')
  @Authenticated()
  warehouse(@Ctx() ctx: AccessContext, @Param('id') id: string) {
    assertWarehouseAccess(ctx, id);
    return { ok: true };
  }
}

@Module({ controllers: [RbacProbeController] })
class RbacProbeModule {}

export interface AuthTestApp {
  app: NestExpressApplication;
  clock: ManualClock;
  prisma: PrismaService;
  hasher: PasswordHasher;
  config: AppConfig;
  close(): Promise<void>;
}

/**
 * `databaseUrl` — alohida toza DB (`freshDatabase`); berilmasa umumiy test DB.
 * `logStream` — log yozuvlarini ushlash (Phase 16 log grep testi; `config.LOG_LEVEL` bilan birga).
 * `config` — sozlamalarni almashtirish (masalan, `NODE_ENV: 'production'` header'lari).
 */
export async function createAuthApp(
  options: {
    databaseUrl?: string;
    logStream?: DestinationStream;
    config?: Partial<AppConfig>;
  } = {},
): Promise<AuthTestApp> {
  const config: AppConfig = {
    ...parseConfig({
      ...process.env,
      DATABASE_URL: options.databaseUrl ?? inject('databaseUrl'),
      REDIS_URL: inject('redisUrl'),
      JWT_ACCESS_SECRET: 'test-access-secret-0123456789-abcdefghij',
      PASSWORD_PEPPER: 'test-password-pepper-0123456789-abcdefghij',
    }),
    LOG_LEVEL: 'silent',
    CORS_ORIGINS: [ORIGIN],
    // Testlar har xil "mijoz IP"larini X-Forwarded-For orqali beradi (ishonchli proxy ortida).
    TRUST_PROXY: 1,
    AUTH_COOKIE_SECURE: true,
    ...options.config,
  };
  const clock = new ManualClock(new Date('2026-10-09T08:00:00.000Z'));
  const builder = Test.createTestingModule({ imports: [AppModule, RbacProbeModule] })
    .overrideProvider(APP_CONFIG)
    .useValue(config)
    .overrideProvider(Clock)
    .useValue(clock);
  if (options.logStream) builder.overrideProvider(LOG_STREAM).useValue(options.logStream);
  const moduleRef = await builder.compile();
  const app = moduleRef.createNestApplication<NestExpressApplication>({ logger: false });
  configureApp(app, config);
  await app.init();
  return {
    app,
    clock,
    config,
    prisma: app.get(PrismaService),
    hasher: app.get(PasswordHasher),
    close: () => app.close(),
  };
}

let seq = 0;
export const uniqueLogin = (prefix = 'u') =>
  `${prefix}${Date.now().toString(36)}${(seq++).toString(36)}`;
/**
 * Har bir test o'z "mijoz IP"si bilan — login rate limit (10/daq/IP) testlarni aralashtirmasin.
 * Rate limit hisoblagichlari umumiy Redis'da: har bir test fayli o'z tasodifiy `10.B.x.y` blokida,
 * shunda ketma-ket fayllar bir daqiqa ichida bir xil IP'ni qayta ishlatmaydi (ilgari 250 ta umumiy IP edi).
 */
const IP_BLOCK = 1 + Math.floor(Math.random() * 254);
export const uniqueIp = () => {
  const n = (seq++ % 65_000) + 1;
  return `10.${IP_BLOCK}.${Math.floor(n / 256)}.${n % 256}`;
};

export async function createUser(
  t: AuthTestApp,
  opts: {
    password: string;
    role?: RoleCode;
    status?: UserStatus;
    warehouseIds?: string[];
    login?: string;
  },
) {
  const login = opts.login ?? uniqueLogin();
  const user = await t.prisma.user.create({
    data: {
      login,
      passwordHash: await t.hasher.hash(opts.password),
      fullName: 'Test Foydalanuvchi',
      // Test soati (ManualClock) bilan mos: DB `now()` (haqiqiy vaqt) token `iat`idan keyin bo'lib,
      // token "parol o'zgarishidan oldin berilgan" deb rad etilmasin.
      passwordChangedAt: new Date(t.clock.now().getTime() - 86_400_000),
      status: opts.status ?? 'ACTIVE',
      role: { connect: { code: opts.role ?? 'USER' } },
    },
  });
  for (const warehouseId of opts.warehouseIds ?? []) {
    await t.prisma.userWarehouse.create({
      data: { userId: user.id, warehouseId, createdById: user.id },
    });
  }
  return user;
}

export function login(t: AuthTestApp, body: object, ip = uniqueIp()) {
  return request(t.app.getHttpServer())
    .post('/api/v1/auth/login')
    .set('X-Forwarded-For', ip)
    .send(body);
}

/** Login javobidagi `dv_refresh` cookie qiymati. */
export function refreshCookieOf(res: request.Response): string {
  const header = ([] as string[])
    .concat(res.headers['set-cookie'] ?? [])
    .find((c) => c.startsWith('dv_refresh='));
  if (!header) throw new Error('dv_refresh cookie yo‘q');
  return header.split(';')[0]!;
}

export function refresh(
  t: AuthTestApp,
  cookie: string | undefined,
  headers: Record<string, string> = {},
) {
  const req = request(t.app.getHttpServer())
    .post('/api/v1/auth/refresh')
    .set('X-Forwarded-For', uniqueIp())
    .set('Origin', ORIGIN)
    .set('X-Requested-With', 'XMLHttpRequest');
  if (cookie) req.set('Cookie', cookie);
  for (const [key, value] of Object.entries(headers)) req.set(key, value);
  return req;
}
