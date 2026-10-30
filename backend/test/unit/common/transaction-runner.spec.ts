import type { PinoLogger } from 'nestjs-pino';
import { describe, expect, it, vi } from 'vitest';
import type { PrismaService } from '../../../src/infrastructure/prisma/prisma.service.js';
import {
  TRANSACTION_DEFAULTS,
  TransactionRunner,
} from '../../../src/infrastructure/prisma/transaction-runner.js';

const sqlError = (code: string) => Object.assign(new Error(code), { name: 'DatabaseError', code });

function runnerWith(transaction: (fn: unknown, options: unknown) => Promise<unknown>) {
  const prisma = { $transaction: vi.fn(transaction) };
  const logger = { setContext: vi.fn(), warn: vi.fn() };
  const runner = new TransactionRunner(
    prisma as unknown as PrismaService,
    logger as unknown as PinoLogger,
  );
  return { runner, prisma, logger };
}

describe('TransactionRunner', () => {
  it('standart sozlamalar: READ COMMITTED, timeout va maxWait', async () => {
    const { runner, prisma } = runnerWith(async () => 'ok');
    await expect(runner.run(async () => 'ok')).resolves.toBe('ok');
    expect(prisma.$transaction).toHaveBeenCalledWith(expect.any(Function), {
      isolationLevel: TRANSACTION_DEFAULTS.isolationLevel,
      timeout: 10_000,
      maxWait: 5_000,
    });
    expect(TRANSACTION_DEFAULTS.isolationLevel).toBe('ReadCommitted');
  });

  it('deadlock (40P01) va serialization (40001) da qayta urinadi', async () => {
    let calls = 0;
    const { runner, logger } = runnerWith(async () => {
      calls++;
      if (calls === 1) throw sqlError('40P01');
      if (calls === 2) throw sqlError('40001');
      return 'committed';
    });
    await expect(runner.run(async () => 'x')).resolves.toBe('committed');
    expect(calls).toBe(3);
    expect(logger.warn).toHaveBeenCalledTimes(2);
  });

  it('urinishlar tugasa — oxirgi xato uzatiladi', async () => {
    const { runner, prisma } = runnerWith(async () => {
      throw sqlError('40P01');
    });
    await expect(runner.run(async () => 'x', { retries: 2 })).rejects.toMatchObject({
      code: '40P01',
    });
    expect(prisma.$transaction).toHaveBeenCalledTimes(3);
  });

  it('boshqa xatolarda (unique, biznes xatosi) qayta urinmaydi', async () => {
    const { runner, prisma } = runnerWith(async () => {
      throw sqlError('23505');
    });
    await expect(runner.run(async () => 'x')).rejects.toMatchObject({ code: '23505' });
    expect(prisma.$transaction).toHaveBeenCalledTimes(1);
  });
});
