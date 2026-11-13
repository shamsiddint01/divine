import { ErrorCode } from '@divine/shared';

/**
 * Har bir xato kodi uchun standart HTTP status (docs/API.md §1.4).
 * `Record<ErrorCode, …>` — yangi kod qo'shilsa, statusi ham albatta belgilanadi (aks holda typecheck xatosi).
 */
const STATUS: Readonly<Record<ErrorCode, number>> = {
  [ErrorCode.VALIDATION_ERROR]: 400,
  [ErrorCode.BAD_REQUEST]: 400,
  [ErrorCode.IDEMPOTENCY_KEY_REQUIRED]: 400,

  [ErrorCode.UNAUTHENTICATED]: 401,
  [ErrorCode.INVALID_CREDENTIALS]: 401,
  [ErrorCode.SESSION_EXPIRED]: 401,
  // Himoyalangan so'rovda 401; login paytida auth moduli 403 bilan qaytaradi (API §1.4).
  [ErrorCode.ACCOUNT_BLOCKED]: 401,

  [ErrorCode.FORBIDDEN]: 403,
  [ErrorCode.LICENSE_EXPIRED]: 403,
  // 5xx emas: avtomatik xato xabari (Murojaat) ochilmasin.
  [ErrorCode.SITE_MAINTENANCE]: 403,
  [ErrorCode.READ_ONLY_SESSION]: 403,
  [ErrorCode.DEMO_RESTRICTED]: 403,
  [ErrorCode.DEMO_TIME_UP]: 403,
  [ErrorCode.DEMO_NO_PAYMENTS]: 403,
  [ErrorCode.WAREHOUSE_ACCESS_DENIED]: 403,
  [ErrorCode.CANNOT_MODIFY_SELF]: 403,
  [ErrorCode.LAST_ACTIVE_ADMIN]: 409,

  [ErrorCode.NOT_FOUND]: 404,

  [ErrorCode.CONFLICT]: 409,
  [ErrorCode.LOGIN_TAKEN]: 409,
  [ErrorCode.BARCODE_TAKEN]: 409,
  [ErrorCode.NAME_TAKEN]: 409,
  [ErrorCode.ENTITY_IN_USE]: 409,
  [ErrorCode.INSUFFICIENT_STOCK]: 409,
  [ErrorCode.INCOMING_NOT_DRAFT]: 409,
  [ErrorCode.IDEMPOTENCY_KEY_REUSED]: 409,

  [ErrorCode.PAYLOAD_TOO_LARGE]: 413,

  [ErrorCode.INVALID_QUANTITY]: 422,
  [ErrorCode.PRODUCT_INACTIVE]: 422,
  [ErrorCode.PRODUCT_PRICE_MISSING]: 422,
  [ErrorCode.PRODUCT_GROUP_INACTIVE]: 422,
  [ErrorCode.WAREHOUSE_INACTIVE]: 422,
  [ErrorCode.EXPENSE_CATEGORY_INACTIVE]: 422,
  [ErrorCode.CREDIT_OVERPAID]: 422,
  [ErrorCode.INCOMING_EMPTY]: 422,
  [ErrorCode.SALE_EMPTY]: 422,
  [ErrorCode.CUSTOMER_NAME_REQUIRED]: 422,

  [ErrorCode.ACCOUNT_LOCKED]: 423,
  [ErrorCode.RATE_LIMITED]: 429,
  [ErrorCode.INTERNAL_ERROR]: 500,
  [ErrorCode.SERVICE_UNAVAILABLE]: 503,
};

export function httpStatusFor(code: ErrorCode): number {
  return STATUS[code];
}

/** Framework darajasidagi (Nest, body-parser) HTTP xatolari uchun: status → xato kodi. */
export function errorCodeForStatus(status: number): ErrorCode {
  switch (status) {
    case 400:
      return ErrorCode.BAD_REQUEST;
    case 401:
      return ErrorCode.UNAUTHENTICATED;
    case 403:
      return ErrorCode.FORBIDDEN;
    case 404:
    case 405:
      return ErrorCode.NOT_FOUND;
    case 409:
      return ErrorCode.CONFLICT;
    case 413:
      return ErrorCode.PAYLOAD_TOO_LARGE;
    case 429:
      return ErrorCode.RATE_LIMITED;
    case 503:
      return ErrorCode.SERVICE_UNAVAILABLE;
    default:
      return status >= 400 && status < 500 ? ErrorCode.BAD_REQUEST : ErrorCode.INTERNAL_ERROR;
  }
}
