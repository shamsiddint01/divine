import {
  Injectable,
  type OnApplicationBootstrap,
  type OnApplicationShutdown,
} from '@nestjs/common';
import { PinoLogger } from 'nestjs-pino';
import { InjectConfig } from '../../config/config.module.js';
import type { AppConfig } from '../../config/env.schema.js';
import { Clock } from '../../common/time/clock.js';
import { localDate } from '../../common/time/tashkent-time.js';
import { RedisService } from '../../infrastructure/redis/redis.service.js';
import { msUntilNextRun } from '../inventory/reconciliation.job.js';
import { AuthRepository } from './auth.repository.js';

/** Muddati tugagan yoki bekor qilingan sessiya shuncha vaqtdan keyin o'chiriladi (SECURITY §3). */
export const SESSION_RETENTION_DAYS = 30;
/** Toshkent bo'yicha 04:00 — reconciliation (03:00) dan keyin. */
const CLEANUP_HOUR = 4;

/**
 * Eski sessiyalarni tozalash (SECURITY §3, Phase 17). `user_sessions` faqat refresh token hash'larini
 * saqlaydi; muddati o'tgan yoki bekor qilingan qatorlar qayta ishlatib bo'lmaydi va faqat joy egallaydi.
 * Faol sessiyalarga tegilmaydi. Audit jurnaliga tegilmaydi (u o'zgarmas). Bir nechta API instansiyasida
 * Redis `SET NX` qulfi kuniga bitta ishga tushirishni qoldiradi. Testlarda (`NODE_ENV=test`) o'chirilgan.
 */
@Injectable()
export class SessionCleanupJob implements OnApplicationBootstrap, OnApplicationShutdown {
  private timer?: NodeJS.Timeout;

  constructor(
    private readonly repository: AuthRepository,
    private readonly redis: RedisService,
    private readonly clock: Clock,
    @InjectConfig() private readonly config: AppConfig,
    private readonly logger: PinoLogger,
  ) {
    logger.setContext(SessionCleanupJob.name);
  }

  onApplicationBootstrap(): void {
    if (this.config.NODE_ENV === 'test') return;
    this.schedule();
  }

  onApplicationShutdown(): void {
    clearTimeout(this.timer);
  }

  /** Bitta ishga tushirish (qulf olinmasa — boshqa instansiya bajargan, `false`). */
  async runOnce(): Promise<boolean> {
    const now = this.clock.now();
    const acquired = await this.redis.client.set(
      `divine:job:session-cleanup:${localDate(now)}`,
      '1',
      'EX',
      26 * 3600,
      'NX',
    );
    if (acquired !== 'OK') return false;
    const before = new Date(now.getTime() - SESSION_RETENTION_DAYS * 86_400_000);
    const removed = await this.repository.deleteStaleSessions(before);
    this.logger.info(
      { removed, retentionDays: SESSION_RETENTION_DAYS },
      'Eski sessiyalar tozalandi',
    );
    return true;
  }

  private schedule(): void {
    this.timer = setTimeout(
      () => {
        this.runOnce()
          .catch((error: unknown) => this.logger.error({ err: error }, 'Sessiya tozalash xatosi'))
          .finally(() => this.schedule());
      },
      msUntilNextRun(this.clock.now(), CLEANUP_HOUR),
    );
    this.timer.unref();
  }
}
