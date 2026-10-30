import type { PinoLogger } from 'nestjs-pino';
import { GenericContainer, type StartedTestContainer } from 'testcontainers';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { RedisThrottlerStorage } from '../../src/common/throttling/redis-throttler.storage.js';
import type { AppConfig } from '../../src/config/env.schema.js';
import { RedisService } from '../../src/infrastructure/redis/redis.service.js';

/** Rate limit storage HAQIQIY Redis 8 bilan (docker-compose.yml dagi image). */
let container: StartedTestContainer;
let redis: RedisService;
const logger = { setContext: vi.fn(), warn: vi.fn() };
const storageOf = (service: RedisService) =>
  new RedisThrottlerStorage(service, logger as unknown as PinoLogger);

beforeAll(async () => {
  container = await new GenericContainer('redis:8-alpine').withExposedPorts(6379).start();
  const url = `redis://${container.getHost()}:${container.getMappedPort(6379)}`;
  redis = new RedisService({ REDIS_URL: url } as AppConfig);
}, 120_000);

afterAll(async () => {
  await redis?.onModuleDestroy();
  await container?.stop();
});

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

describe('RedisThrottlerStorage', () => {
  it('limitgacha o‘tkazadi, oshganda bloklaydi; oyna tugagach qayta ochiladi', async () => {
    const storage = storageOf(redis);
    const hit = () => storage.increment('ip:203.0.113.5', 1_000, 3, 1_000, 'anonymous');

    for (let i = 1; i <= 3; i++) {
      expect(await hit()).toMatchObject({ totalHits: i, isBlocked: false, timeToBlockExpire: 0 });
    }
    const blocked = await hit();
    expect(blocked).toMatchObject({ totalHits: 4, isBlocked: true });
    expect(blocked.timeToBlockExpire).toBeGreaterThanOrEqual(1);
    expect(await hit()).toMatchObject({ isBlocked: true });

    await sleep(1_150);
    expect(await hit()).toMatchObject({ totalHits: 1, isBlocked: false });
  });

  it('kalitlar va throttler nomlari bir-biridan mustaqil', async () => {
    const storage = storageOf(redis);
    for (let i = 0; i < 3; i++) await storage.increment('ip:a', 60_000, 2, 60_000, 'anonymous');
    expect(await storage.increment('ip:a', 60_000, 2, 60_000, 'anonymous')).toMatchObject({
      isBlocked: true,
    });
    expect(await storage.increment('ip:b', 60_000, 2, 60_000, 'anonymous')).toMatchObject({
      isBlocked: false,
    });
    expect(await storage.increment('ip:a', 60_000, 2, 60_000, 'write')).toMatchObject({
      isBlocked: false,
    });
  });

  it('parallel so‘rovlar atomik hisoblanadi (Lua skript)', async () => {
    const storage = storageOf(redis);
    const results = await Promise.all(
      Array.from({ length: 50 }, () =>
        storage.increment('ip:burst', 60_000, 20, 60_000, 'anonymous'),
      ),
    );
    expect(results.filter((r) => !r.isBlocked)).toHaveLength(20);
    expect(results.map((r) => r.totalHits).sort((x, y) => x - y)).toEqual(
      Array.from({ length: 50 }, (_, i) => i + 1),
    );
  });

  it('Redis ishlamasa — fail-open (so‘rov o‘tadi) va warn log', async () => {
    const down = new RedisService({ REDIS_URL: 'redis://127.0.0.1:1' } as AppConfig);
    logger.warn.mockClear();
    try {
      const result = await storageOf(down).increment('ip:x', 60_000, 1, 60_000, 'anonymous');
      expect(result).toMatchObject({ isBlocked: false });
      expect(logger.warn).toHaveBeenCalledTimes(1);
    } finally {
      down.client.disconnect();
    }
  });
});
