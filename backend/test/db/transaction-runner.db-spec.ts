import { PrismaPg } from '@prisma/adapter-pg';
import type { PinoLogger } from 'nestjs-pino';
import { afterAll, beforeAll, describe, expect, inject, it, vi } from 'vitest';
import { AppError } from '../../src/common/errors/app-error.js';
import { extractDbError, mapDbError } from '../../src/common/errors/database-errors.js';
import { pgPoolConfig } from '../../src/database/pg-connection.js';
import { PrismaClient } from '../../src/generated/prisma/client.js';
import type { PrismaService } from '../../src/infrastructure/prisma/prisma.service.js';
import { TransactionRunner } from '../../src/infrastructure/prisma/transaction-runner.js';
import { FAKE_PASSWORD_HASH } from './support/fixtures.js';

let prisma: PrismaClient;
let runner: TransactionRunner;
const logger = { setContext: vi.fn(), warn: vi.fn() };

beforeAll(() => {
  prisma = new PrismaClient({ adapter: new PrismaPg(pgPoolConfig(inject('databaseUrl'))) });
  runner = new TransactionRunner(
    prisma as unknown as PrismaService,
    logger as unknown as PinoLogger,
  );
});

afterAll(async () => {
  await prisma.$disconnect();
});

let seq = 0;
const key = (name: string) => `tx_${name}_${Date.now().toString(36)}${(seq++).toString(36)}`;
const settingExists = async (k: string) =>
  (await prisma.setting.findUnique({ where: { key: k } })) !== null;

describe('TransactionRunner (real PostgreSQL)', () => {
  it('muvaffaqiyat → COMMIT', async () => {
    const k = key('commit');
    const result = await runner.run(async (tx) => {
      await tx.setting.create({ data: { key: k, value: 1 } });
      return 'ok';
    });
    expect(result).toBe('ok');
    expect(await settingExists(k)).toBe(true);
  });

  it('xato → ROLLBACK, xato o‘zgarmasdan uzatiladi', async () => {
    const k = key('rollback');
    const failure = new AppError('INSUFFICIENT_STOCK');
    await expect(
      runner.run(async (tx) => {
        await tx.setting.create({ data: { key: k, value: 1 } });
        throw failure;
      }),
    ).rejects.toBe(failure);
    expect(await settingExists(k)).toBe(false);
  });

  it('COMMIT paytidagi DEFERRED trigger xatosi ham ROLLBACK qiladi (qatorsiz sotuv)', async () => {
    const login = `txdef${Date.now()}`;
    const error = await runner
      .run(async (tx) => {
        const u = await tx.user.create({
          data: { login, passwordHash: FAKE_PASSWORD_HASH, role: { connect: { code: 'ADMIN' } } },
        });
        const w = await tx.warehouse.create({ data: { name: `W ${login}`, createdById: u.id } });
        const c = await tx.customer.create({ data: { name: 'Mijoz', createdById: u.id } });
        await tx.sale.create({
          data: {
            userId: u.id,
            warehouseId: w.id,
            customerId: c.id,
            customerNameSnapshot: 'Mijoz',
            totalQuantity: '1',
            totalAmount: '1',
            totalCost: '1',
            idempotencyKey: crypto.randomUUID(),
            requestHash: 'e'.repeat(64),
          },
        });
      })
      .catch((e: unknown) => e);
    expect(extractDbError(error)?.sqlState).toBe('DV004');
    expect(mapDbError(extractDbError(error)!).code).toBe('INTERNAL_ERROR');
    expect(await prisma.user.count({ where: { login } })).toBe(0);
  });

  it('timeout → ROLLBACK va 503 SERVICE_UNAVAILABLE', async () => {
    const k = key('timeout');
    const error = await runner
      .run(
        async (tx) => {
          await tx.setting.create({ data: { key: k, value: 1 } });
          await tx.$executeRaw`SELECT pg_sleep(0.6)`;
          await tx.setting.update({ where: { key: k }, data: { value: 2 } });
        },
        { timeoutMs: 200 },
      )
      .catch((e: unknown) => e);
    expect(mapDbError(extractDbError(error)!).code).toBe('SERVICE_UNAVAILABLE');
    expect(await settingExists(k)).toBe(false);
  });

  it('haqiqiy deadlock (40P01) → qayta urinish, ikkala tranzaksiya ham yakunlanadi', async () => {
    const [a, b] = [key('dl_a'), key('dl_b')];
    await prisma.setting.createMany({
      data: [
        { key: a, value: 0 },
        { key: b, value: 0 },
      ],
    });

    // Ikkala tranzaksiya birinchi qatorni lock qilgach, teskari tartibda ikkinchisiga murojaat qiladi.
    let ready = 0;
    let release!: () => void;
    const barrier = new Promise<void>((resolve) => (release = resolve));
    const arrive = async () => {
      if (++ready === 2) release();
      await barrier;
    };

    logger.warn.mockClear();
    const [first, second] = await Promise.all([
      runner.run(async (tx) => {
        await tx.$executeRaw`UPDATE settings SET value = to_jsonb(1) WHERE key = ${a}`;
        await arrive();
        await tx.$executeRaw`UPDATE settings SET value = to_jsonb(1) WHERE key = ${b}`;
        return 'A';
      }),
      runner.run(async (tx) => {
        await tx.$executeRaw`UPDATE settings SET value = to_jsonb(2) WHERE key = ${b}`;
        await arrive();
        await tx.$executeRaw`UPDATE settings SET value = to_jsonb(2) WHERE key = ${a}`;
        return 'B';
      }),
    ]);

    expect([first, second]).toEqual(['A', 'B']);
    expect(logger.warn).toHaveBeenCalledTimes(1);
    const rows = await prisma.setting.findMany({ where: { key: { in: [a, b] } } });
    // Qayta urinilgan tranzaksiya oxirida yozadi — ikkala qator bir xil qiymatga ega (yarim holat yo'q).
    expect(new Set(rows.map((r) => r.value)).size).toBe(1);
  }, 20_000);
});
