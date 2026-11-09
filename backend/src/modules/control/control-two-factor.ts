import { createHash, randomInt, randomUUID } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import { ErrorCode } from '@divine/shared';
import { AppError } from '../../common/errors/app-error.js';
import { InjectConfig } from '../../config/config.module.js';
import type { AppConfig } from '../../config/env.schema.js';
import { RedisService } from '../../infrastructure/redis/redis.service.js';
import { TelegramService } from '../telegram/telegram.service.js';

const TTL_SECONDS = 5 * 60;
const MAX_ATTEMPTS = 5;
const key = (id: string) => `divine:control:2fa:${id}`;
const hash = (code: string) => createHash('sha256').update(code).digest('hex');

interface Challenge {
  adminId: string;
  codeHash: string;
  attempts: number;
}

/**
 * Superadmin kirishida ikkinchi tasdiq (egasining qarori, 2026-11-07): to'g'ri paroldan keyin
 * Telegram'ga 6 xonali kod. Kod 5 daqiqa, 5 urinish; Redis'da faqat hash saqlanadi.
 */
@Injectable()
export class ControlTwoFactor {
  constructor(
    private readonly redis: RedisService,
    private readonly telegram: TelegramService,
    @InjectConfig() private readonly config: AppConfig,
  ) {}

  get enabled(): boolean {
    return this.config.CONTROL_TWO_FACTOR && this.telegram.enabled;
  }

  async start(adminId: string): Promise<string> {
    const id = randomUUID();
    const code = String(randomInt(0, 1_000_000)).padStart(6, '0');
    const challenge: Challenge = { adminId, codeHash: hash(code), attempts: 0 };
    await this.redis.client.set(key(id), JSON.stringify(challenge), 'EX', TTL_SECONDS);
    await this.telegram.send(`Divine superadmin kirish kodi: ${code}\nKod 5 daqiqa amal qiladi.`);
    return id;
  }

  async verify(id: string, code: string): Promise<string> {
    const raw = await this.redis.client.get(key(id));
    const challenge = raw ? (JSON.parse(raw) as Challenge) : null;
    if (!challenge || challenge.attempts >= MAX_ATTEMPTS) {
      throw new AppError(ErrorCode.UNAUTHENTICATED, {
        message: 'Kod muddati tugadi, qaytadan kiring',
      });
    }
    if (challenge.codeHash !== hash(code)) {
      challenge.attempts += 1;
      await this.redis.client.set(key(id), JSON.stringify(challenge), 'KEEPTTL');
      throw new AppError(ErrorCode.INVALID_CREDENTIALS, { message: 'Kod noto‘g‘ri' });
    }
    await this.redis.client.del(key(id));
    return challenge.adminId;
  }
}
