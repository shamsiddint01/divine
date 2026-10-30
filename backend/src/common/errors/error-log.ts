import { AppError } from './app-error.js';
import { extractDbError } from './database-errors.js';

/**
 * Xatoni log uchun XAVFSIZ shaklga keltiradi (REQ-163).
 *
 * Prisma xato xabarlari so'rov argumentlarini (masalan, `passwordHash` qiymati) va DB `detail`
 * qator qiymatlarini (PII) o'z ichiga oladi — shuning uchun DB xatolaridan faqat identifikatorlar
 * (SQLSTATE, constraint, Prisma kodi, model) olinadi, `message`/`meta` umuman yozilmaydi.
 */
export function serializeErrorForLog(error: unknown, depth = 0): Record<string, unknown> {
  const db = extractDbError(error);
  if (db) {
    return {
      type: db.errorClass,
      prismaCode: db.prismaCode,
      sqlState: db.sqlState,
      constraint: db.constraint,
      kind: db.kind,
      model: db.model,
    };
  }
  if (error instanceof AppError) {
    return {
      type: 'AppError',
      code: error.code,
      status: error.status,
      ...(error.cause !== undefined && depth < 2
        ? { cause: serializeErrorForLog(error.cause, depth + 1) }
        : {}),
    };
  }
  if (error instanceof Error) {
    return {
      type: error.name,
      message: error.message,
      stack: error.stack,
      ...(error.cause !== undefined && depth < 2
        ? { cause: serializeErrorForLog(error.cause, depth + 1) }
        : {}),
    };
  }
  return { type: typeof error, value: String(error).slice(0, 200) };
}
