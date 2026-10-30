/**
 * FAQAT TEST UCHUN: foundation (validatsiya, pagination, sort, xatolar) ni haqiqiy HTTP orqali sinash.
 * Bu modul production kodida yo'q (`src/` ga kirmaydi) — Phase 3'da biznes endpoint qo'shilmaydi.
 */
import { BadRequestException, Controller, Get, Module, Param, Post } from '@nestjs/common';
import {
  type SortDirection,
  customerNameSchema,
  ErrorCode,
  loginSchema,
  quantitySchema,
  uuidSchema,
} from '@divine/shared';
import { z } from 'zod';
import { Public } from '../../../src/common/auth/auth.decorators.js';
import { AppError } from '../../../src/common/errors/app-error.js';
import { createListQuerySchema, listFilters } from '../../../src/common/query/list-query.js';
import {
  toPaginated,
  toPrismaDateRange,
  toPrismaOrderBy,
  toPrismaPagination,
} from '../../../src/common/query/prisma-query.js';
import { ZodBody, ZodParam, ZodQuery } from '../../../src/common/validation/zod-validation.pipe.js';

export const createProbeSchema = z.strictObject({
  login: loginSchema,
  quantity: quantitySchema,
  customerName: customerNameSchema,
});

export const listProbeQuery = createListQuerySchema({
  sortFields: ['name', 'createdAt'],
  defaultSort: { field: 'createdAt', direction: 'desc' },
  filters: {
    search: listFilters.search(),
    status: listFilters.oneOf(['ACTIVE', 'INACTIVE']),
    warehouseId: listFilters.id(),
    ...listFilters.dateRange(),
  },
});
type ListProbeQuery = z.output<typeof listProbeQuery>;

/** Prisma xatosining haqiqiy shakli (Prisma 7 + adapter-pg, Phase 3 probe'da kuzatilgan). */
export class FakePrismaKnownError extends Error {
  override name = 'PrismaClientKnownRequestError';
  constructor(
    readonly code: string,
    readonly meta: Record<string, unknown>,
  ) {
    // Haqiqiy Prisma xabari kabi — argument qiymatlari bilan (log'ga ham, javobga ham tushmasligi kerak).
    super('Invalid `tx.user.create()` invocation: { passwordHash: "SIZIB-CHIQMASIN-HASH" }');
  }
}

const adapterError = (cause: Record<string, unknown>) => ({
  modelName: 'Probe',
  driverAdapterError: { name: 'DriverAdapterError', cause },
});

export const DB_ERRORS: Record<string, () => unknown> = {
  'unique-login': () =>
    new FakePrismaKnownError(
      'P2002',
      adapterError({
        originalCode: '23505',
        kind: 'UniqueConstraintViolation',
        constraint: { index: 'users_login_lower_key' },
      }),
    ),
  fk: () =>
    new FakePrismaKnownError(
      'P2003',
      adapterError({ originalCode: '23503', constraint: { index: 'users_role_id_fkey' } }),
    ),
  check: () =>
    new FakePrismaKnownError(
      'P2039',
      adapterError({
        originalCode: '23514',
        kind: 'postgres',
        originalMessage:
          'new row for relation "warehouses" violates check constraint "warehouses_name_not_blank"',
        detail: 'Failing row contains (SIZIB-CHIQMASIN-QATOR)',
      }),
    ),
  restrict: () =>
    new FakePrismaKnownError(
      'P2003',
      adapterError({ originalCode: '23001', constraint: { index: 'products_group_id_fkey' } }),
    ),
  'not-null': () => new FakePrismaKnownError('P2010', adapterError({ originalCode: '23502' })),
  immutable: () =>
    new FakePrismaKnownError(
      'P2010',
      adapterError({ originalCode: 'DV001', originalMessage: '"audit_logs" jadvali o‘zgarmas' }),
    ),
  unavailable: () =>
    new FakePrismaKnownError('P1001', adapterError({ kind: 'DatabaseNotReachable' })),
};

// Foundation probe autentifikatsiyasiz (Phase 3 testlari); auth/RBAC uchun alohida probe — rbac-probe.
@Public()
@Controller('__probe')
export class ProbeController {
  @Post('items')
  create(@ZodBody(createProbeSchema) body: z.output<typeof createProbeSchema>) {
    return body;
  }

  @Get('items')
  list(@ZodQuery(listProbeQuery) query: ListProbeQuery) {
    const rows = [{ id: 1 }, { id: 2 }];
    return {
      ...toPaginated(rows, 45, query),
      query,
      prisma: {
        ...toPrismaPagination(query),
        orderBy: toPrismaOrderBy(
          query.sort,
          {
            name: (direction): Record<string, SortDirection> => ({ name: direction }),
            createdAt: (direction): Record<string, SortDirection> => ({ createdAt: direction }),
          },
          { id: 'asc' },
        ),
        dateRange: toPrismaDateRange(query) ?? null,
      },
    };
  }

  @Get('items/:id')
  get(@ZodParam('id', uuidSchema) id: string) {
    return { id };
  }

  @Post('echo')
  echo() {
    return { ok: true };
  }

  @Get('errors/app')
  appError() {
    throw new AppError(ErrorCode.INSUFFICIENT_STOCK, {
      message: 'Omborda yetarli mahsulot yo‘q: Telefon (mavjud: 2 dona)',
      details: [{ field: 'items[0].quantity', message: 'Mavjud: 2 dona' }],
    });
  }

  @Get('errors/http')
  httpError() {
    throw new BadRequestException('English framework message');
  }

  @Get('errors/unknown')
  unknownError() {
    throw new Error('Ichki xato: FAQAT-SERVER-LOGIDA');
  }

  @Get('errors/db/:kind')
  dbError(@Param('kind') kind: string) {
    throw DB_ERRORS[kind]?.() ?? new Error(`noma'lum kind: ${kind}`);
  }
}

@Module({ controllers: [ProbeController] })
export class ProbeModule {}
