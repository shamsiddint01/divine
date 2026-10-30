import 'reflect-metadata';
import { Writable } from 'node:stream';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { Test } from '@nestjs/testing';
import type { ThrottlerStorage } from '@nestjs/throttler';
import { AppModule } from '../../../src/app.module.js';
import { configureApp } from '../../../src/bootstrap/configure-app.js';
import { RedisThrottlerStorage } from '../../../src/common/throttling/redis-throttler.storage.js';
import { APP_CONFIG } from '../../../src/config/config.module.js';
import { parseConfig, type AppConfig } from '../../../src/config/env.schema.js';
import { LOG_STREAM } from '../../../src/infrastructure/logger/logger.module.js';
import { PrismaService } from '../../../src/infrastructure/prisma/prisma.service.js';
import { RedisService } from '../../../src/infrastructure/redis/redis.service.js';
import { HealthRepository } from '../../../src/modules/health/health.repository.js';
import { ProbeModule } from './probe.module.js';

export interface TestApp {
  app: NestExpressApplication;
  /** pino yozgan har bir JSON log qatori (parse qilingan). */
  logs: Record<string, unknown>[];
  /** Xom log matni — sizib chiqish tekshiruvlari uchun. */
  rawLogs: () => string;
  health: { database: boolean; redis: boolean };
}

/**
 * Haqiqiy AppModule + production bilan bir xil `configureApp()` + test-only ProbeModule.
 * Tashqi tizimlar almashtiriladi: PostgreSQL/Redis (health), rate limit storage — xotirada.
 * Log'lar `LOG_STREAM` orqali ushlanadi.
 */
/** Hech qachon bloklamaydigan storage — rate limit'ga bog'liq bo'lmagan testlar uchun. */
const NEVER_BLOCK: ThrottlerStorage = {
  increment: async (_key, ttl) => ({
    totalHits: 1,
    timeToExpire: Math.ceil(ttl / 1000),
    isBlocked: false,
    timeToBlockExpire: 0,
  }),
};

export async function createTestApp(
  options: { throttlerStorage?: ThrottlerStorage } = {},
): Promise<TestApp> {
  const lines: string[] = [];
  const stream = new Writable({
    write(chunk: Buffer, _encoding, callback) {
      lines.push(...chunk.toString().split('\n').filter(Boolean));
      callback();
    },
  });
  const health = { database: true, redis: true };

  const moduleRef = await Test.createTestingModule({ imports: [AppModule, ProbeModule] })
    // Log'larni tekshirish uchun `info` darajasi (vitest.config.ts'da standart — silent).
    .overrideProvider(APP_CONFIG)
    .useValue({ ...parseConfig(), LOG_LEVEL: 'info' } satisfies AppConfig)
    .overrideProvider(PrismaService)
    .useValue({ onModuleInit: async () => {}, onModuleDestroy: async () => {} })
    .overrideProvider(RedisService)
    .useValue({ client: {}, onModuleDestroy: async () => {} })
    .overrideProvider(HealthRepository)
    .useValue({
      pingDatabase: async () => health.database,
      pingRedis: async () => health.redis,
    })
    .overrideProvider(RedisThrottlerStorage)
    .useValue(options.throttlerStorage ?? NEVER_BLOCK)
    .overrideProvider(LOG_STREAM)
    .useValue(stream)
    .compile();

  const app = moduleRef.createNestApplication<NestExpressApplication>({ logger: false });
  configureApp(app, app.get<AppConfig>(APP_CONFIG));
  await app.init();

  return {
    app,
    health,
    get logs() {
      return lines.map((line) => JSON.parse(line) as Record<string, unknown>);
    },
    rawLogs: () => lines.join('\n'),
  };
}
