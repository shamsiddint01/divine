import { Injectable, Module } from '@nestjs/common';
import type { ThrottlerStorage } from '@nestjs/throttler';
import { PinoLogger } from 'nestjs-pino';
import { RedisService } from '../../infrastructure/redis/redis.service.js';

/**
 * Fixed window + blok, atomik (bitta Lua skript): bir nechta API instance'da ham to'g'ri hisoblaydi.
 * KEYS[1] — hisoblagich, KEYS[2] — blok belgisi; ARGV: ttl ms, limit, blok ms.
 * Qaytaradi: { hits, oyna qolgan ms, bloklanganmi (0/1), blok qolgan ms }.
 */
const INCREMENT_SCRIPT = `
local hits = redis.call('INCR', KEYS[1])
if hits == 1 then redis.call('PEXPIRE', KEYS[1], ARGV[1]) end
local ttl = redis.call('PTTL', KEYS[1])
local blockTtl = redis.call('PTTL', KEYS[2])
if blockTtl > 0 then return { hits, ttl, 1, blockTtl } end
if hits > tonumber(ARGV[2]) then
  redis.call('SET', KEYS[2], '1', 'PX', ARGV[3])
  return { hits, ttl, 1, tonumber(ARGV[3]) }
end
return { hits, ttl, 0, 0 }
`;

type ThrottlerStorageRecord = Awaited<ReturnType<ThrottlerStorage['increment']>>;

const KEY_PREFIX = 'divine:throttle:';
const toSeconds = (ms: number) => Math.max(0, Math.ceil(ms / 1000));

/**
 * `@nestjs/throttler` uchun Redis storage (SECURITY §7). Vaqtlar soniyada qaytariladi (throttler
 * `Retry-After` uchun shuni kutadi).
 *
 * Redis ishlamasa — **fail-open**: so'rov o'tkaziladi va warn log yoziladi. Sabab: kassa (POS) ishi
 * rate limit infratuzilmasidan muhimroq; Redis holati `/health` va monitoring orqali ko'rinadi.
 */
@Injectable()
export class RedisThrottlerStorage implements ThrottlerStorage {
  constructor(
    private readonly redis: RedisService,
    private readonly logger: PinoLogger,
  ) {
    logger.setContext(RedisThrottlerStorage.name);
  }

  async increment(
    key: string,
    ttl: number,
    limit: number,
    blockDuration: number,
    throttlerName: string,
  ): Promise<ThrottlerStorageRecord> {
    const base = `${KEY_PREFIX}${throttlerName}:${key}`;
    try {
      const [hits, ttlMs, blocked, blockMs] = (await this.redis.client.eval(
        INCREMENT_SCRIPT,
        2,
        base,
        `${base}:block`,
        String(ttl),
        String(limit),
        String(blockDuration > 0 ? blockDuration : ttl),
      )) as [number, number, number, number];
      return {
        totalHits: hits,
        timeToExpire: toSeconds(ttlMs),
        isBlocked: blocked === 1,
        timeToBlockExpire: toSeconds(blockMs),
      };
    } catch (error) {
      this.logger.warn(
        {
          throttler: throttlerName,
          reason: error instanceof Error ? error.message : String(error),
        },
        'Rate limit tekshirilmadi (Redis ishlamayapti) — so‘rov o‘tkazildi',
      );
      return { totalHits: 0, timeToExpire: toSeconds(ttl), isBlocked: false, timeToBlockExpire: 0 };
    }
  }
}

/** `ThrottlerModule.forRootAsync` ichida inject qilish uchun. */
@Module({ providers: [RedisThrottlerStorage], exports: [RedisThrottlerStorage] })
export class RedisThrottlerStorageModule {}
