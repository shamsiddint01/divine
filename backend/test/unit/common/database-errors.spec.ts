import { describe, expect, it } from 'vitest';
import { AppError } from '../../../src/common/errors/app-error.js';
import {
  extractDbError,
  isRetryableTransactionError,
  mapDbError,
} from '../../../src/common/errors/database-errors.js';
import { serializeErrorForLog } from '../../../src/common/errors/error-log.js';

/** Prisma 7 + adapter-pg xato shakli (Phase 3'da haqiqiy DB'da kuzatilgan). */
function prismaError(
  code: string,
  cause: Record<string, unknown>,
  name = 'PrismaClientKnownRequestError',
) {
  const error = new Error(
    'Invalid `tx.user.create()` invocation: { passwordHash: "MAXFIY-HASH" }',
  ) as Error & { code: string; meta: unknown };
  error.name = name;
  error.code = code;
  error.meta = { modelName: 'User', driverAdapterError: { name: 'DriverAdapterError', cause } };
  return error;
}

/** node-postgres DatabaseError shakli. */
function pgError(code: string, constraint?: string) {
  return Object.assign(new Error('duplicate key value'), {
    name: 'DatabaseError',
    code,
    constraint,
  });
}

const map = (error: unknown) => mapDbError(extractDbError(error)!);

describe('extractDbError', () => {
  it('Prisma: SQLSTATE va constraint (unique/FK/RESTRICT — cause.constraint.index)', () => {
    const error = prismaError('P2002', {
      originalCode: '23505',
      constraint: { index: 'users_login_lower_key' },
    });
    expect(extractDbError(error)).toEqual({
      errorClass: 'PrismaClientKnownRequestError',
      prismaCode: 'P2002',
      sqlState: '23505',
      constraint: 'users_login_lower_key',
      kind: undefined,
      model: 'User',
    });
  });

  it('Prisma: CHECK constraint nomi xabardan olinadi', () => {
    const info = extractDbError(
      prismaError('P2039', {
        originalCode: '23514',
        kind: 'postgres',
        originalMessage:
          'new row for relation "x" violates check constraint "warehouse_stock_quantity_non_negative"',
      }),
    );
    expect(info?.constraint).toBe('warehouse_stock_quantity_non_negative');
  });

  it('COMMIT paytidagi xom DriverAdapterError (DEFERRED trigger) tanib olinadi', () => {
    const error = Object.assign(new Error('Sotuvda kamida bitta mahsulot bo‘lishi kerak'), {
      name: 'DriverAdapterError',
      cause: { originalCode: 'DV004', kind: 'postgres', detail: 'MAXFIY-QATOR' },
    });
    expect(extractDbError(error)).toEqual({
      errorClass: 'DriverAdapterError',
      sqlState: 'DV004',
      constraint: undefined,
      kind: 'postgres',
    });
    expect(map(error)).toMatchObject({ code: 'INTERNAL_ERROR', severity: 'bug' });
    expect(JSON.stringify(serializeErrorForLog(error))).not.toContain('MAXFIY');
  });

  it('raw pg DatabaseError ham tanib olinadi; boshqa xatolar — null', () => {
    expect(extractDbError(pgError('23001', 'products_group_id_fkey'))).toMatchObject({
      sqlState: '23001',
      constraint: 'products_group_id_fkey',
    });
    expect(extractDbError(new Error('oddiy'))).toBeNull();
    expect(extractDbError('satr')).toBeNull();
    expect(extractDbError(null)).toBeNull();
  });
});

describe('mapDbError (DATABASE §12)', () => {
  it.each([
    ['users_login_lower_key', 'LOGIN_TAKEN', 'login'],
    ['products_barcode_key', 'BARCODE_TAKEN', 'barcode'],
    ['product_groups_name_lower_key', 'NAME_TAKEN', 'name'],
    ['warehouses_name_lower_key', 'NAME_TAKEN', 'name'],
    ['expense_categories_owner_name_lower_key', 'NAME_TAKEN', 'name'],
  ])('unique %s → %s (maydon: %s)', (constraint, code, field) => {
    const mapped = map(pgError('23505', constraint));
    expect(mapped).toMatchObject({ code, severity: 'client' });
    expect(mapped.details).toEqual([{ field, message: expect.any(String) }]);
  });

  it.each([
    ['23505', 'sales_idempotency_key_key', 'CONFLICT', 'client'],
    ['23503', 'users_role_id_fkey', 'NOT_FOUND', 'client'],
    ['23001', 'products_group_id_fkey', 'ENTITY_IN_USE', 'client'],
    ['23514', 'warehouse_stock_quantity_non_negative', 'INSUFFICIENT_STOCK', 'client'],
    ['23514', 'products_name_not_blank', 'VALIDATION_ERROR', 'client'],
    ['23502', undefined, 'VALIDATION_ERROR', 'client'],
    ['22001', undefined, 'VALIDATION_ERROR', 'client'],
    ['22003', undefined, 'VALIDATION_ERROR', 'client'],
    ['22P02', undefined, 'VALIDATION_ERROR', 'client'],
    ['40001', undefined, 'CONFLICT', 'client'],
    ['40P01', undefined, 'CONFLICT', 'client'],
    ['DV002', undefined, 'INCOMING_NOT_DRAFT', 'client'],
    ['DV001', undefined, 'INTERNAL_ERROR', 'bug'],
    ['DV003', undefined, 'INTERNAL_ERROR', 'bug'],
    ['DV004', undefined, 'INTERNAL_ERROR', 'bug'],
    ['42501', undefined, 'INTERNAL_ERROR', 'bug'],
    ['428C9', undefined, 'INTERNAL_ERROR', 'bug'],
    ['25P02', undefined, 'INTERNAL_ERROR', 'bug'],
    ['08006', undefined, 'SERVICE_UNAVAILABLE', 'unavailable'],
    ['53300', undefined, 'SERVICE_UNAVAILABLE', 'unavailable'],
    ['57P01', undefined, 'SERVICE_UNAVAILABLE', 'unavailable'],
    ['57014', undefined, 'SERVICE_UNAVAILABLE', 'unavailable'],
  ])('SQLSTATE %s (%s) → %s', (sqlState, constraint, code, severity) => {
    expect(map(pgError(sqlState, constraint))).toMatchObject({ code, severity });
  });

  it.each([
    ['P2025', {}, 'NOT_FOUND'],
    ['P2034', {}, 'CONFLICT'],
    ['P2028', {}, 'SERVICE_UNAVAILABLE'],
    ['P1001', { kind: 'DatabaseNotReachable' }, 'SERVICE_UNAVAILABLE'],
    ['P1017', {}, 'SERVICE_UNAVAILABLE'],
    ['P2999', {}, 'INTERNAL_ERROR'],
  ])('Prisma %s → %s', (prismaCode, cause, code) => {
    expect(map(prismaError(prismaCode, cause))).toMatchObject({ code });
  });

  it('Prisma ulanish va validatsiya klasslari', () => {
    expect(map(prismaError('', {}, 'PrismaClientInitializationError'))).toMatchObject({
      code: 'SERVICE_UNAVAILABLE',
    });
    expect(map(prismaError('', {}, 'PrismaClientValidationError'))).toMatchObject({
      code: 'INTERNAL_ERROR',
      severity: 'bug',
    });
  });

  it('qayta urinish faqat serialization/deadlock uchun', () => {
    expect(isRetryableTransactionError(pgError('40001'))).toBe(true);
    expect(isRetryableTransactionError(pgError('40P01'))).toBe(true);
    expect(isRetryableTransactionError(prismaError('P2034', {}))).toBe(true);
    expect(isRetryableTransactionError(pgError('23505', 'x'))).toBe(false);
    expect(isRetryableTransactionError(new Error('x'))).toBe(false);
  });
});

describe('serializeErrorForLog (REQ-163)', () => {
  it('Prisma xatosidan faqat identifikatorlar: xabar (argumentlar) va meta (qator qiymatlari) yo‘q', () => {
    const error = prismaError('P2039', {
      originalCode: '23514',
      originalMessage: 'violates check constraint "users_login_format"',
      detail: 'Failing row contains (MAXFIY-QATOR)',
    });
    const logged = serializeErrorForLog(error);
    expect(JSON.stringify(logged)).not.toContain('MAXFIY');
    expect(logged).toMatchObject({ sqlState: '23514', constraint: 'users_login_format' });
  });

  it('AppError ichidagi sabab ham xavfsiz serializatsiya qilinadi', () => {
    const wrapped = new AppError('CONFLICT', {
      cause: prismaError('P2002', { originalCode: '23505' }),
    });
    const logged = serializeErrorForLog(wrapped);
    expect(logged).toMatchObject({
      type: 'AppError',
      code: 'CONFLICT',
      cause: { sqlState: '23505' },
    });
    expect(JSON.stringify(logged)).not.toContain('MAXFIY');
  });

  it('oddiy xato — xabar va stack (faqat server log uchun)', () => {
    expect(serializeErrorForLog(new TypeError('x is undefined'))).toMatchObject({
      type: 'TypeError',
      message: 'x is undefined',
      stack: expect.stringContaining('TypeError'),
    });
  });

  it('sabablar zanjiri 2 darajada to‘xtaydi; xato bo‘lmagan qiymat — turi va qisqartirilgan matni', () => {
    const deep = new Error('1', {
      cause: new Error('2', { cause: new Error('3', { cause: new Error('4') }) }),
    });
    const logged = serializeErrorForLog(deep);
    expect(logged).toMatchObject({
      message: '1',
      cause: { message: '2', cause: { message: '3' } },
    });
    expect((logged.cause as { cause: Record<string, unknown> }).cause).not.toHaveProperty('cause');
    expect(serializeErrorForLog('x'.repeat(500))).toEqual({
      type: 'string',
      value: 'x'.repeat(200),
    });
    expect(serializeErrorForLog(undefined)).toEqual({ type: 'undefined', value: 'undefined' });
  });
});
