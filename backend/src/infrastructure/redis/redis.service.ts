import { Injectable, Logger, type OnModuleDestroy } from '@nestjs/common';
import { Redis } from 'ioredis';
import { InjectConfig } from '../../config/config.module.js';
import type { AppConfig } from '../../config/env.schema.js';

/**
 * Redis ulanishi. Ishlatilishi: rate limiting storage (Phase 3), login lockout hisoblagichlari (Phase 4).
 * Biznes ma'lumotlari Redis'da saqlanmaydi — yagona haqiqat manbai PostgreSQL.
 */
@Injectable()
export class RedisService implements OnModuleDestroy {
  private readonly logger = new Logger(RedisService.name);
  readonly client: Redis;

  constructor(@InjectConfig() config: AppConfig) {
    this.client = new Redis(config.REDIS_URL, {
      maxRetriesPerRequest: 1,
      connectTimeout: 5_000,
      retryStrategy: (attempt) => Math.min(attempt * 200, 5_000),
    });
    // 'error' tinglovchisiz ioredis har bir qayta ulanish xatosini unhandled sifatida chiqaradi.
    this.client.on('error', (error) => this.logger.warn(`Redis xatosi: ${error.message}`));
  }

  async onModuleDestroy(): Promise<void> {
    await this.client.quit().catch(() => this.client.disconnect());
  }
}
