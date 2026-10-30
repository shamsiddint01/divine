import 'reflect-metadata';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { AppModule } from '../../src/app.module.js';
import { configureApp } from '../../src/bootstrap/configure-app.js';
import { APP_CONFIG } from '../../src/config/config.module.js';
import type { AppConfig } from '../../src/config/env.schema.js';
import { HealthRepository } from '../../src/modules/health/health.repository.js';
import { PrismaService } from '../../src/infrastructure/prisma/prisma.service.js';
import { RedisService } from '../../src/infrastructure/redis/redis.service.js';

// HTTP qatlami testi: haqiqiy AppModule + production bilan bir xil configureApp().
// Tashqi tizimlar (PostgreSQL, Redis) bu testda almashtiriladi — real DB bilan integration
// testlar Phase 3'dan boshlab Testcontainers orqali yoziladi.
describe('GET /api/v1/health (e2e)', () => {
  let app: NestExpressApplication;
  const state = { database: true, redis: true };

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(PrismaService)
      .useValue({ onModuleInit: async () => {}, onModuleDestroy: async () => {} })
      .overrideProvider(RedisService)
      .useValue({ client: {}, onModuleDestroy: async () => {} })
      .overrideProvider(HealthRepository)
      .useValue({
        pingDatabase: async () => state.database,
        pingRedis: async () => state.redis,
      })
      .compile();

    app = moduleRef.createNestApplication<NestExpressApplication>({ logger: false });
    configureApp(app, app.get<AppConfig>(APP_CONFIG));
    await app.init();
  });

  afterAll(async () => {
    await app?.close();
  });

  it('200 va to‘liq holat qaytaradi', async () => {
    state.database = true;
    state.redis = true;
    const res = await request(app.getHttpServer()).get('/api/v1/health').expect(200);
    expect(res.body).toMatchObject({ status: 'ok', checks: { database: 'up', redis: 'up' } });
    expect(res.headers['cache-control']).toBe('no-store');
  });

  it('tizim ishlamasa 503 qaytaradi', async () => {
    state.database = false;
    const res = await request(app.getHttpServer()).get('/api/v1/health').expect(503);
    expect(res.body).toMatchObject({ status: 'degraded', checks: { database: 'down' } });
    state.database = true;
  });

  it('secure header’lar o‘rnatilgan (REQ-164)', async () => {
    const res = await request(app.getHttpServer()).get('/api/v1/health');
    expect(res.headers['x-powered-by']).toBeUndefined();
    expect(res.headers['x-content-type-options']).toBe('nosniff');
    expect(res.headers['content-security-policy']).toContain("default-src 'none'");
    expect(res.headers['x-frame-options']).toBeDefined();
  });

  it('har bir javobda X-Request-Id bor; xavfsiz kelgan ID qayta ishlatiladi', async () => {
    const generated = await request(app.getHttpServer()).get('/api/v1/health');
    expect(generated.headers['x-request-id']).toMatch(/^[0-9a-f-]{36}$/);

    const reused = await request(app.getHttpServer())
      .get('/api/v1/health')
      .set('X-Request-Id', 'client-req-12345');
    expect(reused.headers['x-request-id']).toBe('client-req-12345');

    const rejected = await request(app.getHttpServer())
      .get('/api/v1/health')
      .set('X-Request-Id', '<script>alert(1)</script>');
    expect(rejected.headers['x-request-id']).not.toContain('<script>');
  });

  it('CORS faqat ruxsat etilgan originga javob beradi', async () => {
    const allowed = await request(app.getHttpServer())
      .options('/api/v1/health')
      .set('Origin', 'http://localhost:5173')
      .set('Access-Control-Request-Method', 'GET');
    expect(allowed.headers['access-control-allow-origin']).toBe('http://localhost:5173');

    const denied = await request(app.getHttpServer())
      .options('/api/v1/health')
      .set('Origin', 'https://evil.example')
      .set('Access-Control-Request-Method', 'GET');
    expect(denied.headers['access-control-allow-origin']).toBeUndefined();
  });

  it('global prefix: prefiksiz yo‘l 404', async () => {
    await request(app.getHttpServer()).get('/health').expect(404);
  });

  it('OpenAPI hujjati /api/docs/openapi.json da mavjud', async () => {
    const res = await request(app.getHttpServer()).get('/api/docs/openapi.json').expect(200);
    expect(res.body.info.title).toBe('Divine.uz API');
    expect(res.body.paths).toHaveProperty('/api/v1/health');
  });
});
