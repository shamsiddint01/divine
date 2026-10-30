import { randomBytes } from 'node:crypto';
import pg from 'pg';
import { expect, inject } from 'vitest';
import { pgPoolConfig } from '../../../src/database/pg-connection.js';

export type Db = pg.PoolClient;

let pool: pg.Pool | undefined;

export function getPool(): pg.Pool {
  pool ??= new pg.Pool({ ...pgPoolConfig(inject('databaseUrl')), max: 30 });
  return pool;
}

export async function closePool(): Promise<void> {
  await pool?.end();
  pool = undefined;
}

/** Testni tranzaksiya ichida bajaradi va doim ROLLBACK qiladi — testlar bir-biriga ta'sir qilmaydi. */
export async function withRollback<T>(fn: (db: Db) => Promise<T>): Promise<T> {
  const client = await getPool().connect();
  await client.query('BEGIN');
  try {
    return await fn(client);
  } finally {
    await client.query('ROLLBACK');
    client.release();
  }
}

/** Tranzaksiyani COMMIT qiladi (deferred trigger'lar va parallel ssenariylar uchun). */
export async function withCommit<T>(fn: (db: Db) => Promise<T>): Promise<T> {
  const client = await getPool().connect();
  await client.query('BEGIN');
  try {
    const result = await fn(client);
    await client.query('COMMIT');
    return result;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

export interface ExpectedPgError {
  /** SQLSTATE: 23505 unique, 23503 FK, 23514 check, 23502 not null, 42501 huquq, DV00x — trigger'lar. */
  code: string;
  constraint?: string;
  message?: RegExp;
}

/**
 * SQL aynan kutilgan xato bilan rad etilishini tekshiradi. SAVEPOINT tufayli tashqi tranzaksiya
 * buzilmaydi va test davom etadi.
 */
export async function expectPgError(
  db: Db,
  sql: string,
  params: unknown[],
  expected: ExpectedPgError,
): Promise<void> {
  await db.query('SAVEPOINT expect_error');
  let failure: (Error & { code?: string; constraint?: string }) | undefined;
  try {
    await db.query(sql, params);
  } catch (error) {
    failure = error as Error & { code?: string; constraint?: string };
  }
  if (!failure) {
    await db.query('RELEASE SAVEPOINT expect_error');
    throw new Error(`Kutilgan xato (${expected.code}) bo'lmadi: ${sql}`);
  }
  await db.query('ROLLBACK TO SAVEPOINT expect_error');
  expect({ code: failure.code, message: failure.message }).toMatchObject({ code: expected.code });
  if (expected.constraint) expect(failure.constraint).toBe(expected.constraint);
  if (expected.message) expect(failure.message).toMatch(expected.message);
}

/** Tranzaksiya yakunidagi (DEFERRED) tekshiruvlarni hozir ishga tushiradi. */
export const CHECK_DEFERRED = 'SET CONSTRAINTS ALL IMMEDIATE';

/** Unique nomlar uchun qisqa tasodifiy qo'shimcha (faqat lotin harf va raqam — login qoidasiga mos). */
export function uid(): string {
  return randomBytes(6).toString('hex');
}
