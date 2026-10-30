import { Injectable } from '@nestjs/common';
import type { HealthResponse } from '@divine/shared';
import { InjectConfig } from '../../config/config.module.js';
import type { AppConfig } from '../../config/env.schema.js';
import { HealthRepository } from './health.repository.js';

/** Application qatlami: tekshiruvlarni orkestratsiya qiladi va umumiy holatni hisoblaydi. */
@Injectable()
export class HealthService {
  constructor(
    private readonly repository: HealthRepository,
    @InjectConfig() private readonly config: AppConfig,
  ) {}

  async check(): Promise<HealthResponse> {
    const [database, redis] = await Promise.all([
      this.repository.pingDatabase(),
      this.repository.pingRedis(),
    ]);
    return {
      status: database && redis ? 'ok' : 'degraded',
      checks: { database: database ? 'up' : 'down', redis: redis ? 'up' : 'down' },
      version: this.config.APP_VERSION,
      timestamp: new Date().toISOString(),
    };
  }
}
