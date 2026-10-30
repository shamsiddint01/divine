import { type ArgumentsHost, Catch, type ExceptionFilter, HttpException } from '@nestjs/common';
import {
  ERROR_MESSAGES_UZ,
  ErrorCode,
  type ApiErrorBody,
  type ApiErrorDetail,
} from '@divine/shared';
import type { Request, Response } from 'express';
import { PinoLogger } from 'nestjs-pino';
import { AppError } from '../errors/app-error.js';
import { extractDbError, mapDbError } from '../errors/database-errors.js';
import { serializeErrorForLog } from '../errors/error-log.js';
import { errorCodeForStatus, httpStatusFor } from '../errors/error-status.js';
import { REQUEST_ID_HEADER } from '../http/request-id.js';

interface ErrorResolution {
  status: number;
  code: ErrorCode;
  message: string;
  details?: ApiErrorDetail[];
  /** `none` — oddiy client xatosi (pino-http so'rov logi yetarli). */
  log: 'none' | 'warn' | 'error';
}

const fromCode = (
  code: ErrorCode,
  log: ErrorResolution['log'],
  details?: ApiErrorDetail[],
): ErrorResolution => ({
  status: httpStatusFor(code),
  code,
  message: ERROR_MESSAGES_UZ[code],
  details,
  log,
});

/** body-parser xatolari (`entity.too.large`, `entity.parse.failed`, …): `status` + `type` maydonlari bilan. */
function bodyParserStatus(exception: unknown): number | undefined {
  if (typeof exception !== 'object' || exception === null) return undefined;
  const { status, statusCode, type } = exception as Record<string, unknown>;
  const value = typeof status === 'number' ? status : statusCode;
  return typeof type === 'string' && typeof value === 'number' ? value : undefined;
}

/**
 * Yagona global xato ishlovchisi (ARCHITECTURE §9.6, API §1.3).
 *
 * Har qanday xato → `{ error: { code, message (o'zbekcha), details?, requestId } }`.
 * Client'ga hech qachon stack trace, SQL, constraint nomi yoki framework'ning inglizcha xabari
 * qaytmaydi. Texnik tafsilot faqat server log'ida, `requestId` bilan bog'langan holda.
 */
@Catch()
export class GlobalExceptionFilter implements ExceptionFilter {
  constructor(private readonly logger: PinoLogger) {
    logger.setContext(GlobalExceptionFilter.name);
  }

  catch(exception: unknown, host: ArgumentsHost): void {
    const http = host.switchToHttp();
    const req = http.getRequest<Request & { id?: unknown }>();
    const res = http.getResponse<Response>();
    const requestId =
      (typeof req?.id === 'string' && req.id) ||
      (res?.getHeader?.(REQUEST_ID_HEADER) as string | undefined) ||
      undefined;

    const resolved = this.resolve(exception);

    if (resolved.log !== 'none') {
      const payload = {
        requestId,
        method: req?.method,
        route: req?.route?.path ?? req?.path,
        status: resolved.status,
        code: resolved.code,
        err: serializeErrorForLog(exception),
      };
      if (resolved.log === 'error') this.logger.error(payload, 'So‘rovni bajarishda xatolik');
      else this.logger.warn(payload, 'So‘rov rad etildi');
    }

    if (!res || res.headersSent) return;

    const body: ApiErrorBody = {
      error: {
        code: resolved.code,
        message: resolved.message,
        ...(resolved.details ? { details: resolved.details } : {}),
        ...(requestId ? { requestId } : {}),
      },
    };
    res.setHeader('Cache-Control', 'no-store');
    res.status(resolved.status).json(body);
  }

  private resolve(exception: unknown): ErrorResolution {
    if (exception instanceof AppError) {
      return {
        status: exception.status,
        code: exception.code,
        message: exception.message,
        details: exception.details,
        log: exception.status >= 500 ? 'error' : 'none',
      };
    }

    const db = extractDbError(exception);
    if (db) {
      const mapped = mapDbError(db);
      return fromCode(mapped.code, mapped.severity === 'client' ? 'warn' : 'error', mapped.details);
    }

    if (exception instanceof HttpException) {
      const status = exception.getStatus();
      const code = errorCodeForStatus(status);
      // Framework xabari (inglizcha) ishlatilmaydi — faqat bizning o'zbekcha matn.
      return { ...fromCode(code, status >= 500 ? 'error' : 'none'), status: httpStatusFor(code) };
    }

    const parserStatus = bodyParserStatus(exception);
    if (parserStatus !== undefined && parserStatus < 500) {
      return fromCode(
        parserStatus === 413 ? ErrorCode.PAYLOAD_TOO_LARGE : ErrorCode.BAD_REQUEST,
        'none',
      );
    }

    return fromCode(ErrorCode.INTERNAL_ERROR, 'error');
  }
}
