import 'reflect-metadata';
import type { PinoLogger } from 'nestjs-pino';
import { describe, expect, it, vi } from 'vitest';
import { ManualClock } from '../../../src/common/time/clock.js';
import type { AppConfig } from '../../../src/config/env.schema.js';
import type { RedisService } from '../../../src/infrastructure/redis/redis.service.js';
import type { MovementRow } from '../../../src/modules/inventory/inventory.repository.js';
import {
  type InventoryService,
  toMovementDto,
} from '../../../src/modules/inventory/inventory.service.js';
import {
  msUntilNextRun,
  ReconciliationJob,
} from '../../../src/modules/inventory/reconciliation.job.js';

const HOUR = 3_600_000;

describe('kunlik reconciliation vaqti (Toshkent 03:00 = 22:00 UTC)', () => {
  it('03:00 dan oldin — shu kuni, keyin — ertasiga', () => {
    // 2026-10-22 01:00 Toshkent → 2 soatdan keyin.
    expect(msUntilNextRun(new Date('2026-10-21T20:00:00.000Z'))).toBe(2 * HOUR);
    // Aynan 03:00 — keyingi kun (24 soat).
    expect(msUntilNextRun(new Date('2026-10-21T22:00:00.000Z'))).toBe(24 * HOUR);
    // 2026-10-22 17:30 Toshkent → ertaga 03:00 gacha 9.5 soat.
    expect(msUntilNextRun(new Date('2026-10-22T12:30:00.000Z'))).toBe(9.5 * HOUR);
  });
});

describe('ReconciliationJob', () => {
  function setup(lock: 'OK' | null) {
    const inventory = {
      reconcile: vi.fn(async () => ({
        checkedAt: '2026-10-22T22:00:00.000Z',
        pairsChecked: 4,
        mismatchCount: 1,
        mismatches: [],
        documentIssueCount: 0,
        customerIssueCount: 0,
      })),
    };
    const set = vi.fn(async () => lock);
    const logger = { setContext: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() };
    const job = new ReconciliationJob(
      inventory as unknown as InventoryService,
      { client: { set } } as unknown as RedisService,
      new ManualClock(new Date('2026-10-21T22:00:00.000Z')),
      { NODE_ENV: 'test' } as AppConfig,
      logger as unknown as PinoLogger,
    );
    return { job, inventory, set, logger };
  }

  it('kuniga bitta: Redis qulfi olinsa — ishga tushadi (actor yo‘q, manba job)', async () => {
    const { job, inventory, set, logger } = setup('OK');
    expect(await job.runOnce()).toBe(true);
    expect(logger.warn).toHaveBeenCalledWith(
      expect.objectContaining({ mismatchCount: 1 }),
      'Inventar reconciliation: nomuvofiqlik topildi',
    );
    expect(set).toHaveBeenCalledWith(
      'divine:job:inventory-reconciliation:2026-10-22',
      '1',
      'EX',
      26 * 3600,
      'NX',
    );
    expect(inventory.reconcile).toHaveBeenCalledWith(null, 'job');
  });

  it('qulf boshqa instansiyada — ishga tushmaydi', async () => {
    const { job, inventory } = setup(null);
    expect(await job.runOnce()).toBe(false);
    expect(inventory.reconcile).not.toHaveBeenCalled();
  });

  it('test muhitida taymer o‘rnatilmaydi', () => {
    const spy = vi.spyOn(globalThis, 'setTimeout');
    setup('OK').job.onApplicationBootstrap();
    expect(spy).not.toHaveBeenCalled();
    spy.mockRestore();
  });
});

describe('toMovementDto (OWN-06)', () => {
  const row: MovementRow = {
    id: '1',
    warehouseId: 'w',
    warehouseName: 'Ombor',
    productId: 'p',
    productName: 'Telefon',
    unit: 'DONA',
    movementType: 'SALE',
    quantity: '-2.000',
    balanceAfter: '3.000',
    unitCost: '1800000.00',
    referenceType: 'SALE',
    referenceId: 's',
    referenceNumber: 'S-000001',
    createdBy: { id: 'u', login: 'admin', fullName: null },
    createdAt: new Date('2026-10-22T10:00:00.000Z'),
  };

  it('`products.read_cost` bo‘lmasa unitCost kaliti umuman yo‘q', () => {
    expect(toMovementDto(row, false)).not.toHaveProperty('unitCost');
    expect(JSON.stringify(toMovementDto(row, false))).not.toContain('1800000');
    expect(toMovementDto(row, true)).toMatchObject({
      unitCost: '1800000.00',
      createdAt: '2026-10-22T10:00:00.000Z',
    });
  });
});
