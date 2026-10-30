import { Injectable, Logger, type OnModuleDestroy, type OnModuleInit } from '@nestjs/common';
import { PrismaPg } from '@prisma/adapter-pg';
import { InjectConfig } from '../../config/config.module.js';
import { pgPoolConfig } from '../../database/pg-connection.js';
import type { AppConfig } from '../../config/env.schema.js';
import { PrismaClient } from '../../generated/prisma/client.js';

/**
 * Yagona PrismaClient (connection pool). Faqat repository qatlami ishlatadi —
 * controller va service'lar to'g'ridan-to'g'ri Prisma'ga murojaat qilmaydi.
 */
@Injectable()
export class PrismaService extends PrismaClient implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(PrismaService.name);

  constructor(@InjectConfig() config: AppConfig) {
    super({ adapter: new PrismaPg(pgPoolConfig(config.DATABASE_URL)) });
  }

  async onModuleInit(): Promise<void> {
    // Ulanish bo'lmasa ham ilova ishga tushadi; holat /health orqali ko'rinadi
    // va orkestrator (readiness probe) trafikni yo'naltirmaydi.
    try {
      await this.$connect();
    } catch (error) {
      this.logger.warn(`PostgreSQL'ga ulanib bo'lmadi: ${(error as Error).message}`);
    }
  }

  async onModuleDestroy(): Promise<void> {
    await this.$disconnect();
  }
}
