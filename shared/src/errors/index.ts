/**
 * Yagona error kodlari (REQ-143). Backend har bir xatoni shu kodlardan biri bilan qaytaradi,
 * frontend esa kod bo'yicha o'zbekcha xabar ko'rsatadi.
 */
export const ErrorCode = {
  VALIDATION_ERROR: 'VALIDATION_ERROR',
  BAD_REQUEST: 'BAD_REQUEST',

  UNAUTHENTICATED: 'UNAUTHENTICATED',
  INVALID_CREDENTIALS: 'INVALID_CREDENTIALS',
  ACCOUNT_LOCKED: 'ACCOUNT_LOCKED',
  ACCOUNT_BLOCKED: 'ACCOUNT_BLOCKED',
  SESSION_EXPIRED: 'SESSION_EXPIRED',
  FORBIDDEN: 'FORBIDDEN',
  LICENSE_EXPIRED: 'LICENSE_EXPIRED',
  SITE_MAINTENANCE: 'SITE_MAINTENANCE',
  READ_ONLY_SESSION: 'READ_ONLY_SESSION',
  DEMO_RESTRICTED: 'DEMO_RESTRICTED',
  DEMO_TIME_UP: 'DEMO_TIME_UP',

  NOT_FOUND: 'NOT_FOUND',
  CONFLICT: 'CONFLICT',
  LOGIN_TAKEN: 'LOGIN_TAKEN',
  BARCODE_TAKEN: 'BARCODE_TAKEN',
  NAME_TAKEN: 'NAME_TAKEN',
  ENTITY_IN_USE: 'ENTITY_IN_USE',

  INSUFFICIENT_STOCK: 'INSUFFICIENT_STOCK',
  INVALID_QUANTITY: 'INVALID_QUANTITY',
  PRODUCT_INACTIVE: 'PRODUCT_INACTIVE',
  PRODUCT_PRICE_MISSING: 'PRODUCT_PRICE_MISSING',
  PRODUCT_GROUP_INACTIVE: 'PRODUCT_GROUP_INACTIVE',
  WAREHOUSE_INACTIVE: 'WAREHOUSE_INACTIVE',
  EXPENSE_CATEGORY_INACTIVE: 'EXPENSE_CATEGORY_INACTIVE',
  CREDIT_OVERPAID: 'CREDIT_OVERPAID',
  WAREHOUSE_ACCESS_DENIED: 'WAREHOUSE_ACCESS_DENIED',
  INCOMING_NOT_DRAFT: 'INCOMING_NOT_DRAFT',
  INCOMING_EMPTY: 'INCOMING_EMPTY',
  SALE_EMPTY: 'SALE_EMPTY',
  CUSTOMER_NAME_REQUIRED: 'CUSTOMER_NAME_REQUIRED',
  IDEMPOTENCY_KEY_REQUIRED: 'IDEMPOTENCY_KEY_REQUIRED',
  IDEMPOTENCY_KEY_REUSED: 'IDEMPOTENCY_KEY_REUSED',
  CANNOT_MODIFY_SELF: 'CANNOT_MODIFY_SELF',
  LAST_ACTIVE_ADMIN: 'LAST_ACTIVE_ADMIN',

  RATE_LIMITED: 'RATE_LIMITED',
  PAYLOAD_TOO_LARGE: 'PAYLOAD_TOO_LARGE',
  SERVICE_UNAVAILABLE: 'SERVICE_UNAVAILABLE',
  INTERNAL_ERROR: 'INTERNAL_ERROR',
} as const;

export type ErrorCode = (typeof ErrorCode)[keyof typeof ErrorCode];

/** Har bir error kodi uchun standart o'zbekcha xabar (REQ-002, REQ-143). */
export const ERROR_MESSAGES_UZ: Readonly<Record<ErrorCode, string>> = {
  VALIDATION_ERROR: 'Kiritilgan ma’lumotlarda xatolik bor',
  BAD_REQUEST: 'So‘rov noto‘g‘ri',

  UNAUTHENTICATED: 'Tizimga kirishingiz kerak',
  INVALID_CREDENTIALS: 'Login yoki parol noto‘g‘ri',
  ACCOUNT_LOCKED: 'Juda ko‘p noto‘g‘ri urinish. Hisob vaqtincha bloklandi, keyinroq urinib ko‘ring',
  ACCOUNT_BLOCKED: 'Hisobingiz bloklangan. Administratorga murojaat qiling',
  SESSION_EXPIRED: 'Sessiya muddati tugadi. Qaytadan kiring',
  LICENSE_EXPIRED: 'Sizning to‘lov muddatingiz tugadi. Bog‘lanish uchun: +998901333831',
  SITE_MAINTENANCE: 'Saytda texnik ishlar ketmoqda. Birozdan keyin qayta kiring',
  READ_ONLY_SESSION: 'Bu ko‘rish rejimi: o‘zgartirish mumkin emas',
  DEMO_RESTRICTED: 'Sinov hisobida foydalanuvchi qo‘shib, o‘zgartirib yoki bloklab bo‘lmaydi',
  DEMO_TIME_UP:
    'Sinov muddati tugadi: 1 soatlik vaqt yoki 7 kun o‘tdi. Davom etish uchun bog‘laning: +998901333831',
  FORBIDDEN: 'Bu amalni bajarishga ruxsatingiz yo‘q',

  NOT_FOUND: 'Ma’lumot topilmadi',
  CONFLICT: 'Amalni bajarib bo‘lmadi: ma’lumotlar ziddiyati',
  LOGIN_TAKEN: 'Bu login band. Boshqa login kiriting',
  BARCODE_TAKEN: 'Bu shtrix-kod allaqachon mavjud',
  NAME_TAKEN: 'Bu nom allaqachon mavjud',
  ENTITY_IN_USE: 'Bu yozuv boshqa ma’lumotlarda ishlatilgani uchun o‘chirib bo‘lmaydi',

  INSUFFICIENT_STOCK: 'Omborda yetarli mahsulot yo‘q',
  INVALID_QUANTITY: 'Miqdor noto‘g‘ri',
  PRODUCT_INACTIVE: 'Mahsulot faol emas',
  PRODUCT_PRICE_MISSING: 'Mahsulotning tanlangan narxi kiritilmagan',
  PRODUCT_GROUP_INACTIVE: 'Mahsulot guruhi faol emas (arxivlangan)',
  WAREHOUSE_INACTIVE: 'Ombor faol emas',
  EXPENSE_CATEGORY_INACTIVE: 'Xarajat kategoriyasi faol emas',
  CREDIT_OVERPAID: 'To‘lov summasi qolgan qarzdan oshib ketdi',
  WAREHOUSE_ACCESS_DENIED: 'Bu omborga ruxsatingiz yo‘q',
  INCOMING_NOT_DRAFT: 'Faqat qoralama holatidagi kirimni o‘zgartirish mumkin',
  INCOMING_EMPTY: 'Kirimda kamida bitta mahsulot bo‘lishi kerak',
  SALE_EMPTY: 'Sotuvda kamida bitta mahsulot bo‘lishi kerak',
  CUSTOMER_NAME_REQUIRED: 'Mijoz ismi majburiy',
  IDEMPOTENCY_KEY_REQUIRED: 'So‘rov identifikatori (Idempotency-Key) yuborilmagan',
  IDEMPOTENCY_KEY_REUSED: 'Bu so‘rov identifikatori boshqa ma’lumot bilan ishlatilgan',
  CANNOT_MODIFY_SELF: 'O‘z hisobingiz ustida bu amalni bajarib bo‘lmaydi',
  LAST_ACTIVE_ADMIN: 'Tizimda kamida bitta faol administrator qolishi kerak',

  RATE_LIMITED: 'Juda ko‘p so‘rov yuborildi. Birozdan keyin urinib ko‘ring',
  PAYLOAD_TOO_LARGE: 'Yuborilgan ma’lumot hajmi juda katta',
  SERVICE_UNAVAILABLE: 'Xizmat vaqtincha ishlamayapti. Keyinroq urinib ko‘ring',
  INTERNAL_ERROR: 'Kutilmagan xatolik yuz berdi. Keyinroq urinib ko‘ring',
};

/** Maydon darajasidagi xato tafsiloti. */
export interface ApiErrorDetail {
  /** Masalan: `items[0].quantity` */
  field: string;
  message: string;
}

/** Barcha API xatolarining yagona strukturasi (docs/API.md §2.4). */
export interface ApiErrorBody {
  error: {
    code: ErrorCode;
    message: string;
    details?: ApiErrorDetail[];
    requestId?: string;
  };
}

export function isApiErrorBody(value: unknown): value is ApiErrorBody {
  if (typeof value !== 'object' || value === null || !('error' in value)) return false;
  const error = (value as { error: unknown }).error;
  return (
    typeof error === 'object' &&
    error !== null &&
    typeof (error as { code?: unknown }).code === 'string' &&
    typeof (error as { message?: unknown }).message === 'string'
  );
}
