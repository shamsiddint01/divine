import {
  Injectable,
  type OnApplicationBootstrap,
  type OnApplicationShutdown,
} from '@nestjs/common';
import { PinoLogger } from 'nestjs-pino';
import { InjectConfig } from '../../config/config.module.js';
import type { AppConfig } from '../../config/env.schema.js';
import { Clock } from '../../common/time/clock.js';
import { localDate, zonedDayStart, nextDate } from '../../common/time/tashkent-time.js';
import { RedisService } from '../../infrastructure/redis/redis.service.js';
import { InventoryService } from './inventory.service.js';

/** Kunlik tekshiruv vaqti — Toshkent bo'yicha 03:00 (savdo yo'q payt). */
export const RECONCILIATION_HOUR = 3;

/** Keyingi ishga tushirishgacha millisoniyalar: bugun 03:00 o'tmagan bo'lsa — bugun, aks holda ertaga. */
export function msUntilNextRun(now: Date, hour = RECONCILIATION_HOUR): number {
  const today = localDate(now);
  const atHour = (date: string) => zonedDayStart(date).getTime() + hour * 3_600_000;
  const next = atHour(today) > now.getTime() ? atHour(today) : atHour(nextDate(today));
  return next - now.getTime();
}

/**
 * Kunlik reconciliation (REQ-132, DEVELOPMENT-PLAN Phase 7). Natija audit'ga yoziladi; nomuvofiqlik
 * bo'lsa — `warn` log (avtomatik tuzatish yo'q, D-03). Bir nechta API instansiyasi bo'lsa, Redis
 * `SET NX` qulfi kuniga faqat bitta ishga tushirishni qoldiradi. Testlarda (`NODE_ENV=test`) o'chirilgan.
 */
@Injectable()
export class ReconciliationJob implements OnApplicationBootstrap, OnApplicationShutdown {
  private timer?: NodeJS.Timeout;

  constructor(
    private readonly inventory: InventoryService,
    private readonly redis: RedisService,
    private readonly clock: Clock,
    @InjectConfig() private readonly config: AppConfig,
    private readonly logger: PinoLogger,
  ) {
    logger.setContext(ReconciliationJob.name);
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
    const day = localDate(this.clock.now());
    const acquired = await this.redis.client.set(
      `divine:job:inventory-reconciliation:${day}`,
      '1',
      'EX',
      26 * 3600,
      'NX',
    );
    if (acquired !== 'OK') return false;
    const result = await this.inventory.reconcile(null, 'job');
    const summary = {
      pairsChecked: result.pairsChecked,
      mismatchCount: result.mismatchCount,
      documentIssueCount: result.documentIssueCount,
      customerIssueCount: result.customerIssueCount,
    };
    if (result.mismatchCount + result.documentIssueCount + result.customerIssueCount > 0) {
      this.logger.warn(summary, 'Inventar reconciliation: nomuvofiqlik topildi');
    } else {
      this.logger.info(summary, 'Inventar reconciliation: hammasi mos');
    }
    return true;
  }

  private schedule(): void {
    this.timer = setTimeout(() => {
      this.runOnce()
        .catch((error: unknown) =>
          this.logger.error({ err: error }, 'Inventar reconciliation xatosi'),
        )
        .finally(() => this.schedule());
    }, msUntilNextRun(this.clock.now()));
    this.timer.unref();
  }
}
