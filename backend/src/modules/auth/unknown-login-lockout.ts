import { Injectable, type OnApplicationBootstrap } from '@nestjs/common';
import { PinoLogger } from 'nestjs-pino';
import { LoginFingerprint } from '../../common/security/login-fingerprint.js';
import { RedisService } from '../../infrastructure/redis/redis.service.js';
import type { LockoutPolicy } from './auth.repository.js';

/**
 * Mavjud bo'lmagan login uchun AYNAN shu progressive lockout (SECURITY §4): javob turi (401/423) va
 * vaqti mavjud login bilan bir xil bo'ladi — login borligini aniqlab bo'lmaydi (enumeration).
 * Holat Redis'da (`divine:auth:unknown:fp:<HMAC(lower(login))>`): fails, locks, until (ms). Skript
 * atomik. Kalit nomida xom login yo'q (SEC-01) — u parol bo'lishi mumkin.
 */
const FAILURE_SCRIPT = `
local now = tonumber(ARGV[1])
local untilv = tonumber(redis.call('HGET', KEYS[1], 'until') or '0')
if untilv > now then return { 1, untilv } end
local fails = redis.call('HINCRBY', KEYS[1], 'fails', 1)
if fails >= tonumber(ARGV[2]) then
  local locks = tonumber(redis.call('HGET', KEYS[1], 'locks') or '0')
  local duration = math.min(tonumber(ARGV[3]) * (2 ^ locks), tonumber(ARGV[4]))
  untilv = now + duration
  redis.call('HSET', KEYS[1], 'fails', 0, 'locks', locks + 1, 'until', untilv)
  redis.call('PEXPIRE', KEYS[1], ARGV[5])
  return { 2, untilv }
end
redis.call('PEXPIRE', KEYS[1], ARGV[5])
return { 0, 0 }
`;

/** Holat shu muddat (oxirgi urinishdan keyin) saqlanadi — mavjud user'dagi lockout_count'ga yaqin xulq. */
const STATE_TTL_MS = 7 * 24 * 3_600_000;

export interface UnknownLoginState {
  lockedUntil: Date | null;
}

const KEY_PREFIX = 'divine:auth:unknown:';
const KEY_VERSION = 'fp:';

@Injectable()
export class UnknownLoginLockout implements OnApplicationBootstrap {
  constructor(
    private readonly redis: RedisService,
    private readonly fingerprint: LoginFingerprint,
    private readonly logger: PinoLogger,
  ) {
    logger.setContext(UnknownLoginLockout.name);
  }

  private key(login: string): string {
    return `${KEY_PREFIX}${KEY_VERSION}${this.fingerprint.of(login)}`;
  }

  /**
   * SEC-01 gacha kalit nomi xom login edi (`divine:auth:unknown:<login>`). Ular faqat mavjud bo'lmagan
   * loginlarning hisoblagichlari — o'chirish hech bir akkaunt himoyasini kamaytirmaydi, lekin kalit
   * nomidagi parolni darhol yo'q qiladi (TTL ≤ 7 kun kutilmaydi). Idempotent; Redis ishlamasa — warn.
   * Log'ga faqat son yoziladi, kalit nomlari emas.
   */
  async onApplicationBootstrap(): Promise<void> {
    try {
      let cursor = '0';
      let removed = 0;
      do {
        const [next, keys] = await this.redis.client.scan(
          cursor,
          'MATCH',
          `${KEY_PREFIX}*`,
          'COUNT',
          500,
        );
        const legacy = keys.filter((key) => !key.startsWith(`${KEY_PREFIX}${KEY_VERSION}`));
        if (legacy.length > 0) removed += await this.redis.client.unlink(...legacy);
        cursor = next;
      } while (cursor !== '0');
      if (removed > 0) {
        this.logger.info(
          { removed },
          'Eski formatdagi noma’lum login lockout kalitlari o‘chirildi',
        );
      }
    } catch (error) {
      this.warn(error);
    }
  }

  /** Hozir lock'dami. Redis ishlamasa — lock yo'q deb hisoblanadi (warn log). */
  async lockedUntil(login: string, now: Date): Promise<Date | null> {
    try {
      const until = Number((await this.redis.client.hget(this.key(login), 'until')) ?? 0);
      return until > now.getTime() ? new Date(until) : null;
    } catch (error) {
      this.warn(error);
      return null;
    }
  }

  /** Muvaffaqiyatsiz urinish: `justLocked` — shu urinish lock'ni boshladi. */
  async registerFailure(
    login: string,
    now: Date,
    policy: LockoutPolicy,
  ): Promise<{ justLocked: boolean; alreadyLocked: boolean; lockedUntil: Date | null }> {
    try {
      const [state, until] = (await this.redis.client.eval(
        FAILURE_SCRIPT,
        1,
        this.key(login),
        String(now.getTime()),
        String(policy.maxAttempts),
        String(policy.baseMs),
        String(policy.maxMs),
        String(STATE_TTL_MS),
      )) as [number, number];
      return {
        justLocked: state === 2,
        alreadyLocked: state === 1,
        lockedUntil: until > 0 ? new Date(until) : null,
      };
    } catch (error) {
      this.warn(error);
      return { justLocked: false, alreadyLocked: false, lockedUntil: null };
    }
  }

  private warn(error: unknown): void {
    this.logger.warn(
      { reason: error instanceof Error ? error.message : String(error) },
      'Noma’lum login lockout holati tekshirilmadi (Redis ishlamayapti)',
    );
  }
}
