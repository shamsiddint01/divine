import { PrismaPg } from '@prisma/adapter-pg';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import { extractDbError, mapDbError } from '../../src/common/errors/database-errors.js';
import { serializeErrorForLog } from '../../src/common/errors/error-log.js';
import { pgPoolConfig } from '../../src/database/pg-connection.js';
import { type Prisma, PrismaClient } from '../../src/generated/prisma/client.js';
import { FAKE_PASSWORD_HASH } from './support/fixtures.js';

/**
 * Global filter ishlatadigan mapping HAQIQIY PostgreSQL + Prisma 7 xatolari bilan (DATABASE §12).
 * Har bir holat tranzaksiyada bajariladi va ROLLBACK qilinadi.
 */
let prisma: PrismaClient;

beforeAll(() => {
  prisma = new PrismaClient({ adapter: new PrismaPg(pgPoolConfig(inject('databaseUrl'))) });
});

afterAll(async () => {
  await prisma.$disconnect();
});

class Rollback extends Error {}

/** `fn` tashlagan DB xatosini qaytaradi (tranzaksiya doim bekor qilinadi). */
async function failureOf(fn: (tx: Prisma.TransactionClient) => Promise<unknown>): Promise<unknown> {
  let failure: unknown;
  await prisma
    .$transaction(async (tx) => {
      try {
        await fn(tx);
      } catch (error) {
        failure = error;
      }
      throw new Rollback();
    })
    .catch((error: unknown) => {
      if (!(error instanceof Rollback)) failure ??= error;
    });
  if (failure === undefined) throw new Error('Kutilgan DB xatosi bo‘lmadi');
  return failure;
}

let seq = 0;
const unique = () => `${Date.now().toString(36)}${(seq++).toString(36)}`;

async function admin(tx: Prisma.TransactionClient) {
  return tx.user.create({
    data: {
      login: `map${unique()}`,
      passwordHash: FAKE_PASSWORD_HASH,
      role: { connect: { code: 'ADMIN' } },
    },
  });
}

async function mapped(fn: (tx: Prisma.TransactionClient) => Promise<unknown>) {
  const error = await failureOf(fn);
  const info = extractDbError(error);
  expect(info, `DB xatosi tanilmadi: ${String(error)}`).not.toBeNull();
  // Log uchun serializatsiyada xom qiymatlar (hash, qator) bo'lmasligi.
  expect(JSON.stringify(serializeErrorForLog(error))).not.toContain(FAKE_PASSWORD_HASH);
  return { info: info!, result: mapDbError(info!) };
}

describe('haqiqiy DB xatolari → API kodlari', () => {
  it('takroriy login (case-insensitive) → 409 LOGIN_TAKEN, maydon: login', async () => {
    const { result, info } = await mapped(async (tx) => {
      const login = `Dup${unique()}`;
      await tx.user.create({
        data: { login, passwordHash: FAKE_PASSWORD_HASH, role: { connect: { code: 'USER' } } },
      });
      await tx.user.create({
        data: {
          login: login.toLowerCase(),
          passwordHash: FAKE_PASSWORD_HASH,
          role: { connect: { code: 'USER' } },
        },
      });
    });
    expect(info).toMatchObject({
      prismaCode: 'P2002',
      sqlState: '23505',
      constraint: 'users_login_lower_key',
    });
    expect(result).toEqual({
      code: 'LOGIN_TAKEN',
      severity: 'client',
      details: [{ field: 'login', message: 'Bu login band. Boshqa login kiriting' }],
    });
  });

  it('takroriy shtrix-kod → BARCODE_TAKEN', async () => {
    const { result } = await mapped(async (tx) => {
      const a = await admin(tx);
      const g = await tx.productGroup.create({ data: { name: `G${unique()}`, createdById: a.id } });
      const barcode = `47${unique()}`;
      for (const name of ['A', 'B']) {
        await tx.product.create({
          data: { name, groupId: g.id, barcode, costPrice: 1, salePrice: 1, createdById: a.id },
        });
      }
    });
    expect(result.code).toBe('BARCODE_TAKEN');
  });

  it('mavjud bo‘lmagan FK → 404 NOT_FOUND', async () => {
    const { result, info } = await mapped((tx) =>
      tx.user.create({
        data: { login: `fk${unique()}`, passwordHash: FAKE_PASSWORD_HASH, roleId: 999 },
      }),
    );
    expect(info.sqlState).toBe('23503');
    expect(result.code).toBe('NOT_FOUND');
  });

  it('CHECK buzilishi → 400 VALIDATION_ERROR (constraint xabardan aniqlanadi)', async () => {
    const { result, info } = await mapped(async (tx) => {
      const a = await admin(tx);
      await tx.warehouse.create({ data: { name: '   ', createdById: a.id } });
    });
    expect(info).toMatchObject({ sqlState: '23514', constraint: 'warehouses_name_not_blank' });
    expect(result.code).toBe('VALIDATION_ERROR');
  });

  it('manfiy qoldiq CHECK → 409 INSUFFICIENT_STOCK', async () => {
    const { result } = await mapped(async (tx) => {
      const a = await admin(tx);
      const g = await tx.productGroup.create({ data: { name: `G${unique()}`, createdById: a.id } });
      const w = await tx.warehouse.create({ data: { name: `W${unique()}`, createdById: a.id } });
      const p = await tx.product.create({
        data: { name: 'P', groupId: g.id, costPrice: 1, salePrice: 1, createdById: a.id },
      });
      await tx.warehouseStock.create({
        data: { warehouseId: w.id, productId: p.id, quantity: '-1' },
      });
    });
    expect(result.code).toBe('INSUFFICIENT_STOCK');
  });

  it('tarixi bor yozuvni o‘chirish (RESTRICT, 23001) → 409 ENTITY_IN_USE', async () => {
    const { result, info } = await mapped(async (tx) => {
      const a = await admin(tx);
      const g = await tx.productGroup.create({ data: { name: `G${unique()}`, createdById: a.id } });
      await tx.product.create({
        data: { name: 'P', groupId: g.id, costPrice: 1, salePrice: 1, createdById: a.id },
      });
      await tx.productGroup.delete({ where: { id: g.id } });
    });
    expect(info.sqlState).toBe('23001');
    expect(result.code).toBe('ENTITY_IN_USE');
  });

  it('NOT NULL → VALIDATION_ERROR; uzun matn (22001) → VALIDATION_ERROR', async () => {
    const notNull = await mapped(
      (tx) => tx.$executeRaw`INSERT INTO roles (code, name) VALUES ('USER', NULL)`,
    );
    expect(notNull.info.sqlState).toBe('23502');
    expect(notNull.result.code).toBe('VALIDATION_ERROR');
    const tooLong = await mapped(
      (tx) => tx.$executeRaw`INSERT INTO settings (key, value) VALUES (${'k'.repeat(80)}, '1')`,
    );
    expect(tooLong.result.code).toBe('VALIDATION_ERROR');
  });

  it('o‘zgarmas audit (DV001) → 500 INTERNAL_ERROR (dastur xatosi)', async () => {
    const { result, info } = await mapped(async (tx) => {
      await tx.$executeRaw`INSERT INTO audit_logs (action, entity_type) VALUES ('X', 'USER')`;
      await tx.$executeRaw`UPDATE audit_logs SET action = 'Y'`;
    });
    expect(info.sqlState).toBe('DV001');
    expect(result).toMatchObject({ code: 'INTERNAL_ERROR', severity: 'bug' });
  });

  it('DRAFT bo‘lmagan kirim (DV002) → 409 INCOMING_NOT_DRAFT', async () => {
    const { result } = await mapped(async (tx) => {
      const a = await admin(tx);
      const w = await tx.warehouse.create({ data: { name: `W${unique()}`, createdById: a.id } });
      await tx.incoming.create({
        data: {
          incomingDate: new Date('2026-10-08'),
          warehouseId: w.id,
          status: 'CONFIRMED',
          confirmedById: a.id,
          confirmedAt: new Date(),
          createdById: a.id,
        },
      });
    });
    expect(result.code).toBe('INCOMING_NOT_DRAFT');
  });

  it('yangilanadigan yozuv topilmadi (P2025) → 404 NOT_FOUND', async () => {
    const { result } = await mapped((tx) =>
      tx.setting.update({ where: { key: 'mavjud_emas' }, data: { value: 1 } }),
    );
    expect(result.code).toBe('NOT_FOUND');
  });
});
