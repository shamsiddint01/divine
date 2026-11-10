import { Injectable } from '@nestjs/common';
import {
  DEMO_TRIAL_MINUTES,
  ErrorCode,
  type DemoStatusDto,
} from '@divine/shared';
import { AppError } from '../../common/errors/app-error.js';
import { Clock } from '../../common/time/clock.js';
import { InjectConfig } from '../../config/config.module.js';
import type { AppConfig } from '../../config/env.schema.js';
import { PrismaService } from '../../infrastructure/prisma/prisma.service.js';

/** Har so'rovda DB'ga bormaslik uchun: vaqt hisobi shuncha kechikib yoziladi. */
const CHECK_INTERVAL_MS = 10_000;
/** Shundan uzun tanaffus "ishlatish" hisoblanmaydi (tab ochiq qolgan bo'lishi mumkin). */
const MAX_GAP_SECONDS = 300;
export const DEMO_LIMIT_SECONDS = DEMO_TRIAL_MINUTES * 60;

interface Usage {
  usedSeconds: number;
  expiresAt: Date;
}

/**
 * Demo sayt (`DEMO_MODE`): sinov hisobi `demo_accounts` yozuviga ega. Ishlatilgan vaqt — ketma-ket
 * so'rovlar orasidagi tanaffuslar yig'indisi (5 daqiqadan uzun tanaffus hisoblanmaydi). Yozuvi yo'q
 * user (masalan, egasining o'z hisobi) cheklanmaydi.
 */
@Injectable()
export class DemoUsageService {
  private readonly cache = new Map<string, { usage: Usage | null; at: number }>();

  constructor(
    private readonly prisma: PrismaService,
    private readonly clock: Clock,
    @InjectConfig() private readonly config: AppConfig,
  ) {}

  get enabled(): boolean {
    return this.config.DEMO_MODE;
  }

  /** Har himoyalangan so'rovda: vaqtni hisoblaydi, tugagan bo'lsa `403 DEMO_TIME_UP`. */
  async touch(userId: string): Promise<void> {
    if (!this.enabled) return;
    const now = this.clock.now();
    const cached = this.cache.get(userId);
    let usage: Usage | null;
    if (cached && now.getTime() - cached.at < CHECK_INTERVAL_MS) {
      usage = cached.usage;
    } else {
      usage = await this.accrue(userId, now);
      this.cache.set(userId, { usage, at: now.getTime() });
    }
    this.assertUsable(usage, now);
  }

  /** Loginda: tugagan sinov hisobi kirmaydi (vaqt hisoblanmaydi). */
  async assertCanLogin(userId: string): Promise<void> {
    if (!this.enabled) return;
    const row = await this.prisma.demoAccount.findUnique({ where: { userId } });
    this.assertUsable(
      row ? { usedSeconds: row.usedSeconds, expiresAt: row.expiresAt } : null,
      this.clock.now(),
    );
  }

  async status(userId: string): Promise<DemoStatusDto | null> {
    if (!this.enabled) return null;
    const row = await this.prisma.demoAccount.findUnique({ where: { userId } });
    if (!row) return null;
    return {
      minutesLeft: Math.max(0, Math.ceil((DEMO_LIMIT_SECONDS - row.usedSeconds) / 60)),
      expiresAt: row.expiresAt.toISOString(),
    };
  }

  private assertUsable(usage: Usage | null, now: Date): void {
    if (!usage) return;
    if (usage.usedSeconds >= DEMO_LIMIT_SECONDS || usage.expiresAt <= now) {
      throw new AppError(ErrorCode.DEMO_TIME_UP);
    }
  }

  /** Atomik: oxirgi so'rovdan beri o'tgan vaqt (5 daqiqagacha) ishlatilganga qo'shiladi. */
  private async accrue(userId: string, now: Date): Promise<Usage | null> {
    const rows = await this.prisma.$queryRaw<{ usedSeconds: number; expiresAt: Date }[]>`
      UPDATE demo_accounts SET
        used_seconds = used_seconds + CASE
          WHEN last_seen_at IS NULL THEN 0
          ELSE LEAST(${MAX_GAP_SECONDS}::int, GREATEST(0, EXTRACT(EPOCH FROM (${now}::timestamptz - last_seen_at))::int))
        END,
        last_seen_at = ${now}::timestamptz
      WHERE user_id = ${userId}::uuid
      RETURNING used_seconds AS "usedSeconds", expires_at AS "expiresAt"`;
    return rows[0] ?? null;
  }
}
