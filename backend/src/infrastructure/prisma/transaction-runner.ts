import { Injectable } from '@nestjs/common';
import { PinoLogger } from 'nestjs-pino';
import { isRetryableTransactionError } from '../../common/errors/database-errors.js';
import { Prisma } from '../../generated/prisma/client.js';
import { PrismaService } from './prisma.service.js';

/** Tranzaksiya ichidagi Prisma klienti. Repository metodlari ixtiyoriy `tx` qabul qiladi. */
export type Tx = Prisma.TransactionClient;

export interface TransactionOptions {
  /**
   * Izolyatsiya darajasi. Standart — READ COMMITTED: stock operatsiyalari shartli atomic UPDATE +
   * row lock bilan himoyalangan (DATABASE §5.3, ARCHITECTURE §12), SERIALIZABLE shart emas.
   */
  isolationLevel?: Prisma.TransactionIsolationLevel;
  /** Tranzaksiyaning eng uzoq davomiyligi, ms (oshsa — ROLLBACK, `503 SERVICE_UNAVAILABLE`). */
  timeoutMs?: number;
  /** Pool'dan ulanish kutish chegarasi, ms. */
  maxWaitMs?: number;
  /** 40001 (serialization) / 40P01 (deadlock) / P2034 bo'lsa qayta urinishlar soni. */
  retries?: number;
}

export const TRANSACTION_DEFAULTS = {
  isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted,
  timeoutMs: 10_000,
  maxWaitMs: 5_000,
  retries: 3,
} as const;

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Qayta ishlatiladigan tranzaksiya chegarasi (ARCHITECTURE §5.3, §12).
 *
 * - `fn` muvaffaqiyatli tugasa — COMMIT; har qanday xato — ROLLBACK va xato yuqoriga uzatiladi
 *   (global filter uni API xatosiga aylantiradi). DEFERRED constraint/trigger xatolari COMMIT paytida
 *   chiqadi va ular ham shu yerdan uzatiladi.
 * - Faqat xavfsiz qayta urinish mumkin bo'lgan xatolar (serialization failure, deadlock) qayta bajariladi;
 *   `fn` qayta chaqirilishi mumkinligi sababli u tranzaksiyadan tashqarida yon ta'sir qilmasligi kerak.
 * - Business service'lar (sales, incoming, inventory) shu runner'dan foydalanadi (Phase 7+).
 */
@Injectable()
export class TransactionRunner {
  constructor(
    private readonly prisma: PrismaService,
    private readonly logger: PinoLogger,
  ) {
    logger.setContext(TransactionRunner.name);
  }

  async run<T>(fn: (tx: Tx) => Promise<T>, options: TransactionOptions = {}): Promise<T> {
    const retries = options.retries ?? TRANSACTION_DEFAULTS.retries;
    for (let attempt = 0; ; attempt++) {
      try {
        return await this.prisma.$transaction(fn, {
          isolationLevel: options.isolationLevel ?? TRANSACTION_DEFAULTS.isolationLevel,
          timeout: options.timeoutMs ?? TRANSACTION_DEFAULTS.timeoutMs,
          maxWait: options.maxWaitMs ?? TRANSACTION_DEFAULTS.maxWaitMs,
        });
      } catch (error) {
        if (attempt >= retries || !isRetryableTransactionError(error)) throw error;
        // Eksponensial kutish + jitter: parallel tranzaksiyalar yana bir vaqtda to'qnashmasin.
        const delay = 20 * 2 ** attempt + Math.floor(Math.random() * 20);
        this.logger.warn({ attempt: attempt + 1, delayMs: delay }, 'Tranzaksiya qayta urinilmoqda');
        await sleep(delay);
      }
    }
  }
}
