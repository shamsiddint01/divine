import { ERROR_MESSAGES_UZ, ErrorCode, type ApiErrorDetail } from '@divine/shared';

/**
 * PostgreSQL / Prisma xatolarini API xatolariga aylantirish (docs/DATABASE.md §12).
 *
 * Prisma 7 + `@prisma/adapter-pg` da SQLSTATE `meta.driverAdapterError.cause.originalCode` da,
 * unique/FK/RESTRICT constraint nomi `cause.constraint.index` da keladi; CHECK constraint nomi esa
 * faqat `originalMessage` ichida. Raw `pg` xatolarida esa `code` va `constraint` to'g'ridan-to'g'ri bor.
 *
 * Xom DB matni (`message`, `detail` — qator qiymatlari bilan!) hech qachon client'ga ham, log'ga ham
 * yuborilmaydi: faqat SQLSTATE, constraint nomi va Prisma kodi.
 */

export interface DbErrorInfo {
  /** Masalan `P2002`. */
  prismaCode?: string;
  /** SQLSTATE, masalan `23505` yoki trigger kodi `DV002`. */
  sqlState?: string;
  constraint?: string;
  /** Driver adapter turi, masalan `DatabaseNotReachable`. */
  kind?: string;
  /** Prisma xato klassi nomi. */
  errorClass: string;
  model?: string;
}

/** `client` — so'rov xatosi (4xx, warn); `unavailable` — DB ishlamayapti (503); `bug` — dastur xatosi (500, alert). */
export type DbErrorSeverity = 'client' | 'unavailable' | 'bug';

export interface MappedDbError {
  code: ErrorCode;
  severity: DbErrorSeverity;
  details?: ApiErrorDetail[];
}

const PRISMA_ERROR_CLASSES = new Set([
  'PrismaClientKnownRequestError',
  'PrismaClientUnknownRequestError',
  'PrismaClientInitializationError',
  'PrismaClientRustPanicError',
  'PrismaClientValidationError',
]);

type AnyRecord = Record<string, unknown>;

const asRecord = (value: unknown): AnyRecord | undefined =>
  typeof value === 'object' && value !== null ? (value as AnyRecord) : undefined;

const asString = (value: unknown): string | undefined =>
  typeof value === 'string' && value.length > 0 ? value : undefined;

const SQLSTATE = /^[0-9A-Z]{5}$/;
const CONSTRAINT_IN_MESSAGE = /constraint "([^"]+)"/;

/** Driver adapter `cause` obyektidan SQLSTATE, constraint va turi. */
function fromAdapterCause(
  cause: AnyRecord | undefined,
): Pick<DbErrorInfo, 'sqlState' | 'constraint' | 'kind'> {
  const sqlState = asString(cause?.originalCode) ?? asString(cause?.code);
  return {
    sqlState: sqlState && SQLSTATE.test(sqlState) ? sqlState : undefined,
    constraint:
      asString(asRecord(cause?.constraint)?.index) ??
      asString(cause?.originalMessage)?.match(CONSTRAINT_IN_MESSAGE)?.[1],
    kind: asString(cause?.kind),
  };
}

/** Xato DB'dan (Prisma yoki pg) bo'lsa — xavfsiz identifikatorlar; aks holda null. */
export function extractDbError(error: unknown): DbErrorInfo | null {
  const err = asRecord(error);
  if (!err) return null;
  const errorClass =
    asString(err.name) ?? asString((err.constructor as { name?: unknown } | undefined)?.name);

  if (errorClass && PRISMA_ERROR_CLASSES.has(errorClass)) {
    const meta = asRecord(err.meta);
    return {
      errorClass,
      prismaCode: asString(err.code) ?? asString(err.errorCode),
      ...fromAdapterCause(asRecord(asRecord(meta?.driverAdapterError)?.cause)),
      model: asString(meta?.modelName),
    };
  }

  // Interaktiv tranzaksiya COMMIT'ida (DEFERRED constraint/trigger, masalan DV003/DV004) Prisma xatoni
  // o'ramaydi: xom `DriverAdapterError`, SQLSTATE `cause.originalCode` da (Phase 3 probe'da kuzatilgan).
  if (errorClass === 'DriverAdapterError') {
    return { errorClass, ...fromAdapterCause(asRecord(err.cause)) };
  }

  // node-postgres DatabaseError (raw `pg` ulanishi, masalan reconciliation yoki testlar).
  if (errorClass === 'DatabaseError' && typeof err.code === 'string' && SQLSTATE.test(err.code)) {
    return {
      errorClass,
      sqlState: err.code,
      constraint: asString(err.constraint),
    };
  }
  return null;
}

/** Unique constraint → aniq biznes kodi va formadagi maydon (frontend `applyFieldErrors` uchun). */
const UNIQUE_CONSTRAINTS: Readonly<Record<string, { code: ErrorCode; field: string }>> = {
  users_login_lower_key: { code: ErrorCode.LOGIN_TAKEN, field: 'login' },
  products_barcode_key: { code: ErrorCode.BARCODE_TAKEN, field: 'barcode' },
  product_groups_name_lower_key: { code: ErrorCode.NAME_TAKEN, field: 'name' },
  warehouses_name_lower_key: { code: ErrorCode.NAME_TAKEN, field: 'name' },
  expense_categories_name_lower_key: { code: ErrorCode.NAME_TAKEN, field: 'name' },
};

/** CHECK constraint → biznes kodi (qolganlari — VALIDATION_ERROR). */
const CHECK_CONSTRAINTS: Readonly<Record<string, ErrorCode>> = {
  // Shartli UPDATE'dan o'tib ketgan holat (oxirgi himoya chizig'i) — REQ-161.
  warehouse_stock_quantity_non_negative: ErrorCode.INSUFFICIENT_STOCK,
};

const DRIVER_UNAVAILABLE_KINDS = new Set([
  'DatabaseNotReachable',
  'DatabaseDoesNotExist',
  'DatabaseAccessDenied',
  'AuthenticationFailed',
  'TooManyConnections',
  'ConnectionClosed',
  'SocketTimeout',
  'TransactionAlreadyClosed',
]);

function mapSqlState(sqlState: string, constraint: string | undefined): MappedDbError {
  switch (sqlState) {
    case '23505': {
      const known = constraint ? UNIQUE_CONSTRAINTS[constraint] : undefined;
      return known
        ? {
            code: known.code,
            severity: 'client',
            details: [{ field: known.field, message: ERROR_MESSAGES_UZ[known.code] }],
          }
        : { code: ErrorCode.CONFLICT, severity: 'client' };
    }
    // INSERT/UPDATE: bog'langan yozuv mavjud emas (barcha FK'lar RESTRICT — o'chirishda 23001 keladi).
    case '23503':
      return { code: ErrorCode.NOT_FOUND, severity: 'client' };
    // ON DELETE RESTRICT: tarixi bor yozuvni o'chirish (DATABASE.md §12).
    case '23001':
      return { code: ErrorCode.ENTITY_IN_USE, severity: 'client' };
    case '23514':
      return {
        code: (constraint && CHECK_CONSTRAINTS[constraint]) || ErrorCode.VALIDATION_ERROR,
        severity: 'client',
      };
    case '23502':
      return { code: ErrorCode.VALIDATION_ERROR, severity: 'client' };
    // Retry'lardan keyin ham bo'lsa — parallel o'zgarish ziddiyati.
    case '40001':
    case '40P01':
      return { code: ErrorCode.CONFLICT, severity: 'client' };
    case 'DV002':
      return { code: ErrorCode.INCOMING_NOT_DRAFT, severity: 'client' };
    case '57014': // statement timeout
    case '55P03': // lock_not_available
      return { code: ErrorCode.SERVICE_UNAVAILABLE, severity: 'unavailable' };
  }
  // 22xxx — data exception (uzunlik, overflow, noto'g'ri format): input validatsiyasidan o'tib ketgan.
  if (sqlState.startsWith('22')) return { code: ErrorCode.VALIDATION_ERROR, severity: 'client' };
  // 08 — ulanish, 53 — resurslar, 57P — server to'xtatilmoqda.
  if (sqlState.startsWith('08') || sqlState.startsWith('53') || sqlState.startsWith('57P')) {
    return { code: ErrorCode.SERVICE_UNAVAILABLE, severity: 'unavailable' };
  }
  // DV001/DV003/DV004 (o'zgarmaslik va ledger invariantlari), 42501 (huquq), 428C9, 25xxx
  // (tranzaksiya holati) va boshqalar — dastur xatosi: client'ga faqat INTERNAL_ERROR.
  return { code: ErrorCode.INTERNAL_ERROR, severity: 'bug' };
}

export function mapDbError(info: DbErrorInfo): MappedDbError {
  if (info.sqlState) return mapSqlState(info.sqlState, info.constraint);
  if (info.kind && DRIVER_UNAVAILABLE_KINDS.has(info.kind)) {
    return { code: ErrorCode.SERVICE_UNAVAILABLE, severity: 'unavailable' };
  }
  if (info.errorClass === 'PrismaClientInitializationError') {
    return { code: ErrorCode.SERVICE_UNAVAILABLE, severity: 'unavailable' };
  }
  switch (info.prismaCode) {
    case 'P2025': // yangilanadigan/o'chiriladigan yozuv topilmadi
      return { code: ErrorCode.NOT_FOUND, severity: 'client' };
    case 'P2034': // write conflict / deadlock (retry'lardan keyin)
      return { code: ErrorCode.CONFLICT, severity: 'client' };
    case 'P2028': // tranzaksiya timeout yoki yopilgan
      return { code: ErrorCode.SERVICE_UNAVAILABLE, severity: 'unavailable' };
  }
  if (info.prismaCode?.startsWith('P1')) {
    return { code: ErrorCode.SERVICE_UNAVAILABLE, severity: 'unavailable' };
  }
  return { code: ErrorCode.INTERNAL_ERROR, severity: 'bug' };
}

/** Qayta urinish mumkin bo'lgan tranzaksiya xatolari: serialization failure va deadlock. */
export function isRetryableTransactionError(error: unknown): boolean {
  const info = extractDbError(error);
  if (!info) return false;
  return info.sqlState === '40001' || info.sqlState === '40P01' || info.prismaCode === 'P2034';
}
