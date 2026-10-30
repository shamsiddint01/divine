import { ERROR_MESSAGES_UZ, type ApiErrorDetail, type ErrorCode } from '@divine/shared';
import { httpStatusFor } from './error-status.js';

export interface AppErrorOptions {
  /** Maydon darajasidagi tafsilotlar (masalan, validatsiya). */
  details?: ApiErrorDetail[];
  /** Standart xabar o'rniga aniqroq o'zbekcha xabar (masalan, mahsulot nomi bilan INSUFFICIENT_STOCK). */
  message?: string;
  /** Standart statusni almashtirish (masalan, ACCOUNT_BLOCKED login'da 403). */
  status?: number;
  /** Faqat server log'i uchun ichki sabab — client'ga hech qachon qaytmaydi. */
  cause?: unknown;
}

/**
 * Ilovaning yagona kutilgan xato turi (ARCHITECTURE §5.3). Service va pipe'lar shuni tashlaydi;
 * global filter uni `{ error: { code, message, details, requestId } }` ga aylantiradi (API §1.3).
 */
export class AppError extends Error {
  readonly code: ErrorCode;
  readonly status: number;
  readonly details?: ApiErrorDetail[];

  constructor(code: ErrorCode, options: AppErrorOptions = {}) {
    super(options.message ?? ERROR_MESSAGES_UZ[code], { cause: options.cause });
    this.name = 'AppError';
    this.code = code;
    this.status = options.status ?? httpStatusFor(code);
    if (options.details && options.details.length > 0) this.details = options.details;
  }
}
